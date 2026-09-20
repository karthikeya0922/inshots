import path from "node:path";
import type { LaunchOptions, LaunchResult, Platform, ProgressEvent, ProgressReporter, RenderResult, VideoFormat } from "../types.js";
import { cloneRepository, analyzeRepository } from "../repository/index.js";
import { runRuntimeStage } from "../runtime/index.js";
import { analyzeUI } from "../ui/design-system.js";
import { verifyClaims } from "../intelligence/claim-verifier.js";
import { buildProductDNA } from "../intelligence/product-dna.js";
import { buildStoryPlan } from "../intelligence/story-engine.js";
import { buildStoryboard, storyboardJson, storyboardMarkdown } from "../storyboard/index.js";
import { alignScenesToMusic, extractAudioData, placeSfx, selectMusic } from "../audio/index.js";
import { buildComposition, type CompositionInput } from "../hyperframes/composition.js";
import { compositionBriefMarkdown, launchPlanMarkdown } from "../hyperframes/brief.js";
import { hyperframesVersion, renderComposition } from "../hyperframes/renderer.js";
import { generateShareCopy } from "../copy/index.js";
import { resolveOutputDir, runQualityGate, summaryLines } from "../output/index.js";
import { ensureDir, removeDir, writeJson, writeText } from "../shared/fs.js";
import { redactSecrets } from "../repository/secrets.js";

export const PLATFORM_PRESETS: Record<Platform, { format: VideoFormat; duration: number }> = {
  linkedin: { format: "landscape", duration: 24 },
  x: { format: "landscape", duration: 20 },
  "instagram-reel": { format: "vertical", duration: 20 },
  "youtube-short": { format: "vertical", duration: 24 },
  "product-hunt": { format: "landscape", duration: 25 },
  generic: { format: "landscape", duration: 24 },
};

export function withDefaults(partial: Partial<LaunchOptions> & { repositoryUrl: string }): LaunchOptions {
  const platform = (partial.platform ?? "generic") as Platform;
  const preset = PLATFORM_PRESETS[platform] ?? PLATFORM_PRESETS.generic;
  return {
    repositoryUrl: partial.repositoryUrl,
    branch: partial.branch,
    duration: clamp(partial.duration ?? preset.duration, 15, 30),
    format: partial.format ?? preset.format,
    tone: partial.tone ?? "",
    voice: partial.voice ?? false,
    music: partial.music ?? true,
    sfx: partial.sfx ?? true,
    platform,
    style: partial.style,
    targetAudience: partial.targetAudience,
    outputDir: partial.outputDir,
    workspaceDir: partial.workspaceDir,
    run: partial.run ?? true,
    install: partial.install ?? true,
    render: partial.render ?? true,
    quality: partial.quality ?? "looks",
    maxScreens: partial.maxScreens ?? 10,
    timeouts: { install: 420_000, startup: 120_000, navigation: 25_000, render: 900_000, ...(partial.timeouts ?? {}) },
    appEnv: partial.appEnv,
    title: partial.title,
    verbose: partial.verbose,
  };
}

export interface PipelineHooks {
  report?: ProgressReporter;
  cwd?: string;
}

