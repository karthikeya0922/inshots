import type { Claim, LaunchOptions, MotionPreset, ProductDNA, Scene, ScenePurpose, StoryPlan, Storyboard, TonePreset, VideoFormat } from "../types.js";
import { TONE_PRESETS } from "../intelligence/story-engine.js";
import { isSafeCopy } from "../intelligence/claim-verifier.js";
import { containsBannedPhrase, readingTime, shortPhrase, truncate } from "../shared/text.js";
import { bulletTail } from "../repository/feature-analyzer.js";

export const FORMAT_SIZES: Record<VideoFormat, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};

type DnaScreen = ProductDNA["screens"][number];

/**
 * Storyboard generation.
 *
 * Structure (adapted, not fixed):
 *   HOOK → PRODUCT REVEAL → CORE WORKFLOW (1–3 scenes) → KEY FEATURES (0–2) → HERO UI → CTA
 *
 * Every scene references a real captured screen (or a source-derived card
 * when the app could not run). Text is limited to verified copy.
 */
export function buildStoryboard(dna: ProductDNA, plan: StoryPlan, options: LaunchOptions): Storyboard {
  const { width, height } = FORMAT_SIZES[options.format];
  const total = clamp(options.duration, 15, 30);
  const tone = plan.tone.preset;
  const claims = [...dna.verified_claims, ...dna.unsupported_claims];
  const safe = (s: string) => isSafeCopy(s, claims) && !containsBannedPhrase(s);
  const screens = [...dna.screens].sort((a, b) => b.score - a.score);
  const byId = new Map(screens.map((s) => [s.id, s]));
  const notes: string[] = [];
  const used = new Set<string>();
  const take = (pred: (s: DnaScreen) => boolean): DnaScreen | undefined => {
    const s = screens.find((x) => !used.has(x.id) && pred(x));
    if (s) used.add(s.id);
    return s;
  };

  // ---- Pick material ---------------------------------------------------------
  const isReal = (s: DnaScreen) => !s.id.startsWith("source-");
  const heroScreen = take((s) => isReal(s) && (s.purposeHint === "hero" || s.components.includes("chart"))) ?? take((s) => isReal(s)) ?? take(() => true);
  const entryScreen = take((s) => isReal(s) && s.route === "/") ?? take((s) => isReal(s) && s.purposeHint === "reveal") ?? take((s) => s.id === "source-readme");
  const flow = dna.user_flows[0];
  const workflowScreens: DnaScreen[] = [];
  if (flow) {
    for (const step of flow.steps) {
      const s = byId.get(step.screenId);
      if (s && !used.has(s.id) && workflowScreens.length < 3) {
        used.add(s.id);
        workflowScreens.push(s);
      }
    }
  }
  while (workflowScreens.length < 2) {
    const s = take((x) => isReal(x) && x.purposeHint === "workflow") ?? take((x) => isReal(x)) ?? take(() => true);
    if (!s) break;
    workflowScreens.push(s);
  }
  const featureScreens: DnaScreen[] = [];
  for (let i = 0; i < 2; i++) {
    const s = take((x) => x.score >= 0.35) ?? take(() => true);
    if (s) featureScreens.push(s);
  }
  const features = dna.verified_features;
  const usedFeatures = new Set<string>();

  // ---- Allocate durations ------------------------------------------------------
  const [minScenes, maxScenes] = TONE_PRESETS[tone].scenes;
  const material = 2 + workflowScreens.length + featureScreens.length + 1; // hook, reveal, workflow.., features.., hero(+cta)
  const sceneCount = clamp(material + 1, minScenes, Math.min(maxScenes, Math.floor(total / 2.4)));
  const weights: Array<[ScenePurpose, number]> = [["hook", 1.15], ["reveal", 1.25]];
  for (let i = 0; i < workflowScreens.length && weights.length < sceneCount - 2; i++) weights.push(["workflow", 1.2]);
  for (let i = 0; i < featureScreens.length && weights.length < sceneCount - 2; i++) weights.push(["feature", 1.0]);
  weights.push(["hero", 1.3]);
  weights.push(["cta", 0.95]);
  const wsum = weights.reduce((a, [, w]) => a + w, 0);
  const durations = weights.map(([, w]) => round1((w / wsum) * total));
  // Fix rounding drift on the hero scene.
  const drift = round1(total - durations.reduce((a, b) => a + b, 0));
  durations[durations.length - 2] = round1(durations[durations.length - 2] + drift);

  // ---- Build scenes ------------------------------------------------------------
  const scenes: Scene[] = [];
  let t = 0;
  let wi = 0;
  let fi = 0;
  const transitions = TONE_PRESETS[tone].transitions;
  const pick = <T,>(arr: T[], i: number) => arr[i % arr.length];

  weights.forEach(([purpose], idx) => {
    const duration = durations[idx];
    const n = scenes.length + 1;
    const transition = idx === 0 ? "cut" : pick(transitions, idx);
    const tDur = transition === "cut" ? 0 : tone === "bold" || tone === "playful" ? 0.35 : tone === "minimal" ? 0.7 : 0.5;
    let scene: Scene;
    switch (purpose) {
      case "hook": {
        const src = heroScreen ?? entryScreen;
        scene = mk(n, t, duration, "hook", src, plan.hook.text, plan.hook.sub, motionFor(src, "hook", options.format), transition, tDur, { intent: "music enters low; one soft accent as the hook settles", beatLock: false });
        scene.motionNotes = src ? `The real ${src.title} sits behind the hook, pushed in slowly and slightly dimmed; type is the focus for the first 2 seconds.` : "Type-only hook on the product background.";
        break;
      }
      case "reveal": {
        const src = entryScreen ?? heroScreen;
        const featureLine = fitList(features.map((f) => f.name).filter((n) => safe(n) && n !== "HTTP API"), 58);
        const taglineUsedInHook = plan.hook.text && dna.tagline.toLowerCase().startsWith(plan.hook.text.toLowerCase().slice(0, 20));
        const taglineWords = dna.tagline.trim().split(/\s+/).length;
        const sub = featureLine && (taglineUsedInHook || taglineWords > 8) ? featureLine : safe(dna.tagline) ? truncate(dna.tagline, 90) : featureLine || undefined;
        scene = mk(n, t, duration, "reveal", src, dna.name, sub, motionFor(src, "reveal", options.format), transition, tDur, { intent: "product name lands on a strong cue; music opens up", beatLock: true, sfx: sfxFor("reveal", tone, options.sfx) });
        scene.motionNotes = src ? `Name lockup over the ${src.title}; the screenshot scales from 1.06→1.0 as the name settles.` : "Name lockup on product background.";
        break;
      }
      case "workflow": {
        const src = workflowScreens[wi];
        const step = flow?.steps.find((s) => s.screenId === src?.id);
        const feature = features.find((f) => f.route === src?.route);
        // A README-named feature beats a generic journey label ("Alert rules" over "Alerts"); journey labels beat page titles.
        const label = (feature && feature.sources.includes("readme") ? feature.name : undefined) ?? step?.label ?? feature?.name ?? src?.title ?? "In use";
        const headline = src?.headline && safe(src.headline) && src.headline.toLowerCase() !== label.toLowerCase() ? shortPhrase(src.headline, 60) ?? undefined : undefined;
        const desc = (feature && feature.sources.includes("readme") && safe(feature.description) ? shortPhrase(bulletTail(feature.description)) ?? undefined : undefined) ?? headline;
        scene = mk(n, t, duration, "workflow", src, truncate(label, 40), desc, motionFor(src, "workflow", options.format), transition, tDur, { intent: "steady bed; a click/tick when the interaction fires", sfx: sfxFor("workflow", tone, options.sfx) });
        if (feature) usedFeatures.add(feature.id);
        if (step?.action) scene.interaction = { kind: "click", target: step.action.replace(/^click\s*/, "").replace(/"/g, "") };
        scene.motionNotes = motionNotes(scene.motion, src);
        wi++;
        break;
      }
      case "feature": {
        const src = featureScreens[fi];
        const feature = features.find((f) => f.route === src?.route) ?? features.find((f) => !scenes.some((s) => s.text === f.name)) ?? features[fi];
        const text = feature ? truncate(feature.name, 36) : truncate(src?.title ?? "Feature", 36);
        const headline = src?.headline && safe(src.headline) && src.headline.toLowerCase() !== text.toLowerCase() ? shortPhrase(src.headline, 60) ?? undefined : undefined;
        const sub = (feature && feature.sources.includes("readme") && safe(feature.description) ? shortPhrase(bulletTail(feature.description)) ?? undefined : undefined) ?? headline;
        if (feature) usedFeatures.add(feature.id);
        scene = mk(n, t, duration, "feature", src, text, sub, motionFor(src, "feature", options.format), transition, tDur, { intent: "soft drop on the label", sfx: sfxFor("feature", tone, options.sfx) });
        scene.motionNotes = motionNotes(scene.motion, src);
        fi++;
        break;
      }
      case "hero": {
        const src = heroScreen;
        const heroFeature = features.find((f) => f.route === src?.route && !usedFeatures.has(f.id)) ?? features.find((f) => !usedFeatures.has(f.id) && f.name !== "HTTP API") ?? features.find((f) => f.route === src?.route) ?? features[0];
        const text = heroFeature ? truncate(heroFeature.name, 40) : src?.title ?? dna.name;
        scene = mk(n, t, duration, "hero", src, text, undefined, motionFor(src, "hero", options.format), transition, tDur, { intent: "the one impact of the film lands here", beatLock: true, sfx: sfxFor("hero", tone, options.sfx) });
        scene.motionNotes = `${motionNotes(scene.motion, src)} This is the widest, longest look at the real interface — keep it readable.`;
        break;
      }
      default: {
        scene = mk(n, t, duration, "cta", null, plan.cta.text, plan.cta.sub, "hold", transition, tDur, { intent: "music resolves and fades under the name", sfx: sfxFor("cta", tone, options.sfx) });
        scene.sourceKind = "brand";
        scene.motionNotes = "Name and one line, centered, on the product background; accent underline draws in; music fades.";
      }
    }
    // Readability floor: ensure the scene holds long enough for its text.
    const need = readingTime(scene.text) + (scene.subtext ? readingTime(scene.subtext) : 0) + 0.6;
    if (scene.duration < need) notes.push(`Scene ${scene.scene} (${scene.purpose}) is ${scene.duration}s but its copy needs ~${need.toFixed(1)}s; the composition shortens the subtext instead of speeding it up.`);
    if (scene.duration < need && scene.subtext) scene.subtext = shortPhrase(scene.subtext, 36) ?? undefined;
    scenes.push(scene);
    t = round1(t + duration);
  });

  // Verified copy per scene.
  for (const s of scenes) {
    s.verifiedCopy = [s.text, s.subtext].filter((x): x is string => !!x && safe(x));
    if (!safe(s.text)) {
      notes.push(`Scene ${s.scene} text "${s.text}" failed claim verification and was replaced by the product name.`);
      s.text = dna.name;
      s.verifiedCopy = [dna.name];
    }
  }
  if (!scenes.some((s) => s.sourceKind === "screenshot" || s.sourceKind === "full-page")) notes.push("No runtime screenshots available; the film uses source-derived cards (real code and README words).");

  return { duration: round1(scenes.reduce((a, s) => a + s.duration, 0)), format: options.format, width, height, fps: 30, tone, scenes, notes };
}

function mk(n: number, start: number, duration: number, purpose: ScenePurpose, src: DnaScreen | undefined | null, text: string, subtext: string | undefined, motion: MotionPreset, transition: Scene["transition"], tDur: number, audio: Scene["audio"]): Scene {
  const sourceKind: Scene["sourceKind"] = !src ? "text" : src.id.startsWith("source-") ? "source-card" : motion === "pan-vertical" && src.fullPageFile ? "full-page" : "screenshot";
  return {
    scene: n,
    id: `${purpose}-${n}`,
    start,
    duration,
    purpose,
    source: src?.id ?? null,
    sourceFile: sourceKind === "full-page" ? src?.fullPageFile : src?.file,
    sourceKind,
    text,
    subtext,
    verifiedCopy: [],
    motion,
    motionNotes: "",
    transition,
    transitionDuration: tDur,
    audio,
  };
}

/** UI-aware motion: derive the camera move from what the screen actually contains. */
export function motionFor(src: DnaScreen | undefined | null, purpose: ScenePurpose, format: VideoFormat): MotionPreset {
  if (!src) return "hold";
  const c = new Set(src.components);
  if (src.id.startsWith("source-")) return src.id === "source-readme" ? "slow-push" : "type-on";
  if (format === "vertical") return src.fullPageFile ? "device-scroll" : "slow-push";
  if (purpose === "hook") return c.has("sidebar") ? "parallax-drift" : "slow-push";
  if (purpose === "hero") return c.has("chart") ? "chart-reveal" : c.has("table") ? "row-reveal" : c.has("cards") ? "card-stagger" : "slow-push";
  if (c.has("table")) return "pan-vertical";
  if (c.has("cards") && purpose === "feature") return "card-stagger";
  if (c.has("chart")) return "focus-zoom";
  if (src.fullPageFile && (purpose === "workflow" || purpose === "feature")) return "pan-vertical";
  if (c.has("form")) return "focus-zoom";
  return purpose === "reveal" ? "slow-push" : "parallax-drift";
}

function motionNotes(m: MotionPreset, src?: DnaScreen | null): string {
  const t = src?.title ?? "the screen";
  switch (m) {
    case "slow-push":
      return `Slow push into ${t} (scale 1.0→1.06), no other motion.`;
    case "parallax-drift":
      return `${t} drifts a few pixels while the label sits still — layered depth without hiding the UI.`;
    case "pan-vertical":
      return `Camera pans down the full-page capture of ${t}, like a slow scroll; ends on the lower content.`;
    case "pan-horizontal":
      return `Gentle horizontal pan across ${t}.`;
    case "row-reveal":
      return `Rows of ${t} are revealed top-to-bottom with a soft wipe; one row highlights.`;
    case "card-stagger":
      return `Cards on ${t} rise into place one by one (staggered 0.12s), then the whole screen holds.`;
    case "focus-zoom":
      return `Push toward the most important region of ${t} (chart/form) and hold; label in the clear area.`;
    case "device-scroll":
      return `${t} in a phone frame; content scrolls slowly.`;
    case "chart-reveal":
      return `Push into the chart on ${t}; a soft mask wipes across it so the data appears to draw in.`;
    case "type-on":
      return `Source card for ${t}: lines type on quickly, then hold.`;
    default:
      return "Hold with a subtle scale breath.";
  }
}

function sfxFor(purpose: ScenePurpose, tone: TonePreset, enabled: boolean): string | undefined {
  if (!enabled) return undefined;
  const soft = tone === "minimal" || tone === "polished";
  switch (purpose) {
    case "reveal":
      return soft ? "interface/drop_002.ogg" : "impact/impactSoft_medium_001.ogg";
    case "workflow":
      return tone === "minimal" ? undefined : "interface/click_003.ogg";
    case "feature":
      return tone === "minimal" ? undefined : "interface/drop_001.ogg";
    case "hero":
      return tone === "cinematic" || tone === "bold" ? "impact/impactBell_heavy_000.ogg" : "impact/impactSoft_medium_002.ogg";
    case "cta":
      return soft ? "interface/bong_001.ogg" : "impact/impactBell_heavy_003.ogg";
    default:
      return undefined;
  }
}

/** Join as many items as fit within `max` characters using " · ". */
function fitList(items: string[], max: number): string {
  const out: string[] = [];
  for (const it of items) {
    const next = [...out, it].join(" · ");
    if (next.length > max) break;
    out.push(it);
  }
  return out.join(" · ");
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function storyboardMarkdown(sb: Storyboard, dna: ProductDNA): string {
  const lines: string[] = [];
  lines.push(`# Storyboard: ${dna.name}`, "");
  lines.push(`- Duration: **${sb.duration}s** · Format: **${sb.format}** (${sb.width}×${sb.height}) · Tone: **${sb.tone}** · ${sb.fps} fps`);
  lines.push(`- Real UI scenes: ${sb.scenes.filter((s) => s.sourceKind === "screenshot" || s.sourceKind === "full-page").length}/${sb.scenes.length}`, "");
  for (const s of sb.scenes) {
    lines.push(`## Scene ${s.scene} — ${s.purpose.toUpperCase()} — ${s.start}s → ${round1(s.start + s.duration)}s (${s.duration}s)`);
    lines.push(`- Source: ${s.sourceFile ? `\`${s.sourceFile}\`` : "none (text only)"} (${s.sourceKind})`);
    lines.push(`- Text: **${s.text}**${s.subtext ? ` — ${s.subtext}` : ""}`);
    lines.push(`- Motion: \`${s.motion}\` — ${s.motionNotes}`);
    if (s.interaction) lines.push(`- Interaction: ${s.interaction.kind} → "${s.interaction.target}"`);
    lines.push(`- Transition in: ${s.transition}${s.transitionDuration ? ` (${s.transitionDuration}s)` : ""}`);
    lines.push(`- Audio: ${s.audio.intent}${s.audio.sfx ? ` · SFX \`${s.audio.sfx}\`` : ""}${s.audio.beatLock ? " · beat-locked" : ""}`);
    lines.push("");
  }
  if (sb.notes.length) {
    lines.push("## Notes");
    for (const n of sb.notes) lines.push(`- ${n}`);
  }
  return lines.join("\n") + "\n";
}

export function storyboardJson(sb: Storyboard): unknown {
  return {
    ...sb,
    scenes: sb.scenes.map((s) => ({ scene: s.scene, duration: s.duration, start: s.start, source: s.sourceFile ?? null, purpose: s.purpose, text: s.text, subtext: s.subtext, motion: s.motion, transition: s.transition, audio: s.audio.sfx ? `${s.audio.intent} (${s.audio.sfx})` : s.audio.intent, interaction: s.interaction, verifiedCopy: s.verifiedCopy })),
  };
}

export function claimsUsedInStoryboard(sb: Storyboard, claims: Claim[]): Claim[] {
  const texts = sb.scenes.flatMap((s) => s.verifiedCopy.map((t) => t.toLowerCase()));
  return claims.filter((c) => texts.some((t) => t.includes(c.claim.toLowerCase()) || c.claim.toLowerCase().includes(t)));
}
