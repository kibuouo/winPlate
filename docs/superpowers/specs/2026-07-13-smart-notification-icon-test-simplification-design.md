# Smart notification icon test simplification

## Goal

Reduce maintenance-heavy tests while retaining coverage of the public icon-key
and renderer behavior relied on by notification consumers.

## Scope

- Remove `packages/core/notification/smartNotificationIconKeys.test.js` and
  its `packages/core` test-script entry. The production module is a direct
  re-export of the icons package, so this test does not exercise core logic.
- Replace the contents of `packages/icons/architecture.test.js` with focused
  public-contract tests:
  - invalid icon keys are rejected and fall back to `bell` during rendering;
  - every published icon key has a renderer entry and can produce an SVG;
  - a representative notification resolves to its intended semantic icon.

## Non-goals

- Do not change icon keys, SVG markup, notification-resolution rules, or
  renderer implementation.
- Do not assert a fixed icon count or scan source files for implementation
  details such as identifiers, folders, or markup fragments.

## Verification

Run the `@winplate/core` and `@winplate/icons` workspace test commands. These
cover the removed script entry and the simplified public renderer contracts.
