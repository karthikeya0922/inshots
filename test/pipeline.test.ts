import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { scanRepository } from "../src/repository/scanner.js";
import { analyzeRepository } from "../src/repository/index.js";
import { verifyClaims, isSafeCopy } from "../src/intelligence/claim-verifier.js";
import { buildProductDNA } from "../src/intelligence/product-dna.js";
import { buildStoryPlan, resolveTone, shortenForHook } from "../src/intelligence/story-engine.js";
import { analyzeFlows } from "../src/intelligence/flows.js";
import { buildStoryboard, motionFor } from "../src/storyboard/index.js";
import { analyzeUI } from "../src/ui/design-system.js";
import { buildComposition } from "../src/hyperframes/composition.js";
import { generateShareCopy } from "../src/copy/index.js";
import { alignScenesToMusic, placeSfx, selectMusic } from "../src/audio/index.js";
import { withDefaults } from "../src/connector/pipeline.js";
import { runQualityGate } from "../src/output/index.js";
import { containsBannedPhrase } from "../src/shared/text.js";
import type { RuntimeAnalysis, Screen } from "../src/types.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/** Synthetic screens standing in for a browser session (no Playwright needed in unit tests). */
function screen(route: string, over: Partial<Screen> & { components: string[]; headings: string[] }): Screen {
  const id = route === "/" ? "desktop-home" : "desktop-" + route.replace(/\W+/g, "-").replace(/^-|-$/g, "");
  return {
    id,
    route,
    url: "http://127.0.0.1:5173" + route,
    title: over.title ?? over.headings[0] ?? route,
    file: `assets/runtime/${id}.png`,
    viewport: { width: 1440, height: 900 },
    dom: {
      title: over.headings[0] ?? "",
      headings: over.headings,
      buttons: ["New alert rule", "Last 24h"],
      links: [],
      navItems: ["Dashboard", "Metric explorer", "Alert rules"],
      forms: over.components.includes("form") ? 1 : 0,
      inputs: 2,
      tables: over.components.includes("table") ? 1 : 0,
      charts: over.components.includes("chart") ? 1 : 0,
      images: 0,
      cards: over.components.includes("cards") ? 4 : 0,
      hasSidebar: over.components.includes("sidebar"),
      hasNavbar: true,
      hasDialog: false,
      tabs: 0,
      badges: 3,
      textLength: 900,
      authWall: over.components.includes("auth"),
      bodyBackground: "rgb(11, 18, 32)",
      bodyColor: "rgb(229, 231, 235)",
      overflowsViewport: false,
    },
    styles: {
      backgrounds: { "rgb(11, 18, 32)": 900000, "rgb(17, 24, 39)": 300000, "rgb(34, 211, 238)": 4000 },
      textColors: { "rgb(229, 231, 235)": 800, "rgb(156, 163, 175)": 300 },
      fontFamilies: { "IBM Plex Sans": 1000, "JetBrains Mono": 80 },
      fontSizes: { "14px": 800, "24px": 60 },
      fontWeights: { "400": 800, "700": 200 },
      borderRadii: { "10px": 20, "999px": 6 },
      shadows: { "rgba(0, 0, 0, 0.25) 0px 8px 30px 0px": 6 },
      gradients: [],
      backdropFilters: 0,
      iconCount: 12,
      monospaceUsage: 80,
    },
    components: over.components,
    richness: over.richness ?? 0.6,
    importance: over.importance ?? 0.7,
    score: over.score ?? 0.65,
    discoveredVia: "static-route",
    captureMs: 100,
    ...(over.interaction ? { interaction: over.interaction } : {}),
  };
}

async function buildStage() {
  const dir = path.join(FIXTURES, "vite-react-saas");
  const repo = await analyzeRepository({ localPath: dir, url: "https://github.com/example/signalgrid", isLocal: true, workspaceDir: "" });
  const screens = [
    screen("/dashboard", { components: ["navbar", "sidebar", "table", "chart", "badges"], headings: ["Anomaly feed"], score: 0.72, interaction: { action: "click", target: "New alert rule", file: "assets/runtime/desktop-dashboard-after-click.png" } }),
    screen("/explorer", { components: ["navbar", "sidebar", "cards", "chart"], headings: ["Metric explorer"], score: 0.77 }),
    screen("/alerts", { components: ["navbar", "sidebar", "table", "form"], headings: ["Alert rules"], score: 0.58 }),
    screen("/investigations", { components: ["navbar", "sidebar", "cards", "form"], headings: ["Investigation · a-1042"], score: 0.4 }),
    screen("/login", { components: ["form", "auth"], headings: ["Sign in"], score: 0.1, importance: 0.1, richness: 0.1 }),
  ];
  const runtime: RuntimeAnalysis = { status: "ok", url: "http://127.0.0.1:5173", screens, flows: [], logExcerpt: [], sourceDerived: [] };
  runtime.flows = analyzeFlows(screens, repo.analysis.features);
  const ui = analyzeUI(runtime, repo.analysis.designTokens);
  const claims = verifyClaims(repo.analysis, runtime, repo.scan);
  const dna = buildProductDNA(repo.analysis, runtime, ui, claims);
  return { repo, runtime, ui, claims, dna };
}

