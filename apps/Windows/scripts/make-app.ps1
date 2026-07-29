[CmdletBinding()]
param(
    [switch]$SkipTests,
    [switch]$SkipInstall,
    [switch]$SkipLaunch
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$windowsRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $windowsRoot "..\.."))
$distributionRoot = Join-Path $windowsRoot "dist"
$installedExecutable = Join-Path $env:LOCALAPPDATA "Programs\WinPlate\WinPlate.exe"
$installedBackendExecutable = Join-Path $env:LOCALAPPDATA "Programs\WinPlate\resources\backend\bin\winplate-backend.exe"
$startMenuShortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\WinPlate.lnk"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "WinPlate.lnk"

function Invoke-Npm {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & npm.cmd @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "npm command failed: npm $($Arguments -join ' ')"
    }
}

function Stop-ExistingWinPlate {
    $normalizedRepositoryRoot = $repositoryRoot.TrimEnd("\")
    $processes = Get-CimInstance Win32_Process | Where-Object {
        $executablePath = [string]$_.ExecutablePath
        $commandLine = [string]$_.CommandLine
        ($executablePath -and $executablePath.Equals($installedExecutable, [StringComparison]::OrdinalIgnoreCase)) -or
        ($executablePath -and $executablePath.Equals($installedBackendExecutable, [StringComparison]::OrdinalIgnoreCase)) -or
        (
            $_.Name -ieq "electron.exe" -and
            $commandLine.IndexOf($normalizedRepositoryRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
        ) -or
        (
            $_.Name -ieq "python.exe" -and
            $commandLine.IndexOf($normalizedRepositoryRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $commandLine.IndexOf("winplate_local_api", [StringComparison]::OrdinalIgnoreCase) -ge 0
        )
    }
    foreach ($process in $processes) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    if ($processes) {
        Start-Sleep -Milliseconds 750
    }
}

Push-Location $repositoryRoot
try {
    if (-not $SkipTests) {
        Invoke-Npm run windows:test
    }
    & (Join-Path $PSScriptRoot "build-backend.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "The standalone backend build failed."
    }
    Invoke-Npm run dist --workspace "@winplate/windows-electron"
} finally {
    Pop-Location
}

$installer = Get-ChildItem -LiteralPath $distributionRoot -Filter "WinPlate-Setup-*.exe" -File |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
if ($null -eq $installer) {
    throw "The WinPlate installer was not created below $distributionRoot"
}

if (-not $SkipInstall) {
    Stop-ExistingWinPlate
    $installerProcess = Start-Process -FilePath $installer.FullName -ArgumentList "/S" -PassThru -Wait
    if ($installerProcess.ExitCode -ne 0) {
        throw "The WinPlate installer failed with exit code $($installerProcess.ExitCode)."
    }
    if (-not (Test-Path -LiteralPath $installedExecutable -PathType Leaf)) {
        throw "WinPlate was not installed at the canonical path $installedExecutable"
    }

    if (-not $SkipLaunch) {
        Start-Process -FilePath $installedExecutable | Out-Null
        $ready = $false
        for ($attempt = 0; $attempt -lt 80; $attempt += 1) {
            try {
                $health = Invoke-RestMethod -Uri "http://127.0.0.1:8765/api/health" -TimeoutSec 1
                if ($health.status -eq "ok") {
                    $ready = $true
                    break
                }
            } catch {
                Start-Sleep -Milliseconds 250
            }
        }
        if (-not $ready) {
            throw "Installed WinPlate launched, but its local API did not become healthy."
        }
        $installedProcesses = Get-CimInstance Win32_Process | Where-Object {
            $executablePath = [string]$_.ExecutablePath
            $executablePath -and (
                $executablePath.Equals($installedExecutable, [StringComparison]::OrdinalIgnoreCase) -or
                $executablePath.Equals($installedBackendExecutable, [StringComparison]::OrdinalIgnoreCase)
            )
        }
        $runningPaths = @($installedProcesses | ForEach-Object { [string]$_.ExecutablePath })
        if (-not ($runningPaths -contains $installedExecutable)) {
            throw "The canonical installed WinPlate process is not running."
        }
        if (-not ($runningPaths -contains $installedBackendExecutable)) {
            throw "The installed standalone WinPlate backend process is not running."
        }
    }

    if (-not (Test-Path -LiteralPath $startMenuShortcut -PathType Leaf)) {
        throw "The WinPlate Start menu shortcut was not created."
    }
    if (-not (Test-Path -LiteralPath $desktopShortcut -PathType Leaf)) {
        throw "The WinPlate desktop shortcut was not created."
    }
}

Write-Host "Built installer: $($installer.FullName)"
if (-not $SkipInstall) {
    Write-Host "Installed application: $installedExecutable"
}
