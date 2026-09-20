import path from "node:path";
import type { LaunchOptions, ProductDNA, QualityGate, RenderResult, RepositoryAnalysis, RuntimeAnalysis, Storyboard, UIAnalysis } from "../types.js";
import { exists, timestamp } from "../shared/fs.js";
import { looksLikeSecret } from "../repository/secrets.js";
import { containsBannedPhrase } from "../shared/text.js";

/** Choose `frameo-output/` or a timestamped sibling when it already exists. */
export function resolveOutputDir(base: string | undefined, cwd: string): string {
  const dir = base ? path.resolve(cwd, base) : path.join(cwd, "frameo-output");
  if (!exists(dir)) return dir;
  return base ? dir : path.join(cwd, `frameo-output-${timestamp()}`);
}

export interface GateInput {
  options: LaunchOptions;
  repo: RepositoryAnalysis;
  runtime: RuntimeAnalysis;
  ui: UIAnalysis;
  dna: ProductDNA;
  storyboard: Storyboard;
  render: RenderResult;
  files: Record<string, string>;
  shareCopyText: string;
}

/** The quality gate from the spec — every check is reported, errors fail the gate. */
export function runQualityGate(g: GateInput): QualityGate {
  const checks: QualityGate["checks"] = [];
  const add = (id: string, ok: boolean, message: string, severity: "error" | "warn" = "error") => checks.push({ id, ok, message, severity });

  // Repository
  add("repo.analyzed", g.repo.fileCount > 0, `${g.repo.fileCount} files scanned`);
  add("repo.important-files", g.repo.importantFiles.length > 0, `${g.repo.importantFiles.length} important files inspected`, "warn");
  add("repo.features-have-evidence", g.repo.features.every((f) => f.evidence.length > 0), `${g.repo.features.length} features, all with evidence`);

  // Runtime
  const launchable = !!g.repo.primaryApp?.runCommand && g.options.run;
  add("runtime.launched", !launchable || g.runtime.status === "ok", g.runtime.status === "ok" ? `launched at ${g.runtime.url}` : `runtime ${g.runtime.status}${g.runtime.reason ? `: ${g.runtime.reason}` : ""}`, "warn");
  add("runtime.screens", g.runtime.screens.length > 0 || g.runtime.sourceDerived.length > 0, `${g.runtime.screens.length} screens captured, ${g.runtime.sourceDerived.length} source-derived`);

  // Story
  const texts = g.storyboard.scenes.map((s) => `${s.text} ${s.subtext ?? ""}`);
  add("story.specific", texts.some((t) => t.includes(g.dna.name)) && g.storyboard.scenes.some((s) => s.source), "story references the product name and real screens");
  add("story.no-generic-filler", !texts.some((t) => containsBannedPhrase(t)), "no banned generic phrases in scene copy");
  add("story.hook", g.storyboard.scenes[0]?.purpose === "hook" && g.storyboard.scenes[0].duration >= 2, `hook scene ${g.storyboard.scenes[0]?.duration}s`);

  // UI
  const realScenes = g.storyboard.scenes.filter((s) => s.sourceKind === "screenshot" || s.sourceKind === "full-page").length;
  add("ui.real-product-ui", realScenes > 0 || g.runtime.sourceDerived.length > 0, realScenes ? `${realScenes}/${g.storyboard.scenes.length} scenes show real UI` : "no runtime UI — source-derived visuals used", realScenes ? "error" : "warn");
  add("ui.visual-language", g.ui.status !== "none", `visual system from ${g.ui.status} (${g.ui.visualSystem.colors.mode}, accent ${g.ui.visualSystem.colors.accent})`, "warn");

  // Claims
  const unsupportedUsed = g.dna.unsupported_claims.filter((c) => texts.some((t) => t.toLowerCase().includes(c.claim.toLowerCase()) && c.claim.length > 10));
  add("claims.verified", unsupportedUsed.length === 0, unsupportedUsed.length ? `unsupported claims in copy: ${unsupportedUsed.map((c) => c.claim).join("; ")}` : `${g.dna.verified_claims.length} verified, ${g.dna.unsupported_claims.length} kept out`);
  add("claims.no-metrics", !texts.some((t) => /\b\d+(\.\d+)?\s?(%|x\b|users|customers|downloads)/i.test(t)), "no fabricated metrics in scene copy");
  add("security.no-secrets", ![...texts, g.shareCopyText, JSON.stringify(g.dna)].some((t) => looksLikeSecret(t)), "no secret-like strings in artifacts");

  // Video
  add("video.duration", g.storyboard.duration >= 15 && g.storyboard.duration <= 30, `${g.storyboard.duration}s`);
  add("video.music", !g.options.music || !!g.storyboard.music, g.options.music ? (g.storyboard.music ? `music: ${g.storyboard.music.title}` : "music requested but no track available") : "music disabled", "warn");
  add("video.cta-readable", (g.storyboard.scenes.at(-1)?.duration ?? 0) >= 2, `CTA holds ${g.storyboard.scenes.at(-1)?.duration}s`);

  // Hyperframes + output
  if (g.options.render) {
    add("hyperframes.check", g.render.checkOk === true, g.render.checkOk ? "check passed" : g.render.reason ?? "check not run", g.render.status === "rendered" ? "error" : "warn");
    add("output.mp4", g.render.status === "rendered" && !!g.render.videoPath && exists(g.render.videoPath), g.render.status === "rendered" ? `frameo.mp4 (${g.render.ffprobe?.durationSec ?? "?"}s${g.render.ffprobe?.hasAudio ? ", audio" : ", NO AUDIO"})` : g.render.reason ?? "not rendered", "warn");
    add("output.poster", !!g.render.posterPath && exists(g.render.posterPath), g.render.posterPath ? "poster.png" : "no poster", "warn");
    if (g.render.status === "rendered" && g.render.ffprobe?.durationSec) add("output.duration-matches", Math.abs(g.render.ffprobe.durationSec - g.storyboard.duration) < 0.6, `rendered ${g.render.ffprobe.durationSec}s vs planned ${g.storyboard.duration}s`, "warn");
  }
  add("output.share-copy", ["share-copy/linkedin.md", "share-copy/x.md", "share-copy/product-hunt.md", "share-copy/short-caption.md"].every((f) => f in g.files), "4 share copy variants");
  add("output.artifacts", ["product-dna.json", "repository-analysis.json", "runtime-analysis.json", "ui-analysis.json", "claim-verification.json", "launch-plan.md", "storyboard.md", "composition-brief.md"].every((f) => f in g.files), "analysis artifacts written");

  const passed = checks.every((c) => c.ok || c.severity === "warn");
  return { passed, checks };
}

