# Security policy

## Supported version

Spore Locker is pre-release software. Security fixes are applied to the latest
commit on the default branch.

## Reporting a vulnerability

Do not open a public issue for credentials, authentication bypasses, data
exposure, or remote-code-execution findings. Use GitHub private vulnerability
reporting when it is enabled for the repository, or contact the repository owner
privately before sharing reproduction details.

## Deployment boundary

- PostgreSQL must remain on the internal Compose network.
- The app and MCP host ports bind to `127.0.0.1` by default.
- The HTTP MCP endpoint currently has no request authentication and must not be
  exposed through a public tunnel, public bind, or port-forward.
- Tailscale access is optional and exposes only the app UI over HTTPS; it does
  not route MCP or PostgreSQL.
- Real remote deployment requires OAuth 2.1 protected-resource discovery,
  per-request access-token validation, and workspace authorization.
- Secrets belong only in ignored local environment files or an external secret
  manager. Never paste them into issues, logs, fixtures, or documentation.
