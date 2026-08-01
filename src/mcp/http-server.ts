import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createSporeServer } from "./server";

const port = Number(process.env.MCP_PORT ?? 8787);
const path = "/mcp";

const httpServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ service: "spore-locker-mcp", status: "ok", endpoint: path }));
    return;
  }
  if (request.method === "OPTIONS" && url.pathname === path) {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id"
    }).end();
    return;
  }
  if (url.pathname === path && request.method && ["POST", "GET", "DELETE"].includes(request.method)) {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
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

httpServer.listen(port, "0.0.0.0", () => {
  console.error(`Spore Locker MCP listening on http://0.0.0.0:${port}${path}`);
});
