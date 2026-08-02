[CmdletBinding()]
param(
    [switch]$SkipBuildDependencyInstall,
    [switch]$SkipProbe
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$windowsRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $windowsRoot "..\.."))
$python = Join-Path $repositoryRoot ".venv\Scripts\python.exe"
$backendRoot = Join-Path $repositoryRoot "backend\local-api"
$notificationTaxonomy = Join-Path $repositoryRoot "packages\shared-types\notification-taxonomy.v1.json"
$entrypoint = Join-Path $backendRoot "winplate_local_api\launcher.py"
$buildRoot = Join-Path $windowsRoot ".build"
$backendOutput = Join-Path $buildRoot "backend"
$pyInstallerWork = Join-Path $buildRoot "pyinstaller\work"
$pyInstallerSpec = Join-Path $buildRoot "pyinstaller\spec"
$backendExecutable = Join-Path $backendOutput "winplate-backend.exe"

function Stop-BuiltBackendProcesses {
    $processes = Get-CimInstance Win32_Process -Filter "Name='winplate-backend.exe'" | Where-Object {
        $executablePath = [string]$_.ExecutablePath
        $executablePath -and $executablePath.Equals(
            $backendExecutable,
            [StringComparison]::OrdinalIgnoreCase
        )
    }
    foreach ($process in $processes) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    if ($processes) {
        Start-Sleep -Milliseconds 500
    }
}

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    throw "WinPlate virtual environment is missing. Run 'npm run venv:create' and 'npm run backend:install' first."
}
if (-not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) {
    throw "WinPlate backend launcher was not found at $entrypoint"
}
if (-not (Test-Path -LiteralPath $notificationTaxonomy -PathType Leaf)) {
    throw "Shared notification taxonomy was not found at $notificationTaxonomy"
}

New-Item -ItemType Directory -Force -Path $backendOutput, $pyInstallerWork, $pyInstallerSpec | Out-Null
Stop-BuiltBackendProcesses

if (-not $SkipBuildDependencyInstall) {
    & $python -m pip install --disable-pip-version-check --requirement (Join-Path $backendRoot "requirements-build.txt")
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install the Windows backend build dependency."
    }
}

& $python -m PyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --console `
    --name "winplate-backend" `
    --distpath $backendOutput `
    --workpath $pyInstallerWork `
    --specpath $pyInstallerSpec `
    --paths $backendRoot `
    --collect-submodules "uvicorn" `
    --collect-submodules "winplate_local_api" `
    --add-data "$notificationTaxonomy;winplate_shared" `
    $entrypoint
if ($LASTEXITCODE -ne 0) {
    throw "Failed to build the standalone WinPlate backend."
}
if (-not (Test-Path -LiteralPath $backendExecutable -PathType Leaf)) {
    throw "The standalone WinPlate backend was not created at $backendExecutable"
}

if (-not $SkipProbe) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $probePort = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    $listener.Stop()

    $probeData = Join-Path $buildRoot "backend-probe-data"
    New-Item -ItemType Directory -Force -Path $probeData | Out-Null
    $previousPort = [Environment]::GetEnvironmentVariable("WINPLATE_BACKEND_PORT", "Process")
    $previousDataDirectory = [Environment]::GetEnvironmentVariable("WINPLATE_DATA_DIR", "Process")
    $probeProcess = $null
    try {
        $env:WINPLATE_BACKEND_PORT = [string]$probePort
        $env:WINPLATE_DATA_DIR = $probeData
        $probeProcess = Start-Process -FilePath $backendExecutable -PassThru -WindowStyle Hidden
        $ready = $false
        for ($attempt = 0; $attempt -lt 80; $attempt += 1) {
            if ($probeProcess.HasExited) {
                throw "The standalone WinPlate backend exited before becoming healthy."
            }
            try {
                $health = Invoke-RestMethod -Uri "http://127.0.0.1:$probePort/api/health" -TimeoutSec 1
                if ($health.status -eq "ok") {
                    $ready = $true
                    break
                }
            } catch {
                Start-Sleep -Milliseconds 250
            }
        }
        if (-not $ready) {
            throw "The standalone WinPlate backend did not become healthy on 127.0.0.1:$probePort."
        }
    } finally {
        Stop-BuiltBackendProcesses
        [Environment]::SetEnvironmentVariable("WINPLATE_BACKEND_PORT", $previousPort, "Process")
        [Environment]::SetEnvironmentVariable("WINPLATE_DATA_DIR", $previousDataDirectory, "Process")
    }
}

Write-Host "Built and verified $backendExecutable"