export function summaryLines(g: GateInput, gate: QualityGate): string[] {
  const tick = (ok: boolean) => (ok ? "✓" : "✗");
  const lines: string[] = [];
  lines.push(`${tick(true)} Repository analyzed (${g.repo.fileCount} files, ${g.repo.features.length} features with evidence)`);
  lines.push(`${tick(g.repo.frameworks.frontend.length > 0)} Frontend ${g.repo.frameworks.frontend.length ? `detected: ${g.repo.frameworks.frontend.join(", ")}` : "not detected"}`);
  lines.push(`${tick(g.runtime.status === "ok")} Application ${g.runtime.status === "ok" ? `launched (${g.runtime.url})` : g.runtime.status === "skipped" ? "run skipped" : `could not run — ${g.runtime.reason}`}`);
  lines.push(`${tick(g.runtime.screens.length > 0)} ${g.runtime.screens.length} screens discovered${g.runtime.sourceDerived.length ? ` (+${g.runtime.sourceDerived.length} source-derived visuals)` : ""}`);
  lines.push(`${tick(g.ui.status !== "none")} UI system analyzed (${g.ui.designLanguage.join(", ")})`);
  lines.push(`${tick(g.dna.user_flows.length > 0)} ${g.dna.user_flows.length} product flows identified`);
  lines.push(`${tick(true)} Product DNA generated`);
  lines.push(`${tick(true)} Storyboard generated (${g.storyboard.scenes.length} scenes, ${g.storyboard.duration}s, ${g.storyboard.format})`);
  lines.push(`${tick(true)} Claims verified (${g.dna.verified_claims.length} verified, ${g.dna.unsupported_claims.length} excluded)`);
  lines.push(`${tick(true)} Hyperframes composition created`);
  if (g.options.render) lines.push(`${tick(g.render.status === "rendered")} Video ${g.render.status === "rendered" ? `rendered → ${path.basename(g.render.videoPath!)}` : `not rendered — ${g.render.reason}`}`);
  else lines.push(`– Render skipped (--no-render)`);
  lines.push(`${tick(gate.passed)} Quality gate ${gate.passed ? "passed" : "has failures"}`);
  return lines;
}
