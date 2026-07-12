# Notification Inline Summary Redesign

**Status:** awaiting user review
**Date:** 2026-07-12

## Goal

Refine the expanded state of the Notifications timeline so it reads as a
compact inline summary, matching the supplied reference instead of opening a
large nested detail card. Restore clear, source-specific visual identity for
Codex, GitHub, mail, and QWeather notifications.

## Scope

This change is limited to the Notifications timeline row, its selected inline
summary, and source icon presentation. The sidebar, title bar, filters,
read-state API, safe detail-action API, red-weather acknowledgement modal, and
date grouping remain unchanged.

## Selected-row layout

The selected timeline row remains in place and gains a compact summary directly
under its message preview:

- align the summary with the row's content column, leaving the timeline dot and
  vertical rule unobscured;
- use a thin blue outline, small radius, and a quiet blue-tinted background;
- show the selected notification's concise body text only, clamped to two
  lines at normal width;
- render available safe actions on the right: the existing navigation action
  is labelled “打开来源”, and the existing mark-read action is labelled
  “标记已读” or “已读”;
- omit the duplicate heading, source/state/level/identifier metadata block,
  large text container, and footer spacing from this inline state;
- preserve loading and error/retry states in the same compact container; a
  failed request exposes only its concise message and retry action.

Long-form content and operational metadata remain available through the safe
detail payload but are intentionally not rendered in the timeline's expanded
state. This keeps the timeline a scanning surface rather than a nested detail
page.

## Source icons

Every timeline row uses a compact 40px circular source icon between the timeline
dot and text content. It is decorative (`aria-hidden`) because the adjacent
source label supplies the accessible name.

- Codex uses the existing `code` smart-notification icon on a soft blue
  surface.
- GitHub uses the existing `github` icon on a neutral graphite surface.
- Mail uses the existing `mail` icon on a slate surface.
- QWeather uses the existing `cloud-rain-alert` icon on a soft emerald surface.
- Unknown sources use the existing `bell` icon and neutral surface.

No handwritten SVGs, new image assets, or dependencies are introduced. The
existing whitelisted icon renderer remains the only icon source.

## Accessibility and interaction

- The selected row retains its button and `aria-expanded` state.
- The inline summary becomes a labelled detail region; its action buttons keep
  their existing keyboard behavior and safe action identifiers.
- Icon circles never carry the only source or severity information.
- The timeline's narrow breakpoint keeps the icon and summary in normal flow;
  actions wrap below summary text rather than overflowing horizontally.

## Verification

Automated coverage will verify:

1. A selected timeline item emits the compact summary region rather than the
   previous metadata-card structure.
2. Body text and action labels are escaped and retain the safe action IDs.
3. Each known source maps to the intended whitelisted icon key and source-icon
   class; unknown sources fall back to `bell`.
4. Compact-summary and source-icon styles cover desktop, narrow layout, focus,
   and dark/light contrast.
5. Existing notification selection, mark-read, navigation, and renderer unit
   coverage continue to pass.
