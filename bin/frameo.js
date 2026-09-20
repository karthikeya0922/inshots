#!/usr/bin/env node
import { ensureReady } from "./_bootstrap.js";
ensureReady("cli.js");
await import("../dist/connector/cli.js");
