#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./mcp-server.js";

async function main() {
  const transport = new StdioServerTransport();
  const { server, cleanup } = createServer();

  // Connect to the transport
  await server.connect(transport);

  // Cleanup on exit
  process.on("SIGINT", async () => {
    await cleanup();
    await server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await cleanup();
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
