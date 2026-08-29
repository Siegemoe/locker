# Domain glossary

The vocabulary of Spore Locker. Use these terms exactly — in code, docs, activity
summaries, and conversation. When a concept is named here, its module keeps that
name; don't invent synonyms.

## Core concepts

- **Workspace** — the top-level container. There is one, seeded as `spore-locker`;
  the schema models more, the runtime does not enforce multi-workspace yet.
- **Project** — a named bucket of work inside a workspace, keyed by a short
  uppercase `key` (e.g. `SPORE`). `UNASSIGNED` is a permanent default bucket for
  issues filed before a system is named, and cannot be deleted.
- **Task** — a unit of work with a stage (`BACKLOG → READY → IN_PROGRESS → DONE`,
  plus `BLOCKED`/`CANCELED`), priority, project, tags, dependencies, and
  optimistic `version`.
- **Issue** — a work-order problem report: kind (BUG/REGRESSION/DEBT), severity,
  status (`OPEN → IN TRIAGE → RESOLVED → CLOSED`), and a 7-character human
  **work-order code** (alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ` — no `0/O`,
  `1/I/L`). An issue is filed against a project and may be assigned to at most
  one task in that project.
- **Close gate** — the invariant that a task cannot complete while attached
  issues are OPEN or IN TRIAGE. Enforced at every terminal path: `updateTask →
  DONE`, `submitTaskCompletion`, and `approve`.
- **Completion handoff** — the durable artifact `submitTaskCompletion` writes
  when work goes DONE: summary, checks performed, unresolved follow-ups. AI
  tools must produce one; they cannot mark a task DONE directly.
- **Artifact** — attached evidence (LINK, TEXT, FILE_METADATA) with **exactly
  one owner**: a task or an issue, never both, never neither.
- **Journal** — dated entries written by multiple **agents** and the human.
  An entry holds **contributions** (authored passages with revisions) and
  **candidates** (flagged events, e.g. decisions) that contributions may
  consume. Entries are **finalized** to freeze them.
- **Activity** — the append-only audit trail. Every successful mutation pairs
  its state change with an Activity event inside the same transaction. The
  trail is the product's core promise; it is never edited or deleted.
- **Actor** — who did it: `USER` (the human, via the app UI) or `AI_TOOL` (an
  agent, via MCP or a token-authenticated API call). Attribution is
  trusted-local; see SECURITY.md.

## Module vocabulary

- **Expected error** — an error the system anticipates because a human or agent
  can change something and retry: version conflicts, close-gate refusals,
  ownership and lifecycle rules. Thrown as `ExpectedError` from
  `src/lib/expected-error.ts`; adapters map it to 409 (HTTP) or the tool error
  (MCP). Anything else is a plain `Error` — a bug or a race — and surfaces as
  500. The classification is made at the throw site, never re-derived from the
  message.
- **Adapter** — one of the four ways into the services: the React UI, the HTTP
  routes, the MCP tools, and the verify scripts. Adapters validate input and
  translate errors; they never implement domain rules.
- **Service module** — `src/lib/*-service.ts`. Owns its entity's rules,
  transactions, Activity pairing, and read models. The only place domain logic
  lives.
