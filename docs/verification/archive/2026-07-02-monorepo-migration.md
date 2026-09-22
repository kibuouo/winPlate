# Monorepo migration acceptance

Accepted locally on 2026-07-02 (Asia/Shanghai) from `codex/monorepo-migration` at `19cdd26`.

## Fresh acceptance

- `npm ci`: passed; 66 packages installed, 0 vulnerabilities.
- `npm run check`: passed, including 249 Windows workspace tests, 58 macOS transition tests, 11 core tests, 4 shared-contract tests, 2 icon tests, 5 layout tests, and 4 Python-launcher tests.
- `npm run backend:test`: passed, 55 tests.
- `git status --short`: clean before this acceptance record was added.

## Retained history

`git merge-base --is-ancestor origin/codex/macos-menu-bar HEAD` exited 0. The right side of `git log --left-right --cherry-pick --oneline HEAD...origin/codex/macos-menu-bar` was empty, so every commit from the retired branch is retained by the migration branch.

The migration may be merged to `main`, verified again, and pushed. The remote `codex/macos-menu-bar` branch may be deleted only after the pushed `main` passes CI.
