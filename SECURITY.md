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
- The app and MCP host ports bind to `127.0.0.1` by default. The MCP server
  listens on loopback for direct runs and rejects requests whose `Host` header
  is outside `127.0.0.1`/`localhost` on the listening port. The Compose service
  sets `MCP_HOST=0.0.0.0` because docker-proxy reaches the container over its
  network address rather than its loopback; the published host port stays
  pinned to `127.0.0.1`.
- The HTTP MCP endpoint currently has no request authentication and must not be
  exposed through a public tunnel, public bind, or port-forward.
- Tailscale access is optional and proxies only the app UI over HTTPS; it does
  not route MCP or PostgreSQL. With `LOCAL_UI_ENABLED=true` the app UI and its
  API are full write authority (including approvals) without a login, so the
  tailnet ACL is the only control guarding that path.
- Attribution is trusted-local. Journal `authorKey`/`authorLabel` are
  caller-supplied, so a local MCP client can write under another agent's name;
  the `USER_DECISION` role is restricted to the human UI, and AI tools cannot
  mark a task DONE directly — they must record a completion handoff.
- Real remote deployment requires OAuth 2.1 protected-resource discovery,
  per-request access-token validation, and workspace authorization.
- Secrets belong only in ignored local environment files or an external secret
  manager. Never paste them into issues, logs, fixtures, or documentation.
