# Whole maintenance round review

Scope: all ten findings in the initial maintenance review, including the
subsequent requests to proceed one by one and avoid low-value new tests.
Reviewed baseline: `deee6f1` plus the current maintenance working tree.
This is a status ledger, not a claim that all findings are resolved.

| Initial finding | Reviewed result and remaining acceptance |
| --- | --- |
| 1. Build dependency vulnerabilities | OPEN. The previous full audit found two high indirect development dependencies, `@xmldom/xmldom` and `js-yaml`. Runtime audit passed. A compatible dependency update and Windows packaging verification are still needed; recording an exception does not fix the vulnerabilities. |
| 2. Missing CI | Restored. Remote run 35686404573 at `deee6f1` passed Windows and macOS; iOS failed before compilation. This working tree removes the incompatible `-derivedDataPath` argument from the target-based iOS build. The corrected job needs a new remote run. |
| 3. Incomplete default check | Complete. Root `check` covers frontend and backend; `windows:test` delegates to it. The existing full suite passed 421 tests. |
| 4. Toolchain contract | Implemented. Node 22 / Python 3.12 version files drive CI, root engines declare Node/npm minimums, and README documents native platform requirements. The baseline remote Windows/macOS run validates the pinned environment. |
| 5. SQLite migrations | Implemented in `database.py` and called from backend initialization. Numbered migrations, transaction rollback, future-version rejection, legacy preservation and idempotency have existing tests. |
| 6. Large files | PARTIAL. Network presentation, heart trend calculations, capsule CSS and database migrations have separate boundaries. Renderer `app.js`, backend `main.py`, backend tests and macOS `Services.swift` remain large. Initial guidance was incremental domain extraction, not a wholesale rewrite; those remaining files are not claimed resolved. |
| 7. iOS logic tests | OPEN. Simulator compilation is not XCTest coverage. No XCTest target was added. Any future tests should cover meaningful protocol/outbox regression cases, consistent with the user's instruction against low-value tests. |
| 8. macOS continuous build/test | Baseline native Swift tests passed remotely. Canonical bundle signing, installation and real-device checks remain separate release acceptance steps; no native macOS source was changed in this maintenance working tree. |
| 9. Dependency maintenance policy | npm/pip weekly Dependabot configuration and review policy are present locally; Python runtime grouping excludes PyInstaller. Runtime auditing is already in CI. `SECURITY.md` documents actual API, health-data and secret-storage boundaries. New automation still needs publication to the default branch. |
| 10. Verification documentation | Three historical records are archived and linked; current environment/results are recorded separately. Archive contents were compared with original Git records, allowing updated archive references and trailing whitespace. |

The final whole-round `npm audit --json` also returned the same two high
findings and `fixAvailable: true` for each. Registry lookup returned
electron-builder 26.15.3 and plist 5.0.0 (xmldom ^0.9.10). The earlier claim
that a fix must wait for upstream is not established; a compatible update
has not yet been verified locally.

## Remote evidence

[GitHub Actions run 35686404573](https://github.com/kibuouo/winPlate/actions/runs/35686404573)
is for `deee6f1d5e66d6a8f4c83234508b47c10d56a0a7`, not the uncommitted
maintenance changes. Windows repository checks and macOS repository/native
tests passed. iOS exited 64 with:

```text
The flag -scheme, -testProductsPath, or -xctestrun is required when specifying -derivedDataPath.
```

Removing `-derivedDataPath` retains the explicit project, target, simulator
SDK and disabled signing without relying on an unshared scheme.

## Publication follow-up

Maintenance commit `9f863bc` was pushed to `main`. Dependabot update runs
started for that commit, confirming that the configuration was picked up.
[Run 35688851456](https://github.com/kibuouo/winPlate/actions/runs/35688851456)
passed the previous argument error but exposed an additional iOS toolchain
mismatch: Xcode 15.4 on `macos-14` cannot read project objectVersion 71.
The follow-up changes the iOS runner to `macos-latest`, matching the macOS
job's runner family. Its actual Xcode version remains printed in CI logs.
This section supersedes the pre-publication state recorded above.

## Verification and publication boundary

The latest full local code suite passed 421 tests; the final configuration and
documentation review also checked YAML structure, stylesheet equivalence,
renderer resource paths and load order, archive preservation, and whitespace.
The whole-round review additionally confirmed `pip check` and the installed
workspace dependency listing pass. See the
[current-version record](2026-09-22-current-version.md) for environment details.

No new test files were added during closeout. No release installation, remote
push, or new CI success is implied by this local review. Remaining open rows
above must stay open until their acceptance evidence exists.
