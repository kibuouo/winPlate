# Dependency security maintenance - 2026-10-16

## Scope and baseline

The remote `main` baseline was `3ec27567578894016e31ef7eed8923b634ea2cdc`.
An isolated audit of that commit's manifests and lockfile reported 15 affected
npm packages: seven high and eight moderate. The initial working tree already
contained uncommitted fixes for xmldom and js-yaml and reported 13; those two
fixes are included in this dependency update.

The baseline's Windows, macOS, and iOS GitHub Actions checks had passed.
This maintenance addresses dependency security findings rather than a failing
application test. GitHub's Dependabot alerts API was unavailable for this
repository, so the findings were reproduced directly with `npm audit`.

## Changes

Compatible updates in the lockfile include:

| Package | Baseline | Validated resolution |
| --- | --- | --- |
| electron-builder | 26.15.3 | 26.17.0 |
| global-agent | 3.0.0 | 4.1.3 |
| @xmldom/xmldom | 0.8.13 | 0.8.15 |
| js-yaml | 4.3.1 | 4.3.2 |
| fast-uri | 3.1.6 | 3.1.8 |
| http-cache-semantics | 4.2.0 | 4.3.0 |
| source-map-js | 1.2.1 | 1.2.2 |
| undici 6.x / 7.x | 6.28.0 / 7.29.0 | 6.29.1 / 7.30.1 |
| brace-expansion 1.x / 2.x / 5.x | 1.1.18 / 2.1.4 / 5.0.9 | 1.1.21 / 2.1.7 / 5.0.12 |

The manifest's existing Electron 44.4.3 pin is now represented accurately in
the lockfile. The Electron binary and Python requirement ranges are unchanged.

`@electron/get` 3.1.0, used by electron-builder, optionally depends on
global-agent 3, which pulls in roarr 2 and sprintf-js. The
[sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
has no patched release. A root npm override scopes global-agent `^4.1.3` to
`@electron/get@3`, removing roarr and sprintf-js from this chain. Version 4
retains the `bootstrap()` API used by the downloader. The override does not
replace the separate `@electron/get` 5 dependency used by Electron itself.

Remove this override when electron-builder's downloader no longer requests
the affected global-agent 3 chain, then repeat the proxy and packaging checks.
Do not use the audit's suggested electron-builder downgrade merely to remove
the report.

## Validation

- `npm ci`: clean installation succeeded.
- `npm ls --all --json`: dependency tree valid.
- `npm run audit:runtime`: zero vulnerabilities.
- `npm run audit:all`: zero vulnerabilities, including build and test packages.
- `npm run windows:test`: JavaScript, workspace, and 111 backend tests passed.
- `scripts/dependencyProxy.test.js`: the builder's actual downloader retrieved
  an artifact through a loopback HTTP proxy and verified its SHA-256 checksum.
  The mirror hostname is deliberately unresolvable without the proxy.
- `apps/Windows/scripts/make-app.ps1 -SkipTests -SkipInstall -SkipLaunch`:
  the standalone backend probe passed and electron-builder 26.17.0 produced
  `apps/Windows/dist/WinPlate-Setup-0.3.0.exe`. The packaged renderer matched
  the source, and the runtime archive excluded the build proxy dependency
  chain. This validation did not replace the running installed application.

Windows and macOS CI now run the full audit as well as the runtime audit.
The proxy compatibility test is part of `npm run test:tooling`, which both
jobs execute. The iOS simulator compile remains in the same workflow.

Audit results describe the registry advisory data available on 2026-10-16;
future dependency updates must repeat these checks.
