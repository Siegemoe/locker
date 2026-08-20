# AI-native software PM foundation

## Product stance

Spore Locker should help an agent answer four questions with local, durable
data:

1. What outcome matters now?
2. What work is actually actionable?
3. What evidence or constraint should shape the decision?
4. What changed, who decided it, and can the change be recovered?

The operating model is **evidence over permission**. Routine planning and task
lifecycle choices belong to the agent. Integrity rules still prevent corrupt or
ambiguous state, and the append-only activity trail makes autonomous decisions
inspectable.

## First slice: dependency-aware work selection

The first slice uses Locker's existing `TaskDependency` model instead of adding
a parallel planning abstraction.

- Every task context includes dependencies, dependents, resolution state, and a
  derived `actionable` signal.
- The work queue separates actionable work, unblocked backlog candidates,
  blocked work, and completed work awaiting a lifecycle decision.
- An agent can replace a dependency plan. The service rejects self-links,
  duplicates, cross-workspace or archived targets, and `BLOCKS` cycles.
- Completion, approval, archive, and restore are distinct actions. The agent may
  perform all four, and each action records its actor and evidence trail.
- Optimistic task versions protect concurrent edits without introducing an
  approval ceremony.

This is deliberately derived state. There is no second queue table to drift out
of sync with tasks.

## Next useful slices

1. **Decision records and constraints.** Add structured, project-scoped decisions
   with status, rationale, alternatives, supersession, and links to affected
   tasks. This gives autonomous choices durable memory beyond activity summaries.
2. **Allowlisted local source access.** Resolve workspace references through a
   configured alias-to-root catalog, with contained path resolution and bounded
   text search/read tools. This would make references useful to chat-hosted
   agents without opening the whole machine.
3. **Outcome and acceptance data.** Add project outcomes and task acceptance
   checks as structured records only after real usage shows Markdown descriptions
   are insufficient.
4. **Claims and recovery.** Add short task leases only when multiple concurrent
   agents begin colliding. Do not add assignment machinery before that pressure
   exists.
5. **Learning loop.** Derive cycle time, blocker age, reopen rate, and decision
   reversals from activity. Prefer diagnostics that change planning behavior over
   dashboard volume.

## Boundaries retained

- Local unauthenticated MCP must not be exposed publicly. The legacy Cloudflare
  tunnel stays profile-gated and stopped until OAuth-backed request identity is
  implemented.
- Archive remains recoverable and separate from approval.
- Activity is append-only and actor-labelled.
- Filesystem access is not implied by a stored path reference. The allowlisted
  source adapter should be designed and tested before local file reads are added.
- Spore Locker coordinates work; the execution environment remains external.