export async function createLaunchVideo(partial: Partial<LaunchOptions> & { repositoryUrl: string }, hooks: PipelineHooks = {}): Promise<LaunchResult> {
  const options = withDefaults(partial);
  const cwd = hooks.cwd ?? process.cwd();
  const steps: ProgressEvent[] = [];
  const report: ProgressReporter = (e) => {
    steps.push(e);
    hooks.report?.(e);
  };
  const outputDir = resolveOutputDir(options.outputDir, cwd);
  await ensureDir(outputDir);
  const files: Record<string, string> = {};
  const save = async (rel: string, content: unknown) => {
    const abs = path.join(outputDir, rel);
    if (typeof content === "string") await writeText(abs, content);
    else await writeJson(abs, content);
    files[rel] = abs;
  };

  // 1. Clone ---------------------------------------------------------------------
  report({ step: "repository", status: "start", message: `Cloning ${options.repositoryUrl}` });
  const clone = await cloneRepository(options.repositoryUrl, { branch: options.branch, workspaceDir: options.workspaceDir });
  report({ step: "repository", status: "done", message: clone.isLocal ? `Using local repository ${clone.localPath}` : `Cloned ${clone.url}${clone.commit ? ` @ ${clone.commit}` : ""}` });

  try {
    // 2. Repository intelligence ---------------------------------------------------
    report({ step: "repository", status: "start", message: "Analyzing repository (frameworks, routes, features, design tokens)" });
    const repo = await analyzeRepository(clone);
    const analysis = repo.analysis;
    if (options.title) analysis.name = options.title;
    await save("repository-analysis.json", { ...analysis, source: { ...analysis.source, localPath: clone.isLocal ? analysis.source.localPath : "[workspace]" } });
    report({ step: "repository", status: "done", message: `${analysis.name}: ${analysis.frameworks.frontend.join(", ") || "no frontend framework"}${analysis.frameworks.backend.length ? ` + ${analysis.frameworks.backend.join(", ")}` : ""}; ${analysis.features.length} features; ${analysis.routes.length} routes` });
    for (const w of analysis.warnings) report({ step: "repository", status: "warn", message: w });
    if (analysis.frameworks.frontend.length || analysis.primaryApp?.kind === "static") report({ step: "repository", status: "done", message: `Frontend detected: ${analysis.frameworks.frontend.join(", ") || "static HTML"}` });

    // 3. Runtime + browser ---------------------------------------------------------------
    const runtime = await runRuntimeStage({ repoRoot: clone.localPath, analysis, scan: repo.scan, options, outputDir, report });
    await save("runtime-analysis.json", { ...runtime, logExcerpt: runtime.logExcerpt.map((l) => redactSecrets(l).text) });
    if (runtime.status === "ok") report({ step: "browser", status: "done", message: `${runtime.screens.length} screens discovered, ${runtime.flows.length} flows` });

    // 4. UI/UX ------------------------------------------------------------------------------
    const ui = analyzeUI(runtime, analysis.designTokens);
    await save("ui-analysis.json", ui);
    report({ step: "ui", status: "done", message: `UI system: ${ui.visualSystem.colors.mode}, accent ${ui.visualSystem.colors.accent}, ${ui.visualSystem.typography.display}; ${ui.designLanguage.join(", ")} (confidence ${ui.designConfidence})` });

    // 5. Claims + DNA ---------------------------------------------------------------------------
    const claims = verifyClaims(analysis, runtime, repo.scan);
    await save("claim-verification.json", { verified: claims.filter((c) => c.verified), unsupported: claims.filter((c) => !c.verified), policy: "Metrics about users, revenue, accuracy, performance, customers, funding or downloads are never shown unless asserted by shipped tests/benchmarks." });
    const dna = buildProductDNA(analysis, runtime, ui, claims, options.targetAudience);
    await save("product-dna.json", dna);
    report({ step: "dna", status: "done", message: `Product DNA: ${dna.category}; ${dna.verified_features.length} verified features; ${claims.filter((c) => c.verified).length}/${claims.length} claims verified` });

    // 6. Story + storyboard -------------------------------------------------------------------------
    const plan = buildStoryPlan(dna, options);
    const storyboard = buildStoryboard(dna, plan, options);
    await save("launch-plan.md", launchPlanMarkdown(dna, plan, storyboard));
    report({ step: "story", status: "done", message: `Angle: ${plan.strongestAngle.slice(0, 110)}…` });

    // 7. Audio ------------------------------------------------------------------------------------------
    const music = options.music ? await selectMusic(plan.tone.preset, storyboard.duration) : null;
    if (options.music && !music) report({ step: "audio", status: "warn", message: "No music track available; continuing without music" });
    const aligned = alignScenesToMusic(storyboard, music);
    storyboard.scenes = aligned.scenes;
    storyboard.music = music ?? undefined;
    const sfx = placeSfx(storyboard.scenes, options.sfx);
    await save("storyboard.md", storyboardMarkdown(storyboard, dna));
    await save("storyboard.json", storyboardJson(storyboard));
    report({ step: "storyboard", status: "done", message: `${storyboard.scenes.length} scenes / ${storyboard.duration}s; ${aligned.locks.length} beat lock(s); ${sfx.length} SFX` });
    let audioData = null;
    if (music && plan.audio.reactive !== "none") {
      audioData = await extractAudioData(music.file, storyboard.duration, storyboard.fps).catch(() => null);
      if (audioData) await save("assets/audio-data.json", audioData);
    }

    // 8. Composition brief + Hyperframes composition ----------------------------------------------------------
    await save("composition-brief.md", compositionBriefMarkdown(dna, plan, storyboard, storyboard.scenes, music, sfx, aligned.locks, path.basename(outputDir)));
    const compositionDir = path.join(outputDir, "composition");
    const hfVersion = (await hyperframesVersion()) ?? "0.8.52";
    const screenFiles: CompositionInput["screenFiles"] = new Map();
    for (const s of runtime.screens) screenFiles.set(s.id, { file: s.file, fullPageFile: s.fullPageFile, interactionFile: s.interaction?.file, width: s.viewport.width, height: s.viewport.height, fullHeight: s.fullPageHeight, mobileFile: runtime.mobileScreens?.find((m) => m.route === s.route)?.file });
    for (const s of runtime.sourceDerived) screenFiles.set(s.id, { file: s.file, width: 1440, height: 900 });
    const fontFiles = findFontFiles(repo.scan.files.map((f) => ({ rel: f.rel, abs: f.abs })), [ui.visualSystem.typography.display, ui.visualSystem.typography.body]);
    const built = await buildComposition({ outputDir, compositionDir, dna, storyboard, scenes: storyboard.scenes, music, sfx, audioData, reactive: plan.audio.reactive, screenFiles, fontFiles, hyperframesVersion: hfVersion });
    files["composition/index.html"] = path.join(compositionDir, "index.html");
    report({ step: "hyperframes", status: "done", message: `Composition written to ${path.relative(cwd, compositionDir) || compositionDir}` });

    // 9. Share copy ----------------------------------------------------------------------------------------
    const copy = generateShareCopy(dna, plan, clone.url);
    await save("share-copy/linkedin.md", copy.linkedin + "\n");
    await save("share-copy/x.md", copy.x + "\n");
    await save("share-copy/product-hunt.md", copy.productHunt + "\n");
    await save("share-copy/short-caption.md", copy.shortCaption + "\n");
    report({ step: "copy", status: "done", message: "Share copy written (LinkedIn, X, Product Hunt, short caption)" });

    // 10. Render ---------------------------------------------------------------------------------------------
    let render: RenderResult = { status: "not_rendered", reason: "render disabled (--no-render)" };
    if (options.render) {
      const r = await renderComposition({ compositionDir, outputVideo: path.join(outputDir, "launch.mp4"), outputPoster: path.join(outputDir, "poster.png"), quality: options.quality, timeoutMs: options.timeouts.render, heroTime: built.heroTime, report });
      const { check, ...rest } = r;
      render = rest;
      if (check) await save("hyperframes-check.json", check.raw ?? check);
      if (render.videoPath) files["launch.mp4"] = render.videoPath;
      if (render.posterPath) files["poster.png"] = render.posterPath;
    }
    await save("render-status.json", render);

    // 11. Quality gate + manifest --------------------------------------------------------------------------------------
    const gate = runQualityGate({ options, repo: analysis, runtime, ui, dna, storyboard, render, files, shareCopyText: [copy.linkedin, copy.x, copy.productHunt, copy.shortCaption].join("\n") });
    await save("quality-gate.json", gate);
    const result: LaunchResult = { ok: gate.passed && (!options.render || render.status === "rendered"), outputDir, steps, repositoryAnalysis: analysis, runtimeAnalysis: runtime, uiAnalysis: ui, productDNA: dna, storyboard, render, qualityGate: gate, files };
    await save("launch-result.json", { ok: result.ok, outputDir, summary: summaryLines({ options, repo: analysis, runtime, ui, dna, storyboard, render, files, shareCopyText: "" }, gate), files: Object.keys(files), render, qualityGate: gate, steps });
    files["launch-result.json"] = path.join(outputDir, "launch-result.json");
    return result;
  } finally {
    // Clean the isolated clone unless the user pointed at a local directory.
    if (!clone.isLocal && !options.workspaceDir) await removeDir(clone.localPath).catch(() => {});
  }
}

