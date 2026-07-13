# Notification Timeline Emphasis Design

## Goal

Make the Notifications timeline use a compact, date-scoped vertical rail and make warning and urgent items immediately distinguishable.

## Layout

Each date group owns one narrow vertical rail.  The rail begins at the first event dot and ends at the last event dot, so it does not run through date separators.  Event dots remain immediately left of the source icon; the existing content, filtering, selection, and detail expansion markup stay unchanged.

## Severity emphasis

`warning` rows use amber dots, a subtle amber leading inset, and an amber severity label.  `danger` and `critical` rows use the same treatment in red.  Hover and selection use their existing behavior in addition to the severity treatment.

## Validation

Extend the renderer style contract test, first observe its failure, then run the focused Electron renderer test after the CSS change.
