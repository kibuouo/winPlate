# Notification Center

Notification inputs are normalized into the versioned v1 contract before grouping or summarization. The contract preserves source identity, deduplication key, timestamp, unread state, metadata, and safe actions.

## Level vs display severity

- **Storage level** (`info` | `success` | `warning` | `critical`) records lifecycle and source intent. `critical` is immediate risk, `warning` needs attention, `success` records resolution or reduced risk, and `info` is routine context.
- **Display severity** (`info` | `warning` | `danger`) drives colors and digest grading on every client. The local API computes `severity` on each `/api/notifications` item with the same rules as `packages/core` (`severityForNotification`). Weather resolution is never promoted into a high-risk alert (`severity` stays `info`).

### Unified display labels (all surfaces)

| severity | color | label |
| --- | --- | --- |
| `info` | green | 信息 |
| `warning` | amber | 预警 |
| `danger` | red | 危险 |

Do not use alternate labels such as 提醒, 紧急, or 完成 for notification grading. Storage-only values map into this vocabulary when shown (`success` → 信息, `critical` → 危险).

### Weather color band

Windows weather cards and notification grading share the same band:

| QWeather color / title cue | storage `level` | display `severity` | UI |
| --- | --- | --- | --- |
| `red` / `extreme` / `severe` / 红色预警 | `critical` | `danger` | 红 · 危险 |
| `orange` / `yellow` / `blue` / 橙黄蓝预警 | `warning` | `warning` | 橙 · 预警 |
| resolved lifecycle | `success` | `info` | 绿 · 信息 |

Orange is **not** red danger. Only exact metadata `severity: red` still requires acknowledgement / time-sensitive interruption.

Platform clients must consume API `severity` for UI emphasis and must not invent a second grading table. `packages/core` keeps a local fallback for offline/unit paths and prefers the API value when present.

The digest pipeline deduplicates by source and key, groups related unread items, and selects the highest semantic severity. AI summaries are optional. When unavailable, disabled, or invalid, the deterministic local digest is the complete fallback; notification handling must not depend on a remote model.

Icons use platform-neutral semantic keys from `packages/icons`. Electron owns SVG rendering under `packages/icons/electron`; native Apple clients map the same semantic emphasis using platform-native symbols. Arbitrary SVG or model-supplied markup is never rendered.
