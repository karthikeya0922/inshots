import type { ChildProcess } from "node:child_process";
import net from "node:net";
import http from "node:http";
import { spawnProcess, killTree } from "../shared/exec.js";

export interface ManagedProcess {
  child: ChildProcess;
  logs: string[];
  exited: boolean;
  exitCode: number | null;
  stop(): Promise<void>;
  waitForUrl(opts: { candidatePorts: number[]; timeoutMs: number; pathHint?: string }): Promise<string | null>;
}

const MAX_LOG_LINES = 400;

/** Start a long-running process, capture its output, and expose URL discovery. */
export function startProcess(cmd: string, args: string[], opts: { cwd: string; env?: Record<string, string>; inheritEnv?: boolean }): ManagedProcess {
  const child = spawnProcess(cmd, args, { cwd: opts.cwd, env: opts.env, inheritEnv: opts.inheritEnv });
  const logs: string[] = [];
  const state = { exited: false, exitCode: null as number | null };
  const push = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      const l = stripAnsi(line).trimEnd();
      if (!l.trim()) continue;
      logs.push(l);
      if (logs.length > MAX_LOG_LINES) logs.shift();
    }
  };
  child.stdout?.on("data", push);
  child.stderr?.on("data", push);
  child.on("exit", (code) => {
    state.exited = true;
    state.exitCode = code;
  });
  child.on("error", (err) => {
    logs.push(`[spawn error] ${err.message}`);
    state.exited = true;
    state.exitCode = -1;
  });

  const managed: ManagedProcess = {
    child,
    logs,
    get exited() {
      return state.exited;
    },
    get exitCode() {
      return state.exitCode;
    },
    async stop() {
      if (state.exited) return;
      killTree(child);
      await new Promise((r) => setTimeout(r, 800));
    },
    async waitForUrl({ candidatePorts, timeoutMs, pathHint }) {
      const deadline = Date.now() + timeoutMs;
      const ports = new Set(candidatePorts);
      while (Date.now() < deadline) {
        if (state.exited) return null;
        // 1. URL printed to the console
        for (const line of logs.slice(-60)) {
          const m = line.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::(\d{2,5}))?(\/\S*)?/i);
          if (m) {
            const port = m[1] ? +m[1] : 80;
            ports.add(port);
          }
          const p = line.match(/(?:port|listening on|running on|started on)[^\d]{0,20}(\d{4,5})\b/i);
          if (p) ports.add(+p[1]);
        }
        // 2. Probe candidate ports
        for (const port of ports) {
          const url = `http://127.0.0.1:${port}${pathHint ?? "/"}`;
          if (await httpAlive(url)) return `http://127.0.0.1:${port}`;
        }
        await new Promise((r) => setTimeout(r, 600));
      }
      return null;
    },
  };
  return managed;
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

export async function findFreePort(preferred: number): Promise<number> {
  for (let p = preferred; p < preferred + 30; p++) if (await isPortFree(p)) return p;
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

/** True when the URL answers with any HTTP status (even 404 means a server is up). */
export function httpAlive(url: string, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs, headers: { accept: "text/html,*/*" } }, (res) => {
      res.resume();
      const code = res.statusCode ?? 0;
      resolve(code > 0 && code < 500 || code === 500 && false);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}
