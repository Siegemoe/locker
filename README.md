# Spore Locker

Spore Locker is a local-first advisory and information-sharing workspace for
tasks, project context, artifacts, and durable history. It serves an interactive
desktop UI and a detached MCP surface through the same backend service layer;
it is not an agent runner, delegation system, or workflow runtime.

## What is included

- Next.js app and API routes
- PostgreSQL 17 development service via Docker Compose
- Prisma data model and checked-in initial migration
- Managed projects, explicit multi-tags, task artifacts, immutable activities,
  and optimistic task-versioning
- Actor-aware task service shared by UI and AI-facing HTTP endpoints
- Local development identity boundary and bearer-token boundary for HTTP API tools
- Seed data for the first Spore Locker board

## Docker Desktop runtime

The ready-to-use topology is an isolated Compose project named
`spore-locker-isolated`. It owns its PostgreSQL user, database, private internal
network, and named data volume. PostgreSQL is not published to the host. Only
the preview (`127.0.0.1:3000`) and MCP endpoint
(`127.0.0.1:8787/mcp`) are reachable from this machine. Spore Locker does not
inspect, share, or depend on another local database stack.

Double-click `Start Spore Locker.cmd` to build or start the isolated stack and
open the preview. The launcher reads the gitignored `.env.compose`, does not
print its database credential, requests no elevation, and targets only the
`spore-locker-isolated` Compose project.

The containers use `restart: unless-stopped`, so they resume after the Docker
engine starts. Docker Desktop itself must still be running. Enable **Start
Docker Desktop when you sign in** in Docker Desktop for automatic resume after
Windows login; otherwise open Docker Desktop or run the launcher manually.

### Private phone access with Tailscale

The optional `tailscale` service creates a dedicated `spore-locker` machine on
the user's tailnet. It runs the official pinned Tailscale image in userspace
mode, persists its identity in the isolated
`spore_locker_isolated_tailscale_state_v1` volume, and uses HTTPS Serve to proxy
only to `http://app:3000` on the Spore Locker host network. It publishes no host
port, advertises no subnet route or exit node, disables Funnel, and has no
access to the private Postgres network or the MCP container.

Before first start:

1. Ensure MagicDNS and HTTPS certificates are enabled for the tailnet.
2. Define `tag:spore-locker` in the tailnet policy and allow the intended phone
   user/device to reach that tag on TCP 443.
3. Generate a reusable, pre-authorized, non-ephemeral auth key tagged
   `tag:spore-locker`.
4. Add `TS_AUTHKEY="..."` to the gitignored `.env.compose`. Do not commit or
   paste the key into logs.
5. Start only the sidecar with
   `docker compose --env-file .env.compose up -d tailscale`.

After authentication, read the machine's MagicDNS name from the Tailscale admin
console or `docker compose exec tailscale tailscale status`. The phone URL is
`https://<that-machine-name>.<tailnet>.ts.net/`. The sidecar uses
`restart: unless-stopped`; it resumes after Docker Desktop starts.

Useful commands:

```powershell
pnpm check
pnpm build
pnpm verify:lifecycle
pnpm verify:mcp
```

## Lifecycle API boundary

- `GET /api/workspaces/:workspaceId/tasks`
- `POST /api/workspaces/:workspaceId/tasks`
- `PATCH /api/tasks/:taskId`
- `POST /api/tasks/:taskId` with `{ "version": 3, "action": "approve" | "archive" | "restore" }`

An AI client authenticates with `Authorization: Bearer <AI_TOOL_TOKEN>` and may
set `X-Spore-Actor` to a human-readable tool name. All writes go through the
same task service and emit immutable actor-labeled activity records. AI tools
can capture, define, stage, execute, and complete work, but `approve` is rejected
unless the caller is a human actor. Archive is only allowed after approval.
Production exposure requires a
real session/identity provider plus workspace authorization checks.

## Projects, tags, activity, and context

The preview includes a Projects & Tags manager. Project deletion is intentionally
limited to projects with zero referencing tasks; populated projects can be
archived or have their tasks reassigned first. Task tags are explicit many-to-many
records and drive filtering and grouping in both the gallery and inline card.
The Activity view reads the append-only audit stream and filters by project,
tag, task, actor, action family, and time.

Task context supports HTTP(S) links (including Excalidraw), text or Markdown up
to 100,000 characters, and file metadata for PDF, plain text, Markdown, PNG,
JPEG, and WebP up to 25 MiB. File bytes are not uploaded yet and raw local paths
are never accepted. A dedicated isolated Docker volume,
`spore_locker_isolated_artifacts_v1`, is reserved as the future managed storage
root. Enabling binary upload still requires the narrow decision to implement an
authenticated upload/download route with server-generated storage keys,
content validation, and retention behavior.

## MCP Apps plugin

The personal plugin package under `plugins/spore-locker` registers twelve tools
and an MCP Apps inline UI card. The surface supports filtered task discovery,
full task context, read-only project/tag structure, safe text/link/file metadata,
portable workspace-relative references, filtered activity, and evidence-rich
completion handoffs. Completion submission marks a task `DONE`, creates a durable
handoff artifact, and leaves approval to the human-facing standalone Locker.
The MCP never records human approval.

This MCP is currently unauthenticated and should be treated as a local detached
advisory tool. It may capture or organize information only when the user asks;
it does not grant delegated authority, execute work, or act as a workflow
runtime. Project and tag creation, renaming, and archival remain in the
human-facing Locker; MCP can discover all structure and assign existing values
to tasks.

The local plugin connects to `http://127.0.0.1:8787/mcp`. A public HTTPS tunnel
may be configured separately, but remote ChatGPT registration should wait for
OAuth 2.1 protected-resource discovery and per-request access-token validation.
