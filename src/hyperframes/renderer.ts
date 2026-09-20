import path from "node:path";
import { promises as fs } from "node:fs";
import type { ProgressReporter, RenderQuality, RenderResult } from "../types.js";
import { exec, hasCommand } from "../shared/exec.js";
import { exists } from "../shared/fs.js";

/**
 * Renderer: drives the *current* Hyperframes CLI (`npx hyperframes`) rather
 * than re-implementing composition/rendering. Runs `check` as the single
 * gate, then `render`, then picks a poster frame and bakes it as frame 0.
 */

export interface RenderOptions {
  compositionDir: string;
  outputVideo: string;
  outputPoster: string;
  quality: RenderQuality;
  timeoutMs: number;
  heroTime: number;
  report?: ProgressReporter;
  /** When true, only run `check` (no render). */
  checkOnly?: boolean;
}

export interface CheckSummary {
  ok: boolean;
  errors: number;
  warnings: number;
  findings: Array<{ code: string; severity: string; message: string; selector?: string; sourceFile?: string; fixHint?: string; time?: number }>;
  raw?: unknown;
}

export async function hyperframesVersion(): Promise<string | null> {
  if (!(await hasCommand("npx"))) return null;
  const res = await exec("npx", ["--no-install", "hyperframes", "--version"], { timeoutMs: 60_000, inheritEnv: true });
  const v = (res.stdout + res.stderr).match(/(\d+\.\d+\.\d+)/)?.[1];
  return res.code === 0 && v ? v : null;
}

export async function runCheck(compositionDir: string, timeoutMs: number): Promise<CheckSummary> {
  const res = await exec("npx", ["hyperframes", "check", "--json"], { cwd: compositionDir, timeoutMs, inheritEnv: true, env: { HYPERFRAMES_SKIP_SKILLS: "1" } });
  const json = parseJson(res.stdout) ?? parseJson(res.stderr);
  if (!json) {
    return { ok: false, errors: 1, warnings: 0, findings: [{ code: "check_failed", severity: "error", message: (res.stderr || res.stdout).split(/\r?\n/).filter(Boolean).slice(-5).join(" | ") || `exit ${res.code}` }] };
  }
  const sections = ["lint", "runtime", "layout", "motion", "contrast", "hdr"] as const;
  const findings: CheckSummary["findings"] = [];
  let errors = 0;
  let warnings = 0;
  for (const s of sections) {
    const sec = (json as Record<string, { errorCount?: number; warningCount?: number; findings?: unknown[] }>)[s];
    if (!sec) continue;
    errors += sec.errorCount ?? 0;
    warnings += sec.warningCount ?? 0;
    for (const f of (sec.findings ?? []) as Array<Record<string, unknown>>) {
      findings.push({ code: String(f.code ?? f.rule ?? s), severity: String(f.severity ?? "info"), message: String(f.message ?? ""), selector: f.selector as string | undefined, sourceFile: (f.sourceFile ?? f.file) as string | undefined, fixHint: (f.fixHint ?? f.hint) as string | undefined, time: f.time as number | undefined });
    }
  }
  return { ok: Boolean((json as { ok?: boolean }).ok), errors, warnings, findings, raw: json };
}

