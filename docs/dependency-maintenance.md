# Dependency maintenance

WinPlate uses automated dependency update pull requests, but does not enable
blind auto-merge for application or packaging dependencies. Every update must
pass the repository checks and be reviewed for platform packaging impact.

## Automation

- `.github/dependabot.yml` checks npm workspaces and the local API's pip build
  and runtime requirements every Monday.
- Dependabot groups normal production updates separately from the Electron
  packaging toolchain and backend build tooling, so a packaging change is
  visible instead of being hidden in a large mixed update.
- The Windows and macOS CI jobs run `npm run audit:runtime` after installation.
  This is the release-relevant audit: it must remain at zero vulnerabilities.
- The same CI jobs run the full JavaScript, workspace, backend, and native
  macOS checks after dependency installation.

## Review policy

1. Review the generated lockfile together with the manifest change.
2. Run the Windows packaging path for Electron, Python, and the local API when
   a build dependency changes.
3. Run the macOS packaging workflow after native or embedded-runtime changes.
4. Treat production dependency advisories as blocking until fixed or replaced.
5. Treat development-only packaging advisories as a tracked exception only
   when the affected package is not shipped and the runtime audit remains
   clean; re-evaluate the exception on every Dependabot update.

## Current exception

As of the current maintenance pass, the full npm audit reports two high
severity advisories in the Electron packaging chain: `@xmldom/xmldom` and
`js-yaml`. They are indirect development dependencies of `electron-builder`.
Earlier automatic-fix and override attempts did not produce a validated clean
dependency tree. The final review still finds both advisories, with npm
reporting `fixAvailable: true`; this is not evidence that a compatible fix is
impossible. The registry reports electron-builder 26.15.3 and plist 5.0.0,
whose xmldom dependency is ^0.9.10. Updating the relevant dependency tree still
requires compatibility and Windows packaging verification before closure.
Dependabot provides update proposals; it does not resolve this open finding
by itself. The shipped runtime audit is currently clean.
