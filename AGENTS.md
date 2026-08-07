# WinPlate Repository Instructions

## macOS Application

- Maintain exactly one launchable WinPlate application:
  `~/Applications/WinPlate.app`.
- Always build and install it with:
  `apps/macOS/WinPlate/scripts/make-app.sh`.
- `apps/macOS/WinPlate/.build/WinPlate.app` must remain a symlink to
  `~/Applications/WinPlate.app`; never replace it with a second app bundle.
- The SwiftPM executable under `.build/*/debug/WinPlate` is a build artifact
  only. Never launch it as the user-facing application and never tell the user
  to use it as an application entry point.
- Do not create, copy, or launch additional `WinPlate.app` bundles elsewhere
  in the repository, `/tmp`, Desktop, Downloads, or another Applications
  directory.
- Preserve the bundle identifier `com.kiko.winplate` so existing macOS
  Keychain configuration remains available.
- Keep the local API and Python dependencies embedded in the installed app;
  the installed app must not execute backend files from the repository in
  Documents.
- Load sensitive settings from the consolidated `sensitive-values-v1`
  Keychain item. Do not restore per-secret startup reads that cause repeated
  password prompts.

## Required macOS Workflow

After changing the native macOS client:

1. Run `apps/macOS/WinPlate/scripts/test.sh`.
2. Run `apps/macOS/WinPlate/scripts/make-app.sh`.
3. Verify `~/Applications/WinPlate.app` with
   `codesign --verify --deep --strict`.
4. Confirm `.build/WinPlate.app` resolves to the canonical installed app.
5. Launch only `~/Applications/WinPlate.app`.
6. Confirm both WinPlate and its local API on `127.0.0.1:8765` are running.

If an old WinPlate or local API process is present, stop the stale process
before launching the canonical app. Never solve a version mismatch by
producing another app bundle.

## Settings UI Invariants

- Keep DeepSeek, QWeather, and QQ Mail in the same native card-based visual
  style. Do not restore the legacy grouped `Form` settings layout.
- QWeather must have exactly one action button. It validates saved values when
  the form is unchanged and saves then validates when the user enters changes.
- QQ Mail must have exactly one action button. It tests the saved connection
  when the form is unchanged and saves then tests when the user enters changes.
- Never reintroduce separate "test saved" and "save and test" buttons.
- Every stored sensitive field must remain blank while showing
  "已配置，重新填写可覆盖" (or the equivalent private-key message). Never
  reveal the stored secret in the form.

## Git Commit and Push Requirements

- For the Windows health-data synchronization change, use the commit message
  `update:完善Windows版健康数据同步`.
- Publish this change directly to `main` after validation; do not open a pull
  request unless the user explicitly asks for one.
- Preserve unrelated changes already present on the remote `main` when
  rebasing or resolving conflicts.
- Before pushing, run the relevant Windows, iOS, and macOS checks and verify
  that the working tree and the final commit are the intended ones.