test("claim verification: metrics are unsupported, evidence-backed features verified", async () => {
  const { claims } = await buildStage();
  const unsupported = claims.filter((c) => !c.verified).map((c) => c.claim);
  assert.ok(unsupported.some((c) => /500\+/.test(c)), unsupported.join(" | "));
  assert.ok(unsupported.some((c) => /99\.99%/.test(c)));
  const verified = claims.filter((c) => c.verified).map((c) => c.claim);
  assert.ok(verified.includes("Metric explorer"));
  assert.ok(verified.includes("Built with React"));
  assert.ok(verified.includes("Data visualized in charts"), "runtime-observed claim");
  assert.ok(!isSafeCopy("Trusted by 500+ engineering teams", claims));
  assert.ok(isSafeCopy("Metric explorer", claims));
});

test("UI analysis derives a dark visual system with the product accent and real font", async () => {
  const { ui } = await buildStage();
  assert.equal(ui.status, "runtime");
  assert.equal(ui.visualSystem.colors.mode, "dark");
  assert.equal(ui.visualSystem.colors.accent, "#22d3ee");
  assert.equal(ui.visualSystem.colors.background, "#0b1220");
  assert.equal(ui.visualSystem.typography.body, "IBM Plex Sans");
  assert.match(ui.visualSystem.typography.bodyStack, /"IBM Plex Sans"/);
  assert.ok(ui.designLanguage.includes("dashboard"));
  assert.equal(ui.layout, "dashboard");
});

test("user flows: core journey follows entry → dashboard → results and skips the auth wall", async () => {
  const { runtime } = await buildStage();
  const core = runtime.flows.find((f) => f.id === "core-journey")!;
  assert.ok(core, "core journey exists");
  assert.ok(core.steps.length >= 2);
  assert.ok(!core.steps.some((s) => s.screenId === "desktop-login"));
  assert.ok(runtime.flows.every((f) => f.score > 0 && f.score <= 1));
});

test("product DNA is the source of truth: features, screens, flows, identity, claims", async () => {
  const { dna } = await buildStage();
  assert.equal(dna.name, "SignalGrid");
  assert.equal(dna.category, "analytics dashboard");
  assert.ok(dna.verified_features.length >= 4);
  assert.ok(dna.screens.length === 5);
  assert.ok(dna.user_flows.length >= 1);
  assert.equal(dna.visual_identity.colors.accent, "#22d3ee");
  assert.ok(dna.unsupported_claims.length >= 2);
  assert.equal(dna.license, "MIT");
  assert.ok(dna.screens.find((s) => s.route === "/dashboard")?.headline === "Anomaly feed");
});

test("story plan: hook comes from the verified tagline, angle names a real screen, tone inferred", async () => {
  const { dna } = await buildStage();
  const plan = buildStoryPlan(dna, withDefaults({ repositoryUrl: "x" }));
  assert.equal(plan.hook.text, "Anomaly detection dashboard for streaming metrics");
  assert.match(plan.strongestAngle, /Open on the real .* screen/);
  assert.ok(plan.uiMoments.length >= 3);
  assert.ok(["polished", "cinematic", "technical"].includes(plan.tone.preset));
  assert.equal(resolveTone("minimal Apple-style", dna).preset, "minimal");
  assert.equal(resolveTone("make it feel like a chaotic startup launch", dna).preset, "playful");
  assert.equal(shortenForHook("A calm, keyboard-first notes app for people who think in outlines"), "A calm, keyboard-first notes app");
  assert.equal(shortenForHook("Short and sweet"), "Short and sweet");
});

