# Contributing to Spore Locker

## Development setup

Use Node.js 22 or 24 and the pnpm version declared in `package.json`.

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm setup:local
docker compose --env-file .env.compose up -d --build
```

Local configuration belongs in ignored `.env` or `.env.compose` files. Never
commit tokens, database passwords, tunnel credentials, machine-specific paths,
or generated database and artifact volumes.

## Before opening a pull request

```powershell
pnpm check:repo
pnpm check
pnpm build
```

Changes to Prisma models must include a checked-in migration and regenerated
client validation. Service behavior should remain shared across UI, HTTP, CLI,
and MCP adapters rather than being implemented independently in each surface.

Behavioral verification uses the isolated Compose database:

```powershell
pnpm verify:compose
```

The lifecycle, MCP, and Journal verifiers may also be run inside the appropriate
Compose service when a host PostgreSQL instance is unavailable.

## Trust boundary

Keep the HTTP MCP endpoint bound to loopback. Do not add a public tunnel or
public bind until authenticated request identity and workspace authorization are
implemented and tested. Preserve optimistic concurrency, actor attribution,
append-only history, and recoverable archival for autonomous changes.
