# Current version validation record

Verification date: 2026-09-22 (Asia/Shanghai)

Repository baseline: `deee6f1` (`main` / `origin/main`). This record covers
that baseline plus the maintenance changes currently in the working tree. It
is a new record; historical reports are preserved in
[`archive/README.md`](archive/README.md).

## Environment

| Item | Value |
| --- | --- |
| Host | Windows |
| Node.js | `v26.7.0` |
| npm | `11.19.0` |
| Python | `3.14.7` |
| CI baseline | Node.js 22 from `.node-version`; Python 3.12 from `.python-version` |

The local host is not the pinned CI baseline. The CI workflow remains the
authoritative Node/Python compatibility check.

## Executed checks

| Command or check | Result |
| --- | --- |
| `npm run check` | PASS — 421 checks: 4 tooling, 262 Windows workspace, 6 layout, 31 core, 5 shared-types, 2 icons, and 111 Python backend tests |
| `npm run audit:runtime` | PASS — 0 runtime vulnerabilities |
| Full `npm audit` | 2 high indirect development-only findings: `@xmldom/xmldom` and `js-yaml` in the Electron packaging chain |
| CSS split concatenation check | PASS — `styles-capsule.css` followed by `styles.css` matches the previous `styles.css` rule order and content |
| `.github/workflows/test.yml` YAML validation | PASS — Windows, macOS, and iOS jobs present |
| `.github/dependabot.yml` YAML validation | PASS — npm and pip update groups present |
| `git diff --check` | PASS |

## Platform checks not executable on this host

Remote evidence has now been inspected: [run 35686404573](https://github.com/kibuouo/winPlate/actions/runs/35686404573)
at baseline `deee6f1` passed Windows checks and macOS checks including native
Swift tests. The iOS job failed before compilation because `-derivedDataPath`
was combined with `-target` without a scheme. The incompatible argument is
removed locally; the corrected job has not yet run remotely. See the
[whole-round review](2026-09-22-maintenance-closeout.md) for all original findings.

- `npm run macos:test` was not run because `xcodebuild` is unavailable on
  Windows.
- The iOS Simulator compile job was not run locally; it is configured for the
  `macos-latest` GitHub Actions runner.
- A signed macOS bundle and a physical iPhone HealthKit run require the native
  Apple environment and are not represented as local Windows evidence.

## Maintenance scope verified

- The renderer capsule/status CSS now has its own stylesheet boundary while
  preserving the original CSS sequence.
- The renderer heart-rate range, axis, point, and downsampling calculations
  now live in `apps/Windows/src/renderer/healthTrend.js`; for these calculations,
  `app.js` keeps renderer-facing wrappers and markup composition.
- Dependabot is configured for npm and pip with separate runtime and build
  toolchain groups.
- Runtime dependency auditing is part of both Windows and macOS CI.
- Historical verification records are archived without rewriting their tested
  commit or environment claims.

## Final review boundaries

Publication result: maintenance commit `9f863bc` and CI toolchain fix
`af01291` were pushed to `main`. [Run 35688936049](https://github.com/kibuouo/winPlate/actions/runs/35688936049)
at `af012913531761fc994b5c3ffe441e02f04f539a` passed Windows, macOS (including
native Swift tests), and iOS Simulator compilation. This supersedes the
earlier pending remote-validation statements in this record. Dependabot
update runs started after publication; the configuration is no longer local
only. No new runtime code is included in this final documentation update.

- The Python runtime update group explicitly excludes `pyinstaller`, keeping
  it in the backend build group.
- Large-file work is partial: `app.js` is still approximately 323 KB and the
  main stylesheet approximately 189 KB. The extracted boundaries reduce
  coupling but do not constitute a complete decomposition of these files.
- Dependabot configuration remains local until published to the default
  branch. No successful remote Dependabot run is claimed by this record.
- The automated checks above do not establish visual acceptance of a running
  Electron application or successful Windows installer packaging.