test("storyboard: 15–30s, hook→reveal→workflow→feature→hero→cta, real screens, verified copy, UI-aware motion", async () => {
  const { dna } = await buildStage();
  const options = withDefaults({ repositoryUrl: "x", duration: 24 });
  const plan = buildStoryPlan(dna, options);
  const sb = buildStoryboard(dna, plan, options);
  assert.ok(sb.duration >= 15 && sb.duration <= 30, `duration ${sb.duration}`);
  assert.equal(sb.scenes[0].purpose, "hook");
  assert.equal(sb.scenes[1].purpose, "reveal");
  assert.equal(sb.scenes.at(-1)!.purpose, "cta");
  assert.ok(sb.scenes.some((s) => s.purpose === "hero"));
  const real = sb.scenes.filter((s) => s.sourceKind === "screenshot" || s.sourceKind === "full-page");
  assert.ok(real.length >= sb.scenes.length - 2, "almost every scene shows real UI");
  for (const s of sb.scenes) {
    assert.ok(s.verifiedCopy.includes(s.text), `${s.text} is verified`);
    assert.ok(!containsBannedPhrase(s.text));
    assert.ok(!/500\+|99\.99/.test(`${s.text} ${s.subtext ?? ""}`));
  }
  // Timeline is contiguous.
  let t = 0;
  for (const s of sb.scenes) {
    assert.ok(Math.abs(s.start - t) < 0.02, `scene ${s.scene} starts at ${s.start}, expected ${t}`);
    t = Math.round((t + s.duration) * 100) / 100;
  }
  const hero = sb.scenes.find((s) => s.purpose === "hero")!;
  assert.ok(["chart-reveal", "row-reveal", "card-stagger", "slow-push"].includes(hero.motion));
  // UI-aware motion mapping
  const chartScreen = dna.screens.find((s) => s.components.includes("chart"))!;
  assert.equal(motionFor(chartScreen, "hero", "landscape"), "chart-reveal");
  const tableScreen = dna.screens.find((s) => s.components.includes("table") && !s.components.includes("chart"))!;
  assert.equal(motionFor(tableScreen, "workflow", "landscape"), "pan-vertical");
  assert.equal(motionFor(chartScreen, "workflow", "vertical"), "slow-push");
});

test("music selection + beat alignment + SFX restraint", async () => {
  const { dna } = await buildStage();
  const options = withDefaults({ repositoryUrl: "x" });
  const plan = buildStoryPlan(dna, options);
  const sb = buildStoryboard(dna, plan, options);
  const music = await selectMusic(plan.tone.preset, sb.duration);
  assert.ok(music, "bundled music available");
  assert.ok(music!.beats.length > 10);
  assert.ok(music!.strongCues.length > 0);
  const aligned = alignScenesToMusic(sb, music);
  assert.equal(Math.round(aligned.scenes.reduce((a, s) => a + s.duration, 0) * 10) / 10, sb.duration, "alignment preserves total duration");
  for (const lock of aligned.locks) assert.ok(Math.abs(lock.to - lock.from) <= 0.15);
  for (const s of aligned.scenes) assert.ok(s.duration >= 1.6);
  const sfx = placeSfx(aligned.scenes, true);
  assert.ok(sfx.length <= 5);
  for (let i = 1; i < sfx.length; i++) assert.ok(sfx[i].at - sfx[i - 1].at >= 1.2, "no SFX pile-ups");
  assert.equal(placeSfx(aligned.scenes, false).length, 0);
});

