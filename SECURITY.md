# Security boundaries

WinPlate is a local desktop application. Its FastAPI backend binds to
`127.0.0.1:8765`; do not expose that API through public port forwarding or a
reverse proxy. Loopback access is not an authentication boundary against
other processes running as the same user.

The Windows health receiver is a separate LAN listener. It accepts health
uploads using `x-winplate-health-token`, limits request bodies to 64 KiB, and
uses a private-network firewall rule. Its HTTP transport is not encrypted:
use a trusted private network, do not publish its port, and treat the pairing
payload as a secret. Token authentication does not provide confidentiality.

Windows service secrets and health pairing tokens use Electron `safeStorage`
for encryption at rest. macOS stores sensitive settings in the consolidated
Keychain item `sensitive-values-v1`. Stored secrets must not be displayed in
settings forms or included in logs, screenshots, issues, or verification
records. These mechanisms do not protect an already compromised user session.

Health snapshots, local mail caches, and SQLite data can contain private
information; they are not all encrypted by the secret storage mechanisms.
Do not attach real application databases or health payloads to bug reports.
Use synthetic data and redact tokens, email content, and identifying details.

For dependency update and advisory handling, see
[dependency maintenance](docs/dependency-maintenance.md). A clean runtime
audit does not imply that the build toolchain is free of vulnerabilities.

If reporting a security issue, provide affected versions and reproduction
steps with synthetic data. Use the repository's private vulnerability report
feature if available; do not post secrets or exploit details in a public
issue. No separate security mailbox or response SLA is established here.
