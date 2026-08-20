import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { db } from "../src/lib/db";

type Project = { id: string; key: string; name: string };
type Contribution = {
  id: string; authorKey: string; authorLabel: string; bodyMarkdown: string; version: number;
};
type Candidate = { id: string; summary: string; consumedAt: string | null };
type Entry = {
  id: string; date: string; status: string; version: number; markdown: string;
  contributions: Contribution[]; candidates: Candidate[];
};
type EntryResult = { entry: Entry };
type SearchResult = { results: { kind: string; authorKey: string; passage: string; date: string }[] };
type Reflections = { reflections: (Contribution & { entry: { date: string } })[] };

const client = new Client({ name: "spore-journal-verifier", version: "0.1.0" });
let journalEntryId: string | undefined;

async function call<T>(name: string, args: Record<string, unknown> = {}) {
  const response = await client.callTool({ name, arguments: args });
  assert(!response.isError, JSON.stringify(response));
  return response.structuredContent as T;
}

async function callError(name: string, args: Record<string, unknown>) {
  const response = await client.callTool({ name, arguments: args });
  assert(response.isError, `Expected ${name} to fail`);
  return JSON.stringify(response);
}

async function main() {
  await client.connect(new StreamableHTTPClientTransport(new URL(process.env.MCP_URL ?? "http://127.0.0.1:8787/mcp")));
  const tools = await client.listTools();
  const names = new Set(tools.tools.map((tool) => tool.name));
  for (const name of [
    "get_spore_journal_entry", "upsert_spore_journal_contribution", "flag_spore_journal_candidate",
    "search_spore_journal", "get_spore_agent_reflections", "finalize_spore_journal_entry"
  ]) assert(names.has(name), `Missing Journal MCP tool: ${name}`);

  const workspace = await db.workspace.findUniqueOrThrow({ where: { slug: "spore-locker" } });
  const project = await db.project.findFirstOrThrow({
    where: { workspaceId: workspace.id, archivedAt: null }, select: { id: true, key: true, name: true }
  }) as Project;
  const day = 10 + Math.floor(Math.random() * 18);
  const date = `2199-01-${String(day).padStart(2, "0")}`;
  const token = `longitudinalquartz${Date.now()}`;

  const empty = await call<{ date: string; entry: Entry | null }>("get_spore_journal_entry", { date });
  assert.equal(empty.entry, null);

  let context = await call<EntryResult>("flag_spore_journal_candidate", {
    date, authorKey: "codex-desktop", authorLabel: "Codex Desktop", modelId: "journal-verifier",
    kind: "REALIZATION", summary: `The shared Journal needs ${token} provenance.`,
    contextMarkdown: "Preserve the original event so later reflection can cite it.", importance: 5,
    projectId: project.id
  });
  journalEntryId = context.entry.id;
  const candidate = context.entry.candidates[0];
  assert(candidate);

  for (const author of [
    ["chatgpt", "ChatGPT", "The product direction became clearer from conversation."],
    ["codex-desktop", "Codex Desktop", `I initially read ${token} as an implementation detail.`],
    ["hermes", "Hermes", "The local-agent path remained operationally independent."],
  ] as const) {
    context = await call<EntryResult>("upsert_spore_journal_contribution", {
      date, authorKey: author[0], authorLabel: author[1], modelId: "journal-verifier",
      role: "REFLECTION", bodyMarkdown: author[2], topics: ["continuity", "journal"],
      importance: 4, projectIds: [project.id]
    });
  }
  assert.deepEqual(new Set(context.entry.contributions.map((item) => item.authorKey)), new Set(["chatgpt", "codex-desktop", "hermes"]));
  assert(context.entry.markdown.includes("## ChatGPT"));
  assert(context.entry.markdown.includes("## Codex Desktop"));
  assert(context.entry.markdown.includes("## Hermes"));
  assert(context.entry.markdown.includes("journal-section id="));

  const reflections = await call<Reflections>("get_spore_agent_reflections", {
    authorKey: "codex-desktop", before: "2199-02-01", limit: 10
  });
  assert(reflections.reflections.some((item) => item.entry.date === date));

  const search = await call<SearchResult>("search_spore_journal", {
    query: token, authorKey: "codex-desktop", projectId: project.id, topic: "continuity", minImportance: 4
  });
  assert(search.results.some((item) => item.authorKey === "codex-desktop" && item.passage.includes(token)));

  const codex = context.entry.contributions.find((item) => item.authorKey === "codex-desktop");
  assert(codex);
  context = await call<EntryResult>("upsert_spore_journal_contribution", {
    date, authorKey: "codex-desktop", authorLabel: "Codex Desktop", modelId: "journal-verifier-v2",
    role: "AGENT_OBSERVATION",
    bodyMarkdown: `My earlier conclusion about ${token} was incomplete. It is primarily a provenance boundary, not an implementation detail.`,
    topics: ["continuity", "journal"], importance: 5, projectIds: [project.id],
    candidateIds: [candidate.id], version: codex.version
  });
  assert(context.entry.candidates.find((item) => item.id === candidate.id)?.consumedAt);
  const revisions = await db.journalContributionRevision.count({ where: { contributionId: codex.id } });
  assert.equal(revisions, 2);

  context = await call<EntryResult>("finalize_spore_journal_entry", {
    id: context.entry.id, version: context.entry.version
  });
  assert.equal(context.entry.status, "FINALIZED");
  const finalizedError = await callError("upsert_spore_journal_contribution", {
    date, authorKey: "codex-desktop", authorLabel: "Codex Desktop",
    bodyMarkdown: "This must not overwrite finalized history.", version: context.entry.contributions.find((item) => item.authorKey === "codex-desktop")!.version
  });
  assert(finalizedError.includes("Finalized Journal entries cannot be changed"));

  const actions = await db.activity.findMany({
    where: { journalEntryId: context.entry.id }, orderBy: { createdAt: "asc" }, select: { action: true }
  });
  assert.deepEqual(actions.map((item) => item.action), [
    "journal.candidate_flagged", "journal.contribution_created", "journal.contribution_created",
    "journal.contribution_created", "journal.contribution_updated", "journal.entry_finalized"
  ]);
  console.log(`Journal verified: 3 attributed agents, candidate hook, revision, filtered search, Markdown, and finalized history across ${tools.tools.length} Locker tools.`);
}

main().finally(async () => {
  await client.close();
  if (journalEntryId) {
    await db.activity.deleteMany({ where: { journalEntryId } });
    await db.journalEntry.deleteMany({ where: { id: journalEntryId } });
  }
  await db.$disconnect();
});
