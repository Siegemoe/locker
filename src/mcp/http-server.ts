import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createSporeServer } from "./server";

const port = Number(process.env.MCP_PORT ?? 8787);
const path = "/mcp";
// Direct runs bind loopback only. The Compose service must bind all interfaces
// because docker-proxy reaches the container over its network address, not its
// loopback; the published host port stays pinned to 127.0.0.1 instead.
const host = process.env.MCP_HOST ?? "127.0.0.1";
// DNS rebinding sends an attacker-chosen Host header; anything outside this
// allowlist is refused. Compose clients use 127.0.0.1/localhost plus the
// in-container healthcheck, which is what the default covers.
const allowedHosts = new Set(
  (process.env.MCP_ALLOWED_HOSTS ?? `127.0.0.1:${port},localhost:${port},[::1]:${port}`)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

const httpServer = createServer(async (request, response) => {
  if (request.headers.host && !allowedHosts.has(request.headers.host)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ service: "spore-locker-mcp", status: "ok", endpoint: path }));
    return;
  }
  if (url.pathname === path && request.method && ["POST", "GET", "DELETE"].includes(request.method)) {
    const server = createSporeServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    response.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response);
    } catch (error) {
      console.error("Spore Locker MCP request failed:", error);
      if (!response.headersSent) response.writeHead(500).end("Internal server error");
    }
    return;
  }
  response.writeHead(404).end("Not found");
});

httpServer.listen(port, host, () => {
  console.error(`Spore Locker MCP listening on http://${host}:${port}${path}`);
});