/** Re-run check + render for an existing launch-output directory (after manual/agent edits to the composition). */
export async function renderExisting(outputDir: string, opts: { quality?: LaunchOptions["quality"]; report?: ProgressReporter; heroTime?: number; timeoutMs?: number } = {}): Promise<RenderResult> {
  const compositionDir = path.join(outputDir, "composition");
  const r = await renderComposition({ compositionDir, outputVideo: path.join(outputDir, "launch.mp4"), outputPoster: path.join(outputDir, "poster.png"), quality: opts.quality ?? "looks", timeoutMs: opts.timeoutMs ?? 900_000, heroTime: opts.heroTime ?? (await guessHeroTime(outputDir)), report: opts.report });
  const { check, ...rest } = r;
  if (check) await writeJson(path.join(outputDir, "hyperframes-check.json"), check.raw ?? check);
  await writeJson(path.join(outputDir, "render-status.json"), rest);
  return rest;
}

async function guessHeroTime(outputDir: string): Promise<number> {
  try {
    const sb = JSON.parse(await (await import("node:fs/promises")).readFile(path.join(outputDir, "storyboard.json"), "utf8")) as { scenes: Array<{ purpose: string; start: number; duration: number }>; duration: number };
    const hero = sb.scenes.find((s) => s.purpose === "hero");
    return hero ? Math.round((hero.start + Math.max(1.4, hero.duration * 0.55)) * 100) / 100 : sb.duration * 0.6;
  } catch {
    return 10;
  }
}

function findFontFiles(files: Array<{ rel: string; abs: string }>, families: string[]): CompositionInput["fontFiles"] {
  const out: CompositionInput["fontFiles"] = [];
  const fonts = files.filter((f) => /\.(woff2|woff|ttf|otf)$/i.test(f.rel) && !/(^|\/)(node_modules|dist|build)\//.test(f.rel));
  for (const fam of families) {
    const key = fam.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key || /^(systemui|uisansserif|uimonospace|inherit|sansserif|serif|monospace|arial|helvetica)$/.test(key)) continue;
    const match = fonts.filter((f) => path.basename(f.rel).toLowerCase().replace(/[^a-z0-9]/g, "").includes(key));
    if (!match.length) continue;
    const pick = match.find((f) => /(regular|400|variable|vf|\[wght\])/i.test(f.rel)) ?? match.find((f) => /\.woff2$/i.test(f.rel)) ?? match[0];
    if (!out.some((o) => o.family === fam)) out.push({ family: fam, file: pick.abs });
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
