import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { exec, hasCommand, which } from "../shared/exec.js";
import { exists } from "../shared/fs.js";
import type { AppCandidate, ProgressReporter, RunCommand } from "../types.js";
import { findFreePort, httpAlive, startProcess, type ManagedProcess } from "./process-manager.js";
import { serveStatic, type StaticServer } from "./static-server.js";

export interface LaunchedApp {
  url: string;
  command: RunCommand;
  app: AppCandidate;
  startupMs: number;
  installMs: number;
  logs: () => string[];
  stop(): Promise<void>;
}

export interface LaunchFailure {
  reason: string;
  logs: string[];
  command?: RunCommand;
}

export interface LauncherOptions {
  install: boolean;
  installTimeoutMs: number;
  startupTimeoutMs: number;
  appEnv?: Record<string, string>;
  report?: ProgressReporter;
}

/**
 * Safety notes:
 *  - Dependency installation always disables lifecycle scripts (`--ignore-scripts`),
 *    so a repository cannot run arbitrary code just by being installed.
 *  - The dev server itself is repository code and does run; it gets a scrubbed
 *    environment (no host secrets), a private port, and is killed on completion.
 *  - Commands are matched against an allowlist of well-known dev-server shapes;
 *    scripts that shell out to docker/ssh/rm/curl-pipe-sh are never chosen.
 */
