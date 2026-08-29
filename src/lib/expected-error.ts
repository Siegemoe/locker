/**
 * An error the system anticipates because a human or agent can change
 * something and retry: version conflicts, close-gate refusals, ownership and
 * lifecycle rules. Adapters map it to 409 (HTTP) or the tool error (MCP).
 * Anything else is a plain Error — a bug or a race — and surfaces as 500.
 * The classification is made here, at the throw site, never re-derived from
 * the message text.
 */
export class ExpectedError extends Error {}