test("composition: standalone Hyperframes project with timed clips, product palette, audio tracks", async () => {
  const { dna } = await buildStage();
  const options = withDefaults({ repositoryUrl: "x" });
  const plan = buildStoryPlan(dna, options);
  const sb = buildStoryboard(dna, plan, options);
  const music = await selectMusic(plan.tone.preset, sb.duration);
  const aligned = alignScenesToMusic(sb, music);
  const sfx = placeSfx(aligned.scenes, true);
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "hfl-test-"));
  // Fake screenshot assets (1x1 PNG) for every screen referenced.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const screenFiles = new Map<string, { file: string; width: number; height: number; interactionFile?: string }>();
  for (const s of dna.screens) {
    await fs.mkdir(path.join(out, path.dirname(s.file)), { recursive: true });
    await fs.writeFile(path.join(out, s.file), png);
    screenFiles.set(s.id, { file: s.file, width: 1440, height: 900 });
  }
  const compositionDir = path.join(out, "composition");
  const built = await buildComposition({ outputDir: out, compositionDir, dna, storyboard: sb, scenes: aligned.scenes, music, sfx, audioData: null, reactive: "subtle", screenFiles, fontFiles: [], hyperframesVersion: "0.8.52" });
  const html = await fs.readFile(path.join(compositionDir, "index.html"), "utf8");
  assert.match(html, /data-composition-id="launch"/);
  assert.match(html, /window\.__timelines\["launch"\] = tl/);
  assert.match(html, /gsap\.timeline\(\{ paused: true \}\)/);
  assert.equal((html.match(/class="clip scene/g) ?? []).length, aligned.scenes.length);
  assert.match(html, /<audio id="music" data-timeline-role="music"/);
  assert.match(html, /data-automation=/);
  assert.ok((html.match(/<audio id="sfx-/g) ?? []).length === sfx.length);
  assert.match(html, /#22d3ee/i, "product accent is used");
  assert.match(html, /"IBM Plex Sans"/, "product font is used");
  assert.match(html, /fonts\.googleapis\.com\/css2\?family=IBM\+Plex\+Sans/);
  assert.ok(!/autoAlpha|visibility/.test(html.split("<script>").pop()!), "never animates clip visibility");
  assert.ok(!/crossorigin/.test(html));
  assert.ok(built.heroTime > 0 && built.heroTime < sb.duration);
  for (const f of ["hyperframes.json", "package.json", "meta.json"]) assert.ok(await fs.stat(path.join(compositionDir, f)));
  assert.ok(await fs.stat(path.join(compositionDir, "assets", "music", path.basename(music!.file))));
  await fs.rm(out, { recursive: true, force: true });
});

test("share copy: platform variants use verified material only", async () => {
  const { dna } = await buildStage();
  const plan = buildStoryPlan(dna, withDefaults({ repositoryUrl: "x" }));
  const copy = generateShareCopy(dna, plan, "https://github.com/example/signalgrid");
  for (const text of [copy.linkedin, copy.x, copy.productHunt, copy.shortCaption]) {
    assert.ok(!/500\+|99\.99|trusted by/i.test(text), text);
    assert.ok(!containsBannedPhrase(text), text);
    assert.match(text, /SignalGrid/);
  }
  assert.match(copy.linkedin, /https:\/\/github\.com\/example\/signalgrid/);
  assert.ok(copy.x.length <= 280);
  assert.match(copy.productHunt, /\*\*What it does\*\*/);
  assert.ok(copy.shortCaption.length <= 160);
});

test("quality gate passes for a verified storyboard and flags fabricated metrics", async () => {
  const { repo, runtime, ui, dna } = await buildStage();
  const options = withDefaults({ repositoryUrl: "x", render: false });
  const plan = buildStoryPlan(dna, options);
  const sb = buildStoryboard(dna, plan, options);
  const files = Object.fromEntries(["product-dna.json", "repository-analysis.json", "runtime-analysis.json", "ui-analysis.json", "claim-verification.json", "launch-plan.md", "storyboard.md", "composition-brief.md", "share-copy/linkedin.md", "share-copy/x.md", "share-copy/product-hunt.md", "share-copy/short-caption.md"].map((f) => [f, f]));
  const gate = runQualityGate({ options, repo: repo.analysis, runtime, ui, dna, storyboard: sb, render: { status: "not_rendered", reason: "render disabled" }, files, shareCopyText: "" });
  assert.ok(gate.passed, gate.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.message}`).join("\n"));
  const tampered = { ...sb, scenes: sb.scenes.map((s, i) => (i === 2 ? { ...s, text: "Trusted by 500+ engineering teams" } : s)) };
  const bad = runQualityGate({ options, repo: repo.analysis, runtime, ui, dna, storyboard: tampered, render: { status: "not_rendered" }, files, shareCopyText: "" });
  assert.ok(!bad.passed);
  assert.ok(bad.checks.some((c) => c.id === "claims.verified" && !c.ok));
});

test("scanner never loads .env contents", async () => {
  const dir = path.join(FIXTURES, "static-site");
  await fs.writeFile(path.join(dir, ".env"), "API_KEY=sk-" + "test-should-never-appear-1234567890abcdef\n");
  try {
    const scan = await scanRepository(dir);
    const env = scan.files.find((f) => f.rel === ".env");
    assert.ok(env, ".env is listed");
    assert.equal(env!.content, undefined, ".env content is never read");
    assert.ok(scan.secrets.redactedFiles.includes(".env"));
  } finally {
    await fs.rm(path.join(dir, ".env"), { force: true });
  }
});
