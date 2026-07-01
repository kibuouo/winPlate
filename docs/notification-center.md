# Notification Center

Notification inputs are normalized into the versioned v1 contract before grouping or summarization. The contract preserves source identity, deduplication key, timestamp, unread state, metadata, and safe actions.

Priority and color grading are semantic: `critical` is immediate risk, `warning` needs attention, `success` records resolution or reduced risk, and `info` is routine context. Weather resolution is never promoted into a new high-risk alert.

The digest pipeline deduplicates by source and key, groups related unread items, and selects the highest semantic severity. AI summaries are optional. When unavailable, disabled, or invalid, the deterministic local digest is the complete fallback; notification handling must not depend on a remote model.

Icons use platform-neutral semantic keys from `packages/icons`. Electron owns SVG rendering under `packages/icons/electron`; native Apple clients will map the same keys to SF Symbols when their UI is implemented. Arbitrary SVG or model-supplied markup is never rendered.
