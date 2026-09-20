// Self-bootstrap for a fresh clone / plugin install: make sure dependencies are
// installed and `dist/` is built before loading the real entry point. Everything
// here writes to stderr only — stdout may be the MCP stdio channel.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const log = (msg) => process.stderr.write(`[frameo] ${msg}\n`);

function npmCli() {
  const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  return existsSync(cli) ? [process.execPath, [cli]] : [process.platform === "win32" ? "npm.cmd" : "npm", []];
}

function run(cmd, args, label) {
  log(label);
  // Child stdout is forwarded to *our* stderr: stdout must stay clean for MCP.
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", shell: process.platform === "win32" && cmd.endsWith(".cmd") });
  if (res.stdout) process.stderr.write(res.stdout);
  if (res.status !== 0) throw new Error(`${label} failed (exit ${res.status ?? res.signal})`);
}

export function ensureReady(entry) {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) {
    log(`Node ${process.versions.node} is too old — Frameo needs Node 22 or newer (https://nodejs.org).`);
    process.exit(1);
  }
  const depsOk = existsSync(path.join(ROOT, "node_modules", "@modelcontextprotocol", "sdk")) && existsSync(path.join(ROOT, "node_modules", "playwright"));
  const builtOk = existsSync(path.join(ROOT, "dist", "connector", entry));
  if (depsOk && builtOk) return;

  const [npm, npmArgs] = npmCli();
  log("First run — setting up Frameo (this happens once and takes about a minute)…");
  if (!depsOk) {
    const useCi = existsSync(path.join(ROOT, "package-lock.json"));
    run(npm, [...npmArgs, useCi ? "ci" : "install", "--no-audit", "--no-fund", "--loglevel=error"], "Installing dependencies");
  }
  if (!builtOk || !depsOk) {
    const tsc = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
    run(process.execPath, [tsc, "-p", path.join(ROOT, "tsconfig.json")], "Building");
  }
  log("Setup complete.");
}
