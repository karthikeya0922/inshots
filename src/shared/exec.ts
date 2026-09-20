import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  /** Limit captured output size (bytes) to avoid runaway logs. */
  maxOutput?: number;
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  /** Inherit only these env keys from the host. */
  inheritEnv?: boolean;
}

const isWindows = process.platform === "win32";

/**
 * Minimal safe environment for child processes. We never forward the host's
 * secrets (API keys, tokens) into a repository we are executing.
 */
export function safeEnv(extra: Record<string, string> = {}): Record<string, string> {
  const keep = [
    "PATH",
    "Path",
    "HOME",
    "USERPROFILE",
    "TEMP",
    "TMP",
    "TMPDIR",
    "SYSTEMROOT",
    "SystemRoot",
    "COMSPEC",
    "ComSpec",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMFILES",
    "ProgramFiles",
    "PROGRAMDATA",
    "ProgramData",
    "LANG",
    "LC_ALL",
    "SHELL",
    "PATHEXT",
    "WINDIR",
    "windir",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "JAVA_HOME",
    "PYTHONIOENCODING",
    "NODE_OPTIONS",
    "HYPERFRAMES_SKIP_SKILLS",
    "PLAYWRIGHT_BROWSERS_PATH",
  ];
  const env: Record<string, string> = {};
  for (const key of keep) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }
  env.CI = "1";
  env.BROWSER = "none";
  env.NO_COLOR = "1";
  env.FORCE_COLOR = "0";
  env.NEXT_TELEMETRY_DISABLED = "1";
  env.ASTRO_TELEMETRY_DISABLED = "1";
  env.NUXT_TELEMETRY_DISABLED = "1";
  env.GATSBY_TELEMETRY_DISABLED = "1";
  env.DO_NOT_TRACK = "1";
  env.PYTHONUNBUFFERED = "1";
  env.PYTHONDONTWRITEBYTECODE = "1";
  env.npm_config_ignore_scripts = "true";
  env.npm_config_fund = "false";
  env.npm_config_audit = "false";
  env.npm_config_update_notifier = "false";
  env.npm_config_loglevel = "error";
  env.NODE_ENV = "development";
  return { ...env, ...extra };
}

export function resolveCommand(cmd: string): string {
  if (!isWindows) return cmd;
  // On Windows, npm/pnpm/yarn/npx are .cmd shims.
  if (path.extname(cmd)) return cmd;
  if (["npm", "npx", "pnpm", "yarn", "bun", "mvn", "gradle", "hyperframes"].includes(cmd)) return `${cmd}.cmd`;
  return cmd;
}

/**
 * npm / npx ship as `.cmd` shims on Windows, which are fragile to spawn. Run
 * their CLI entry points with the current Node binary instead when we can find
 * them (works for every standard Node install); fall back to the shim otherwise.
 */
export function npmCli(tool: "npm" | "npx"): { cmd: string; args: string[] } | null {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, "node_modules", "npm", "bin", `${tool}-cli.js`),
    path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", `${tool}-cli.js`),
  ];
  for (const c of candidates) if (existsSync(c)) return { cmd: process.execPath, args: [c] };
  return null;
}

/** Spawn a process without a shell; on Windows, .cmd shims need shell:true. */
export function spawnProcess(cmd: string, args: string[], opts: ExecOptions = {}): ChildProcess {
  if (cmd === "npm" || cmd === "npx") {
    const cli = npmCli(cmd);
    if (cli) {
      cmd = cli.cmd;
      args = [...cli.args, ...args];
    }
  }
  const resolved = resolveCommand(cmd);
  const spawnOpts: SpawnOptions = {
    cwd: opts.cwd,
    env: opts.inheritEnv ? { ...process.env, ...(opts.env ?? {}) } : safeEnv(opts.env),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    // .cmd shims can only be executed through the shell on Windows.
    shell: isWindows && resolved.endsWith(".cmd"),
  };
  if (spawnOpts.shell) {
    // Quote args for cmd.exe when we must go through the shell (one command string avoids DEP0190).
    const quoted = args.map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
    return spawn([`"${resolved}"`, ...quoted].join(" "), spawnOpts);
  }
  return spawn(resolved, args, spawnOpts);
}

export function exec(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const started = Date.now();
  const maxOutput = opts.maxOutput ?? 2_000_000;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child: ChildProcess;
    try {
      child = spawnProcess(cmd, args, opts);
    } catch (err) {
      resolve({
        code: -1,
        stdout: "",
        stderr: String((err as Error).message ?? err),
        timedOut: false,
        durationMs: Date.now() - started,
      });
      return;
    }
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child);
        }, opts.timeoutMs)
      : null;

    const handle = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (stream === "stdout") {
        if (stdout.length < maxOutput) stdout += text;
      } else if (stderr.length < maxOutput) stderr += text;
      if (opts.onLine) {
        for (const line of text.split(/\r?\n/)) if (line.trim()) opts.onLine(line, stream);
      }
    };
    child.stdout?.on("data", handle("stdout"));
    child.stderr?.on("data", handle("stderr"));
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + "\n" + err.message, timedOut, durationMs: Date.now() - started });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, durationMs: Date.now() - started });
    });
  });
}

/** Kill a process and its children (needed for npm → node dev servers). */
export function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    if (isWindows) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }, 2000).unref();
    }
  } catch {
    /* ignore */
  }
}

/** Find an executable on PATH (returns null when missing). */
export async function which(cmd: string): Promise<string | null> {
  const finder = isWindows ? "where" : "which";
  const res = await exec(finder, [cmd], { timeoutMs: 8000, inheritEnv: true });
  if (res.code !== 0) return null;
  const first = res.stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  return first && (existsSync(first) || !isWindows) ? first : first ?? null;
}

export async function hasCommand(cmd: string): Promise<boolean> {
  return (await which(cmd)) !== null;
}