export async function renderComposition(opts: RenderOptions): Promise<RenderResult & { check: CheckSummary | null }> {
  const report = opts.report ?? (() => {});
  const version = await hyperframesVersion();
  if (!version) {
    return {
      status: "not_rendered",
      reason: "Hyperframes CLI is not available. Install it with `npm i -g hyperframes` (or ensure `npx hyperframes` works; Node ≥ 22 and FFmpeg are required), then run `hyperframe-launch render <output-dir>`.",
      check: null,
    };
  }
  const ffmpeg = await hasCommand("ffmpeg");

  report({ step: "hyperframes", status: "start", message: `Running hyperframes check (v${version})` });
  let check = await runCheck(opts.compositionDir, Math.min(opts.timeoutMs, 240_000));
  if (!check.ok) {
    // One targeted retry: contrast is the only audit we may relax, and only when nothing else fails.
    const onlyContrast = check.findings.every((f) => f.severity !== "error" || /contrast|wcag/i.test(f.code));
    if (onlyContrast && check.errors > 0) {
      report({ step: "hyperframes", status: "warn", message: `check reported ${check.errors} contrast error(s); re-running with --no-contrast so the render is not blocked (findings recorded)` });
      const res = await exec("npx", ["hyperframes", "check", "--json", "--no-contrast"], { cwd: opts.compositionDir, timeoutMs: Math.min(opts.timeoutMs, 240_000), inheritEnv: true, env: { HYPERFRAMES_SKIP_SKILLS: "1" } });
      const json = parseJson(res.stdout);
      if (json && (json as { ok?: boolean }).ok) check = { ...check, ok: true };
    }
  }
  if (!check.ok) {
    report({ step: "hyperframes", status: "fail", message: `hyperframes check failed with ${check.errors} error(s)` });
    return { status: "not_rendered", reason: `hyperframes check failed: ${check.findings.filter((f) => f.severity === "error").slice(0, 3).map((f) => `${f.code}: ${f.message}`).join("; ")}`, checkOk: false, checkFindings: check.findings.length, check };
  }
  report({ step: "hyperframes", status: "done", message: `hyperframes check passed (${check.warnings} warning(s))` });
  if (opts.checkOnly) return { status: "not_rendered", reason: "check only", checkOk: true, checkFindings: check.findings.length, check };

  report({ step: "render", status: "start", message: `Rendering (${opts.quality})` });
  const t0 = Date.now();
  const outAbs = path.resolve(opts.outputVideo);
  const res = await exec("npx", ["hyperframes", "render", "--quality", opts.quality, "--output", outAbs], { cwd: opts.compositionDir, timeoutMs: opts.timeoutMs, inheritEnv: true, env: { HYPERFRAMES_SKIP_SKILLS: "1" } });
  const renderMs = Date.now() - t0;
  if (res.code !== 0 || !exists(outAbs)) {
    const msg = (res.stderr + res.stdout).split(/\r?\n/).filter((l) => l.trim()).slice(-6).join(" | ");
    report({ step: "render", status: "fail", message: `render failed: ${msg}` });
    return { status: "not_rendered", reason: `hyperframes render failed: ${res.timedOut ? "timed out" : msg}`, checkOk: true, checkFindings: check.findings.length, renderMs, check, command: `npx hyperframes render --quality ${opts.quality} --output ${outAbs}` };
  }
  const stat = await fs.stat(outAbs);
  if (stat.size === 0) return { status: "not_rendered", reason: "render produced an empty file", checkOk: true, check, renderMs };

  // Poster + bake frame 0
  let posterPath: string | undefined;
  if (ffmpeg) {
    const poster = path.resolve(opts.outputPoster);
    const p = await exec("ffmpeg", ["-y", "-v", "error", "-ss", String(opts.heroTime), "-i", outAbs, "-frames:v", "1", "-q:v", "2", poster], { timeoutMs: 60_000, inheritEnv: true });
    if (p.code === 0 && exists(poster)) {
      posterPath = poster;
      const baked = outAbs.replace(/\.mp4$/, ".poster.mp4");
      const b = await exec("ffmpeg", ["-y", "-v", "error", "-i", outAbs, "-i", poster, "-filter_complex", "[0:v][1:v]overlay=0:0:enable='eq(n,0)'[v]", "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", baked], { timeoutMs: 180_000, inheritEnv: true });
      if (b.code === 0 && exists(baked)) await fs.rename(baked, outAbs);
      else await fs.rm(baked, { force: true }).catch(() => {});
    }
  }
  const probe = ffmpeg ? await ffprobe(outAbs) : undefined;
  report({ step: "render", status: "done", message: `Rendered ${path.basename(outAbs)} (${(stat.size / 1e6).toFixed(1)} MB, ${(renderMs / 1000).toFixed(0)}s)` });
  return { status: "rendered", videoPath: outAbs, posterPath, checkOk: true, checkFindings: check.findings.length, renderMs, ffprobe: probe, check, command: `npx hyperframes render --quality ${opts.quality} --output ${outAbs}` };
}

export async function ffprobe(file: string): Promise<RenderResult["ffprobe"]> {
  const res = await exec("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeoutMs: 30_000, inheritEnv: true });
  const json = parseJson(res.stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type: string; width?: number; height?: number }> } | null;
  if (!json) return undefined;
  const v = json.streams?.find((s) => s.codec_type === "video");
  return { durationSec: json.format?.duration ? Math.round(parseFloat(json.format.duration) * 100) / 100 : undefined, width: v?.width, height: v?.height, hasAudio: !!json.streams?.some((s) => s.codec_type === "audio") };
}

function parseJson(s: string): unknown | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  // Take the last complete JSON object in the output (CLI may print notices before it).
  for (let i = start; i < s.length; i++) {
    if (s[i] !== "{") continue;
    try {
      return JSON.parse(s.slice(i, s.lastIndexOf("}") + 1));
    } catch {
      /* try next */
    }
  }
  return null;
}
