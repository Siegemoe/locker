# Spore Locker

Spore Locker is a local-first planning and information-sharing workspace for
tasks, project context, dependency plans, artifacts, and durable history. It
serves an interactive desktop UI and an MCP surface through the same backend
service layer. It gives an AI authority to make routine planning and lifecycle
decisions; it is not itself an agent runner or code-execution runtime.

## What is included

- Next.js app and API routes
- PostgreSQL 17 development service via Docker Compose
- Prisma data model and checked-in initial migration
- Managed projects, explicit multi-tags, task artifacts, immutable activities,
  dependency-aware work selection, and optimistic task-versioning
- PostgreSQL-backed multi-agent Journal with attributed Markdown contributions,
  revision history, candidate events, filtering, and full-text search
- Actor-aware task and Journal services shared by UI, HTTP, CLI, and MCP adapters
- Local development identity boundary and bearer-token boundary for HTTP API tools
- Seed data for the first Spore Locker board

## Requirements

- Node.js 22 or 24
- Corepack with pnpm 11.19
- Docker Desktop or Docker Engine with Compose v2

## Quick start

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm setup:local
docker compose --env-file .env.compose up -d --build
```

Open `http://127.0.0.1:3000`. The MCP endpoint is available only on the local
machine at `http://127.0.0.1:8787/mcp`. On Windows, `Start Spore Locker.cmd`
performs the local-secret setup, starts the same Compose project, and opens the
preview.

## Docker Desktop runtime

The ready-to-use topology is an isolated Compose project named
`spore-locker-isolated`. It owns its PostgreSQL user, database, private internal
network, and named data volume. PostgreSQL is not published to the host. Only
the preview (`127.0.0.1:3000`) and MCP endpoint
(`127.0.0.1:8787/mcp`) are reachable from this machine. Spore Locker does not
inspect, share, or depend on another local database stack.

The launcher reads the gitignored `.env.compose`, does not print its database
credential, requests no elevation, and targets only the `spore-locker-isolated`
Compose project.

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
pnpm check:repo
pnpm build
pnpm verify:lifecycle
pnpm verify:mcp
pnpm verify:journal
pnpm journal today
```

## Lifecycle API boundary

- `GET /api/workspaces/:workspaceId/tasks`
- `POST /api/workspaces/:workspaceId/tasks`
- `PATCH /api/tasks/:taskId`
- `PUT /api/tasks/:taskId/dependencies`
- `POST /api/tasks/:taskId` with `{ "version": 3, "action": "approve" | "archive" | "restore" }`

An AI client authenticates with `Authorization: Bearer <AI_TOOL_TOKEN>` and may
set `X-Spore-Actor` to a human-readable tool name. All writes go through the
same task service and emit immutable actor-labeled activity records. AI tools
can capture, define, stage, complete, approve, archive, and restore work. Archive
remains a separate recoverable step after approval, keeping closure intentional
without reserving the decision for a human. Production exposure requires a
real session/identity provider plus workspace authorization checks.

## Agent work queue and dependency planning

`get_spore_work_queue` derives four useful planning views from the canonical
task graph: priority-ranked actionable work, unblocked backlog candidates,
blocked work with its dependency context, and completed work awaiting a
lifecycle decision. `plan_spore_task_dependencies` replaces a task's explicit
`BLOCKS`, `RELATES_TO`, and `DUPLICATES` edges using optimistic versioning.
Cross-workspace references, archived targets, self-dependencies, duplicate
edges, and blocking cycles are rejected. These are integrity constraints, not
approval gates; the AI decides the plan and the activity stream records it.

## Multi-agent Journal

The Journal is a bounded service inside Locker's modular application. It uses
the same PostgreSQL database, Prisma client, transaction conventions, actor
identity, activity trail, Compose lifecycle, and MCP server as task planning.
It is not a second deployable or datastore.

Each workspace has at most one `JournalEntry` per date. ChatGPT, Codex Desktop,
Hermes, or another stable `authorKey` may each own one attributed Markdown
contribution for that day. Updates require optimistic versions and append
immutable contribution revisions. Finalization locks the day; changed opinions
belong in later dated entries instead of silently rewriting history.

Candidate events provide a lightweight importance hook for decisions,
realizations, milestones, disagreements, failures, completions, and evidence.
PostgreSQL full-text search returns original contribution or candidate passages
and supports date, author, topic, project, and importance filters. PostgreSQL is
canonical; every entry also has a deterministic Markdown rendering for export
and long-term inspection. See `docs/journal-architecture.md`.

The Journal UI is part of the standalone Locker. Local agents can use
`pnpm journal`; ChatGPT and other MCP-native clients use the six Journal tools
registered by the existing Locker MCP process.

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

The personal plugin package under `plugins/spore-locker` registers twenty-one tools
and an MCP Apps inline UI card. The surface supports filtered task discovery,
full task and dependency context, a derived agent work queue, read-only
project/tag structure, safe text/link/file metadata, portable workspace-relative
references, filtered activity, and evidence-rich completion handoffs. Completion
submission marks a task `DONE` and creates a durable handoff artifact. Approval
is a separate MCP action so the deciding actor remains explicit in history. Six
additional tools read, search, contribute to, flag events for, reflect over, and
finalize the multi-agent Journal.

This MCP is currently unauthenticated and must remain local. The repository does
not include a public-tunnel service. Any remote deployment must first implement
OAuth 2.1 protected-resource discovery, per-request access-token validation, and
workspace authorization. MCP grants delegated planning and task-lifecycle
authority but does not itself execute code or act as a workflow runtime. Project
and tag administration remains in the standalone Locker for this first PM slice;
MCP can discover all structure and assign existing values to tasks.

The local plugin connects to `http://127.0.0.1:8787/mcp`.

## Repository and security checks

`pnpm check:repo` fails if a tracked environment file, private-key marker,
common credential format, or machine-specific Windows user path enters the
working tree. GitHub Actions runs repository safety, lint, type checking, Prisma
generation, and the production build for every push and pull request.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and
[SECURITY.md](SECURITY.md) for the trust boundary and vulnerability reporting.
