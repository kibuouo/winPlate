# Sidebar Codex SVG rollback

## Goal

Restore the previous monochrome inline SVG for the Codex entry in the main
application sidebar. Keep the current colored Codex asset in every other
surface, including notification icons and page-level Codex content.

## Approaches considered

1. Recommended: introduce a sidebar-only SVG constant containing the exact
   pre-`59123f5` cloud-and-terminal paths. Use it only when the navigation item
   is `Codex`.
2. Revert the shared Codex notification icon. This would also change notification
   and content surfaces, outside the requested scope.
3. Use CSS to recolor the shared gradient icon. This cannot reliably remove the
   SVG's white terminal stroke and would couple the sidebar to asset internals.

## Design

Keep `codexIcon` mapped to the existing shared colored icon. Add
`sidebarCodexIcon` with the historical inline SVG and select it only in the
main sidebar navigation renderer. The SVG inherits `currentColor`, preserving
the existing active, hover, and theme styling.

## Regression coverage

Extend the existing renderer source test to assert the historical paths are
defined in `sidebarCodexIcon`, selected for the sidebar's `Codex` item, and not
used as the general `codexIcon` value.
