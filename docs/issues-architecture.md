# Issues subsystem

## Boundary

Issues is an internal Spore Locker service, not an independently deployed
microservice. It uses the same Next.js runtime, PostgreSQL database, Prisma
client, actor model, transaction pattern, activity trail, MCP server, and
Compose lifecycle as task planning and the Journal.

Locker organizes committed work: what should be done. Issues organizes known
problems that are not yet committed work: what is broken, suspected, or owed.
An issue is a work-order record — it files a problem against a project, tracks
its progress or lack of it, and eventually feeds a task. It never masquerades
as a task, and tasks never become issue-only objects.

## Canonical model

One `Issue` per problem. Every issue has a human work-order code (a
7-character key such as `12F9NM4`, unique per workspace) and is displayed as
`Issue <code> | Title | Details | Attachments`.

- `kind`: `BUG`, `REGRESSION`, or `DEBT`.
- `severity`: `CRITICAL`, `HIGH`, `MEDIUM` (default), or `LOW`. Severity is
  intrinsic harm. It is deliberately distinct vocabulary from task priority,
  which remains a scheduling decision on the fix task.
- `projectId`: required. Projects name the affected system or area; an issue
  about another system files under that system's project. A seeded
  `UNASSIGNED` project is the default bucket.
- `assignedTaskId`: at most one active assignment. Many issues may attach to
  one task; reassignment history lives in the activity stream. Filing never
  auto-assigns, even from task context — assignment is always an explicit
  later decision.
- `duplicateOfId`: deduplication pointer. Closing the original cascades the
  same close reason to open duplicates; reopening does not cascade back.
- `sourceCandidateId`: provenance pointer to the `JournalCandidate` that
  seeded the issue. Pointer only — the Journal's consumption semantics are
  untouched.
- Attachments use the shared `Artifact` table with exactly one owner (task or
  issue, enforced by a database check). Artifacts store references and
  metadata only; binary upload remains a shared future slice for tasks and
  issues alike.

## Lifecycle

```
OPEN ──assign──▶ IN TRIAGE ──▶ RESOLVED ──verify──▶ CLOSED
  │  ▲               │             │
  │  └── reopen (note required) ──┘
  └──────────▶ RESOLVED (shortcut: resolve without assigning)
WONT_FIX / DUPLICATE / NOT_A_BUG → CLOSED directly (nothing to verify)
```

Assignment drives status: assigning an `OPEN` issue moves it to `IN TRIAGE`;
an explicit triage (severity set, no task) reaches the same state. Resolving
with `FIXED` rests at `RESOLVED` awaiting verification; terminal close reasons
close outright. Reopening requires a note, clears the assignment, and returns
the issue to `OPEN`.

No lifecycle step is reserved for a human. Agents triage, assign, resolve, and
reopen; the brake is evidence, not identity. A `FIXED` resolution requires a
resolution note. Every transition appends an actor-labeled, immutable
`Activity` event inside the same transaction.

## The close gate

A task cannot complete while issues attached to it are `OPEN` or `IN TRIAGE`:

- `submitTaskCompletion` and `updateTask` to `DONE` refuse with the offending
  issue codes; the agent resolves them first, then submits.
- Approval re-runs the same check at sign-off.
- `RESOLVED` and `CLOSED` issues never block completion.
- Assigning an issue to a `DONE` task is rejected, so the gate has no backdoor.

Concurrency: the completion path locks the task row (`SELECT … FOR UPDATE`)
before checking issues, and assignment locks the same row before validating
task state, so the gate cannot be raced past in either order.

## Concurrency and identity

Optimistic versioning guards every mutation inside the UPDATE where-clause
(`updateMany({ where: { id, version } })`), never as a read-then-write pair.
Work-order codes are generated inside the create transaction against a unique
`(workspaceId, code)` constraint with collision retry.

## Interfaces

- HTTP routes are thin adapters around `src/lib/issue-service.ts`.
- Seven tools in the existing Locker MCP server: file, list/search,
  context, update, assign, resolve, reopen. Task tools surface assigned
  issues so agents see the gate coming.
- The Locker UI gains an Issues tab: a read-first page in the
  `Issue <code> | Title | Details | Attachments` format, grouped by severity,
  filterable by kind, status, and project, with unassigned-and-aging issues
  pinned first. Editing stays MCP-first.
- `scripts/verify-issues.ts` exercises the full loop against the interface:
  file, assign, gate refusal, resolve, complete, reopen, duplicate cascade.

The MCP remains local and unauthenticated. It must not be exposed publicly
without the same OAuth-backed request identity required by the task tools.
