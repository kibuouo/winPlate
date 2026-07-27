# Notification Center

Every notification source enters through `NotificationManager`. The local API manager owns persistence, import tracking, and read/clear mutations; the core manager owns the versioned v1 contract and semantic normalization. Mail, QWeather, Codex, ChatGPT, GitHub, system imports, IPC, detail views, digests, and renderer lists must not maintain source-specific write or classification paths.

The manager emits one canonical display tier in `meta.alertColor`: red is `危急`, yellow is `预警`, blue is `提示`, and green is `普通`. QWeather red alerts map to red; both orange and yellow alerts map to yellow; blue alerts map to blue; green or resolved alerts map to green. Mail always maps to blue. Routine and successful non-mail notifications map to green. The renderer consumes this field and never infers a tier from titles, raw severity metadata, or source-specific payloads.

The v1 contract preserves source identity, deduplication key, timestamp, unread state, metadata, and safe actions. Weather resolution is never promoted into a new high-risk alert.

The digest pipeline deduplicates by source and key, groups related unread items, and selects the highest semantic severity. AI summaries are optional. When unavailable, disabled, or invalid, the deterministic local digest is the complete fallback; notification handling must not depend on a remote model.

Icons use platform-neutral semantic keys from `packages/icons`. Electron owns SVG rendering under `packages/icons/electron`; native Apple clients will map the same keys to SF Symbols when their UI is implemented. Arbitrary SVG or model-supplied markup is never rendered.
