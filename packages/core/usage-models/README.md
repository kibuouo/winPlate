Usage model rules live here when they are pure enough to share across platforms.

Keep this package area free of Electron, filesystem, backend, and platform UI
dependencies. Platform adapters should translate local runtime data into these
models instead of importing platform code into core.
