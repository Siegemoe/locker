# Architecture

## Boundaries

`src/lib/task-service.ts` is the application boundary. UI actions and
permissioned AI endpoints call it instead of writing directly to Prisma.
Transactions pair state changes with append-only activity events.

The HTTP layer validates payloads with Zod and resolves an actor before calling
the service. Today, development browser requests resolve to `Local user`;
bearer-authenticated calls resolve to `AI_TOOL`. Before any non-local
deployment, replace this with host session validation and enforce workspace
membership/role checks.

## Concurrency and audit

Tasks have an integer `version`. Updates include the last version observed and
only succeed if it still matches, preventing a UI and an agent from silently
overwriting each other. Every successful mutation appends an `Activity`.

## Dependency integrity

The join table prevents direct self-dependencies. Cycle detection belongs in
the dependency service when dependency mutation endpoints are added; database
constraints alone cannot enforce an acyclic graph.
