# Journal subsystem

## Boundary

The Journal is an internal Spore Locker service, not an independently deployed
microservice. It uses the same Next.js runtime, PostgreSQL database, Prisma
client, actor model, transaction pattern, activity trail, MCP server, and
Compose lifecycle as task planning.

Locker organizes intention: what should be done. The Journal organizes
experience: what happened and what each participant thought it meant. Journal
records therefore do not masquerade as tasks or task artifacts.

## Canonical record

PostgreSQL is canonical. Agent-authored bodies remain Markdown, and every daily
entry has a deterministic Markdown rendering exposed through the API, MCP, and
CLI. This avoids a second database and filesystem synchronization while keeping
the record easy to export and inspect.

SQLite was rejected for this integrated prototype. It would add another schema,
migration path, backup target, connection lifecycle, and synchronization
boundary while duplicating capabilities already present in Locker's PostgreSQL
runtime. The portability benefit is retained through deterministic Markdown
export rather than a second canonical store.

One `JournalEntry` exists per workspace and calendar date. Each stable
`authorKey` may own one `JournalContribution` for that day. Updates use an
optimistic contribution version and append an immutable
`JournalContributionRevision`. Finalizing the entry locks all contributions;
later reinterpretation belongs in a new dated entry.

`JournalRole` distinguishes user decisions, agent observations, hypotheses,
recommendations, objective activity, and general reflection. Agent/model
identity, topics, importance, project links, sources, and stable passage IDs
remain attached to original authored content.

## Candidate events

`JournalCandidate` is the lightweight importance hook. It records a meaningful
decision, realization, milestone, change, concern, failure, completion, or new
evidence without retaining the surrounding transcript. A contribution may mark
same-day candidates as consumed while preserving them for provenance.

## Retrieval

PostgreSQL GIN full-text indexes cover contribution and candidate passages.
Search also supports date, author, topic, project, and importance filters and
returns the original surrounding passage rather than an extracted claim.
Semantic vector retrieval remains a deliberate later slice; adding it should
extend this PostgreSQL service rather than introduce another canonical store.

## Interfaces

- The Locker UI provides a Journal tab for reading, writing, event capture,
  search, browsing by date, and finalization.
- HTTP routes are thin adapters around `src/lib/journal-service.ts`.
- Six Journal tools live in the existing Locker MCP server.
- `pnpm journal` is a small local-agent CLI over that MCP surface. It supports
  `today`, `read`, `search`, `reflections`, `contribute`, `flag`, and `finalize`.

The MCP remains local and unauthenticated. It must not be exposed publicly
without the same OAuth-backed request identity required by the task tools.