export async function launchApp(repoRoot: string, app: AppCandidate, opts: LauncherOptions): Promise<LaunchedApp | LaunchFailure> {
  const command = app.runCommand;
  if (!command) return { reason: "no run command detected", logs: [] };
  const cwd = path.join(repoRoot, command.cwd);
  const report = opts.report ?? (() => {});

  // ---- Static site: built-in server, nothing to install ---------------------
  if (command.cmd === "__static__") {
    const started = Date.now();
    const server: StaticServer = await serveStatic(cwd);
    return {
      url: server.url,
      command: { ...command, port: server.port },
      app,
      startupMs: Date.now() - started,
      installMs: 0,
      logs: () => [`static server on ${server.url}`],
      stop: () => server.close(),
    };
  }

  // ---- Resolve interpreter / package manager ---------------------------------
  let cmd = command.cmd;
  let args = [...command.args];
  let env: Record<string, string> = { ...(command.env ?? {}), ...(opts.appEnv ?? {}) };
  let installMs = 0;
  const logs: string[] = [];

  if (cmd === "__python__" || command.install?.cmd === "__pip__") {
    const py = await resolvePython(cwd, opts, logs);
    if (!py) return { reason: "python interpreter not found", logs, command };
    if (command.install?.cmd === "__pip__") {
      if (!opts.install) return { reason: "dependency installation disabled (--no-install)", logs, command };
      const t = Date.now();
      report({ step: "runtime", status: "start", message: `Installing Python dependencies (${command.install.reason})` });
      const res = await exec(py.python, ["-m", "pip", "install", "--disable-pip-version-check", "--quiet", ...command.install.args], { cwd, timeoutMs: opts.installTimeoutMs, env: { PIP_NO_INPUT: "1", VIRTUAL_ENV: py.venv ?? "" } });
      installMs = Date.now() - t;
      logs.push(...tail(res.stderr + res.stdout, 20));
      if (res.code !== 0) return { reason: res.timedOut ? "pip install timed out" : `pip install failed (exit ${res.code})`, logs, command };
    }
    if (cmd === "__python__") cmd = py.python;
    if (py.venv) env = { ...env, VIRTUAL_ENV: py.venv, PATH: `${path.join(py.venv, process.platform === "win32" ? "Scripts" : "bin")}${path.delimiter}${process.env.PATH ?? ""}` };
  } else {
    if (!(await hasCommand(cmd.split(" ")[0]))) {
      // pnpm/yarn/bun missing → fall back to npm equivalents when possible
      if (["pnpm", "yarn", "bun"].includes(cmd) && (await hasCommand("npm"))) {
        logs.push(`${cmd} not found; falling back to npm`);
        cmd = "npm";
        args = args[0] === "run" || args[0] === "install" ? args : ["run", ...args];
        if (command.install) command.install = { ...command.install, cmd: "npm", args: ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"] };
      } else return { reason: `${cmd} not found on PATH`, logs, command };
    }
    if (command.install) {
      if (!opts.install) return { reason: "dependency installation disabled (--no-install)", logs, command };
      const hasModules = exists(path.join(cwd, "node_modules")) || exists(path.join(repoRoot, "node_modules"));
      if (!hasModules) {
        const t = Date.now();
        report({ step: "runtime", status: "start", message: `Installing dependencies (${command.install.reason})` });
        const installCwd = command.install.cwd !== undefined ? path.join(repoRoot, workspaceRootFor(repoRoot, command.install.cwd)) : cwd;
        const res = await exec(command.install.cmd, command.install.args, { cwd: installCwd, timeoutMs: opts.installTimeoutMs });
        installMs = Date.now() - t;
        logs.push(...tail(res.stderr + res.stdout, 20));
        if (res.code !== 0) return { reason: res.timedOut ? "dependency install timed out" : `dependency install failed (exit ${res.code})`, logs, command };
      }
    }
  }

  // ---- Start ------------------------------------------------------------------
  const preferred = command.port ?? 3000;
  const port = await findFreePort(preferred);
  if (port !== preferred) {
    args = args.map((a) => (a === String(preferred) ? String(port) : a)).map((a) => a.replace(new RegExp(`:${preferred}$`), `:${port}`));
    env.PORT = String(port);
    if (env.SERVER_PORT) env.SERVER_PORT = String(port);
    if (env.GRADIO_SERVER_PORT) env.GRADIO_SERVER_PORT = String(port);
  }
  report({ step: "runtime", status: "start", message: `Starting app: ${[cmd, ...args].join(" ")}` });
  const started = Date.now();
  // Only our assigned port (plus ports the app prints itself) count — and never a port that was already
  // serving something before we started, so we can never screenshot an unrelated local server.
  const preAlive = new Set<number>();
  for (const p of [port, preferred]) if (await httpAlive(`http://127.0.0.1:${p}/`, 800)) preAlive.add(p);
  const proc: ManagedProcess = startProcess(cmd, args, { cwd, env });
  const url = await proc.waitForUrl({ candidatePorts: [port, preferred].filter((p) => !preAlive.has(p)), excludePorts: preAlive, timeoutMs: opts.startupTimeoutMs, pathHint: command.openPath });
  if (!url) {
    const procLogs = [...proc.logs];
    await proc.stop();
    return { reason: proc.exited ? `app exited with code ${proc.exitCode}` : "app did not open an HTTP port before the timeout", logs: [...logs, ...procLogs.slice(-40)], command: { ...command, cmd, args } };
  }
  return {
    url,
    command: { ...command, cmd, args, port: +new URL(url).port },
    app,
    startupMs: Date.now() - started,
    installMs,
    logs: () => [...logs, ...proc.logs],
    stop: () => proc.stop(),
  };
}

function tail(s: string, n: number): string[] {
  return s.split(/\r?\n/).filter((l) => l.trim()).slice(-n);
}

function workspaceRootFor(repoRoot: string, dir: string): string {
  // For workspace packages, install from the workspace root when one exists.
  if (dir && (exists(path.join(repoRoot, "pnpm-workspace.yaml")) || exists(path.join(repoRoot, "package-lock.json")) || exists(path.join(repoRoot, "yarn.lock")) || exists(path.join(repoRoot, "turbo.json")))) return "";
  return dir;
}

async function resolvePython(cwd: string, opts: LauncherOptions, logs: string[]): Promise<{ python: string; venv?: string } | null> {
  const base = (await which("python")) ?? (await which("python3")) ?? (await which("py"));
  if (!base) return null;
  if (!opts.install) return { python: base };
  // Keep the virtualenv out of the repository (never pollute a local checkout, never get re-scanned).
  const venv = path.join(os.tmpdir(), "hyperframe-launch", "venvs", createHash("sha1").update(cwd).digest("hex").slice(0, 12));
  const bin = path.join(venv, process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
  if (exists(bin)) return { python: bin, venv };
  const res = await exec(base, ["-m", "venv", venv], { cwd, timeoutMs: 120_000 });
  if (res.code !== 0 || !exists(bin)) {
    logs.push("venv creation failed; using system python");
    return { python: base };
  }
  return { python: bin, venv };
}
