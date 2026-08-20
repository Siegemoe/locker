# Journal prototype evaluation

## What the prototype proves

The integrated service can preserve ChatGPT, Codex Desktop, and a local-agent
identity as distinct attributed authors on the same day. A day may contain any
subset of authors without empty sections. Important events can be flagged
separately, consumed into a later contribution, and retained for provenance.

Contributions have stable IDs and optimistic versions. Every edit appends a
revision, and finalization prevents later overwrites. Agents can retrieve their
own prior dated reflections and full-text search can resolve factual or thematic
queries back to the original contribution or candidate passage. Date, author,
topic, project, and importance filters stay relational and queryable.

The automated verifier demonstrates a longitudinal correction: Codex first
classifies a synthetic continuity signal as an implementation detail, then
retrieves and revises that conclusion as a provenance boundary while the first
revision remains stored. This proves the mechanism; useful personal insight
still requires real usage over time.

## Current judgment

The Journal should remain a bounded service inside Spore Locker. The shared
PostgreSQL, Prisma, identity, activity, MCP, UI, and Compose architecture is
substantially simpler than operating a separate service while preserving a
clean domain boundary from task planning.

It is too early to justify mandatory background generation as a fundamental
personal-agent subsystem. Run it as a lightweight capability first and evaluate
real contributions over at least several active days. Promotion should require
one cross-agent or longitudinal insight that materially changes understanding or
action and would have been difficult to recover from isolated histories.

## Deliberate next slices

1. Add semantic vector retrieval in the existing PostgreSQL service after an
   embedding model is selected and measured. V1 currently provides indexed
   PostgreSQL full-text search plus structured filters; it does not pretend that
   lexical ranking is semantic similarity.
2. Add a conservative daily background trigger only after candidate-event and
   authorship quality are observed in real use. Empty boilerplate is a failure.
3. Add explicit export/backup scheduling if deterministic on-demand Markdown
   proves insufficient for portability.
4. Evaluate correction policy and revision visibility with real factual errors;
   interpretation changes should continue to appear as new dated reflections.
