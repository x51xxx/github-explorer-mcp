#!/usr/bin/env node

import {SSEServerTransport} from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import path from "path";
import {fileURLToPath} from "url";
import {createServer} from "./mcp-server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Create the MCP server
const {server, cleanup} = createServer();

let transport: SSEServerTransport;

// SSE endpoint for the server
app.get("/sse", async (req, res) => {
    console.log("Received SSE connection");
    transport = new SSEServerTransport("/message", res);
    await server.connect(transport);

    server.onclose = async () => {
        await cleanup();
        await server.close();
        process.exit(0);
    };
});

// Message endpoint for client to server communication
app.post("/message", async (req, res) => {
    console.log("Received message");
    await transport.handlePostMessage(req, res);
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "..", "public")));

// API endpoint for status
app.get("/api/status", (req, res) => {
    res.json({
        status: "active",
        version: "0.1.0",
        started: new Date().toISOString(),
        tools: [
            "github_repository_summary",
            "github_directory_structure",
            "github_read_important_files",
            "git_search",
            "git_diff"
        ]
    });
});

// Fallback to index for single page app
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`GitHub Explorer MCP Server is running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} for status page`);
});
