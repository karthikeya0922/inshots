#!/usr/bin/env node
import { ensureReady } from "./_bootstrap.js";
ensureReady("mcp-server.js");
await import("../dist/connector/mcp-server.js");
