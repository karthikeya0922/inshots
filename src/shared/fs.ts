import { promises as fs, existsSync, statSync } from "node:fs";
import path from "node:path";

export const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "coverage",
  ".venv",
  "venv",
  "env",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  "target",
  "out",
  ".idea",
  ".vscode",
  ".DS_Store",
  "vendor",
  "Pods",
  ".gradle",
  ".dart_tool",
  "storybook-static",
  ".angular",
  ".astro",
  ".vercel",
  ".netlify",
  "launch-output",
]);

export interface WalkEntry {
  /** Path relative to root using forward slashes. */
  rel: string;
  abs: string;
  size: number;
  ext: string;
}

export interface WalkOptions {
  maxFiles?: number;
  maxDepth?: number;
  ignoreDirs?: Set<string>;
}

/** Walk a directory tree, skipping vendored and generated directories. */
export async function walk(root: string, opts: WalkOptions = {}): Promise<WalkEntry[]> {
  const maxFiles = opts.maxFiles ?? 20000;
  const maxDepth = opts.maxDepth ?? 14;
  const ignore = opts.ignoreDirs ?? IGNORED_DIRS;
  const out: WalkEntry[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length && out.length < maxFiles) {
    const { dir, depth } = queue.shift()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignore.has(entry.name) || entry.name.startsWith(".git")) continue;
        if (depth < maxDepth) queue.push({ dir: abs, depth: depth + 1 });
      } else if (entry.isFile()) {
        let size = 0;
        try {
          size = statSync(abs).size;
        } catch {
          continue;
        }
        out.push({
          rel: path.relative(root, abs).split(path.sep).join("/"),
          abs,
          size,
          ext: path.extname(entry.name).toLowerCase(),
        });
        if (out.length >= maxFiles) break;
      }
    }
  }
  return out;
}

export async function readText(file: string, maxBytes = 512 * 1024): Promise<string> {
  try {
    const stat = await fs.stat(file);
    if (stat.size > maxBytes) {
      const handle = await fs.open(file, "r");
      try {
        const buf = Buffer.alloc(maxBytes);
        await handle.read(buf, 0, maxBytes, 0);
        return buf.toString("utf8");
      } finally {
        await handle.close();
      }
    }
    return await fs.readFile(file, "utf8");
  } catch {
    return "";
  }
}

export async function readJson<T = unknown>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export async function writeText(file: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value, "utf8");
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function exists(file: string): boolean {
  return existsSync(file);
}

export async function copyFile(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

export async function removeDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
