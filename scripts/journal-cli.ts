import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const args = process.argv.slice(2);
const command = args.shift() ?? "today";

function value(name: string) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberValue(name: string) {
  const item = value(name);
  return item === undefined ? undefined : Number(item);
}

function listValue(name: string) {
  return value(name)?.split(",").map((item) => item.trim()).filter(Boolean);
}

function requireValue(name: string) {
  const item = value(name);
  if (!item) throw new Error(`Missing --${name}`);
  return item;
}

function bodyValue() {
  const file = value("body-file");
  return file ? readFileSync(file, "utf8") : requireValue("body");
}

async function main() {
  const client = new Client({ name: "spore-journal-cli", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(process.env.MCP_URL ?? "http://127.0.0.1:8787/mcp")));
  try {
    let name: string;
    let input: Record<string, unknown>;
    if (command === "today" || command === "read") {
      name = "get_spore_journal_entry";
      input = command === "read" && args[0] ? { date: args[0] } : {};
    } else if (command === "search") {
      name = "search_spore_journal";
      input = {
        query: args[0] ?? requireValue("query"), authorKey: value("author"), topic: value("topic"),
        projectId: value("project"), dateFrom: value("from"), dateTo: value("to"),
        minImportance: numberValue("importance"), limit: numberValue("limit")
      };
    } else if (command === "reflections") {
      name = "get_spore_agent_reflections";
      input = { authorKey: args[0] ?? requireValue("author"), before: value("before"), limit: numberValue("limit") };
    } else if (command === "contribute") {
      name = "upsert_spore_journal_contribution";
      input = {
        date: value("date"), authorKey: requireValue("author"), authorLabel: requireValue("label"),
        modelId: value("model"), role: value("role") ?? "REFLECTION", bodyMarkdown: bodyValue(),
        topics: listValue("topics"), projectIds: listValue("projects"), candidateIds: listValue("candidates"),
        importance: numberValue("importance"), version: numberValue("version")
      };
    } else if (command === "flag") {
      name = "flag_spore_journal_candidate";
      input = {
        date: value("date"), authorKey: requireValue("author"), authorLabel: requireValue("label"),
        modelId: value("model"), kind: requireValue("kind"), summary: requireValue("summary"),
        contextMarkdown: value("context"), importance: numberValue("importance"), projectId: value("project")
      };
    } else if (command === "finalize") {
      name = "finalize_spore_journal_entry";
      input = { id: requireValue("id"), version: Number(requireValue("version")) };
    } else {
      throw new Error("Commands: today, read DATE, search QUERY, reflections AUTHOR, contribute, flag, finalize");
    }
    input = Object.fromEntries(Object.entries(input).filter(([, item]) => item !== undefined));
    const response = await client.callTool({ name, arguments: input });
    if (response.isError) throw new Error(JSON.stringify(response.content));
    const output = response.structuredContent as { entry?: { markdown?: string } | null } | undefined;
    if ((command === "today" || command === "read") && output?.entry?.markdown) process.stdout.write(output.entry.markdown);
    else process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
