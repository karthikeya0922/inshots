import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { exec, hasCommand } from "../shared/exec.js";
import { ensureDir, exists, removeDir } from "../shared/fs.js";
import { slugify } from "../shared/text.js";

export interface CloneResult {
  localPath: string;
  url: string;
  branch?: string;
  commit?: string;
  isLocal: boolean;
  workspaceDir: string;
}

export function isLocalPath(input: string): boolean {
  if (/^(https?|git|ssh):\/\//i.test(input) || /^git@/.test(input)) return false;
  return exists(input);
}

export function normalizeRepoUrl(input: string): { url: string; name: string } {
  let url = input.trim();
  // owner/repo shorthand
  if (/^[\w.-]+\/[\w.-]+$/.test(url) && !exists(url)) url = `https://github.com/${url}`;
  url = url.replace(/\/+$/, "");
  // Strip GitHub tree/blob paths: https://github.com/o/r/tree/main/sub → https://github.com/o/r
  const gh = url.match(/^(https?:\/\/github\.com\/[^/]+\/[^/]+)(?:\/(?:tree|blob)\/([^/]+))?/i);
  if (gh) url = gh[1];
  const name = slugify(url.split("/").pop()?.replace(/\.git$/, "") ?? "project");
  return { url, name };
}

/** Clone a repository into an isolated workspace directory (or reuse a local path). */
export async function cloneRepository(
  input: string,
  opts: { branch?: string; workspaceDir?: string; timeoutMs?: number } = {},
): Promise<CloneResult> {
  const workspaceRoot = opts.workspaceDir ?? path.join(os.tmpdir(), "hyperframe-launch");
  await ensureDir(workspaceRoot);

  if (isLocalPath(input)) {
    const localPath = path.resolve(input);
    const commit = await gitHead(localPath);
    return { localPath, url: localPath, branch: opts.branch, commit, isLocal: true, workspaceDir: workspaceRoot };
  }

  if (!(await hasCommand("git"))) {
    throw new Error("git is required to clone repositories but was not found on PATH.");
  }

  const { url, name } = normalizeRepoUrl(input);
  const branchHint = opts.branch ?? url.match(/\/tree\/([^/]+)/)?.[1];
  const target = path.join(workspaceRoot, `${name}-${Date.now().toString(36)}`);
  if (exists(target)) await removeDir(target);

  const args = ["clone", "--depth", "1", "--single-branch", "--no-tags"];
  if (branchHint) args.push("--branch", branchHint);
  args.push(url, target);
  const res = await exec("git", args, {
    timeoutMs: opts.timeoutMs ?? 180_000,
    inheritEnv: true,
    env: { GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" },
  });
  if (res.code !== 0) {
    const msg = res.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ");
    throw new Error(`git clone failed for ${url}: ${msg || `exit ${res.code}`}`);
  }
  // Drop the .git directory's hooks so nothing repo-controlled can run later.
  try {
    await fs.rm(path.join(target, ".git", "hooks"), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  const commit = await gitHead(target);
  const branch = branchHint ?? (await gitBranch(target));
  return { localPath: target, url, branch, commit, isLocal: false, workspaceDir: workspaceRoot };
}

async function gitHead(dir: string): Promise<string | undefined> {
  const res = await exec("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { timeoutMs: 10_000, inheritEnv: true });
  return res.code === 0 ? res.stdout.trim() : undefined;
}

async function gitBranch(dir: string): Promise<string | undefined> {
  const res = await exec("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], { timeoutMs: 10_000, inheritEnv: true });
  return res.code === 0 ? res.stdout.trim() : undefined;
}
