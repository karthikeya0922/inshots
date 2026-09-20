import type { MusicSelection, ProductDNA, Scene, SfxSelection, StoryPlan, Storyboard } from "../types.js";

/** launch-plan.md — the creative north star (inspired by brag-plan.md, but evidence-first). */
export function launchPlanMarkdown(dna: ProductDNA, plan: StoryPlan, storyboard: Storyboard): string {
  const flows = dna.user_flows.slice(0, 3);
  const vi = dna.visual_identity;
  const l: string[] = [];
  l.push(`# Launch Plan: ${dna.name}`, "");
  l.push(`## What is this product?`, plan.whatIsIt, "");
  l.push(`## What makes it interesting?`, plan.whatMakesItInteresting, "");
  l.push(`## Strongest verified angle`, plan.strongestAngle, "");
  l.push(`## First 2–3 seconds (hook)`, `**${plan.hook.text}**${plan.hook.sub ? ` — ${plan.hook.sub}` : ""}`, "", `_Why:_ ${plan.hook.rationale}`, "");
  l.push(`## Actual UI moments to show`);
  for (const m of plan.uiMoments) l.push(`- \`${m.screenId}\` — ${m.why}`);
  l.push("");
  l.push(`## User flows worth showing`);
  if (flows.length) for (const f of flows) l.push(`- **${f.name}** (score ${f.score}): ${f.steps.map((s) => s.label).join(" → ")}`);
  else l.push("- none captured — the film leans on the strongest individual screens");
  l.push("");
  l.push(`## Final CTA`, `**${plan.cta.text}**${plan.cta.sub ? ` — ${plan.cta.sub}` : ""}`, "");
  l.push(`## Tone`, `- Preset: ${plan.tone.preset}`, `- Creative direction: ${plan.tone.direction}`, `- Interpretation: ${plan.tone.interpretation}`, "");
  l.push(`## Format: ${storyboard.format} — ${storyboard.width}×${storyboard.height}`, `## Duration: ${storyboard.duration}s`, "");
  l.push(`## Visual identity (from the product)`);
  l.push(`- Mode: ${vi.colors.mode}`, `- Background: ${vi.colors.background}`, `- Surface: ${vi.colors.surface}`, `- Accent: ${vi.colors.accent}`, `- Text: ${vi.colors.text}`, `- Display font: ${vi.typography.display}`, `- Body font: ${vi.typography.body}`, `- Radius: ${vi.borderRadius}${vi.glass ? " · glass surfaces" : ""}`, `- Design language: ${vi.designLanguage.join(", ")}`, "");
  l.push(`## Verified features used`);
  for (const f of dna.verified_features.slice(0, 6)) l.push(`- **${f.name}** (${f.confidence}) — ${f.evidence.slice(0, 2).join(", ")}`);
  l.push("");
  if (dna.unsupported_claims.length) {
    l.push(`## Claims kept OUT of the video`);
    for (const c of dna.unsupported_claims.slice(0, 8)) l.push(`- "${c.claim}" — ${c.reason}`);
    l.push("");
  }
  l.push(`## Audio direction`, `- Role: ${plan.audio.role}`, `- Music: ${plan.audio.music ? "on" : "off"} · SFX: ${plan.audio.sfx ? "on" : "off"} · Audio-reactive: ${plan.audio.reactive}`, `- Restraint rule: ${plan.audio.restraint}`, "");
  l.push(`## Share copy (draft)`, plan.shareLine, "");
  return l.join("\n");
}

/** composition-brief.md — the focused handoff to Hyperframes. */
export function compositionBriefMarkdown(dna: ProductDNA, plan: StoryPlan, storyboard: Storyboard, scenes: Scene[], music: MusicSelection | null, sfx: SfxSelection[], locks: Array<{ sceneId: string; from: number; to: number; kind: string }>, outputDir: string): string {
  const vi = dna.visual_identity;
  const l: string[] = [];
  l.push(`# Hyperframes Composition Brief: ${dna.name}`, "");
  l.push(`## Project`, `- Product: ${dna.name} (${dna.category})`, `- Source: ${dna.runtime.status === "ok" ? `${dna.runtime.screenCount} screens captured from the running app` : `runtime ${dna.runtime.status}${dna.runtime.reason ? ` — ${dna.runtime.reason}` : ""}; source-derived visuals`}`, `- Audience: ${dna.audience}`, "");
  l.push(`## Output`, `- Composition directory: \`${outputDir}/composition/\``, `- Rendered video: \`${outputDir}/launch.mp4\``, `- Format: ${storyboard.format} — ${storyboard.width}×${storyboard.height} @ ${storyboard.fps}fps`, `- Duration: ${storyboard.duration}s`, "");
  l.push(`## Product angle`, plan.strongestAngle, "", `Hook: **${plan.hook.text}** · CTA: **${plan.cta.text}**`, "");
  l.push(`## Source screens & actual UI elements`);
  for (const s of dna.screens.filter((s) => scenes.some((sc) => sc.source === s.id))) l.push(`- \`${s.file}\` — ${s.route} · ${s.components.join(", ") || "source card"} · score ${s.score}`);
  l.push("");
  l.push(`## Verified copy (only these lines may appear)`);
  for (const line of Array.from(new Set(scenes.flatMap((s) => s.verifiedCopy)))) l.push(`- ${line}`);
  l.push("");
  l.push(`## Creative direction`, `- Tone: ${plan.tone.preset} — ${plan.tone.direction}`, `- Interpretation: ${plan.tone.interpretation}`, `- Avoid: generic SaaS language, abstract filler, redesigning the product, invented screens, unverified numbers`, "");
  l.push(`## Visual identity (preserve, do not restyle)`, `- Background ${vi.colors.background} · Surface ${vi.colors.surface} · Accent ${vi.colors.accent} · Text ${vi.colors.text}`, `- Type: ${vi.typography.display} / ${vi.typography.body}${vi.typography.mono ? ` / ${vi.typography.mono}` : ""}`, `- Radius: ${vi.borderRadius}; ${vi.glass ? "glass surfaces" : "solid surfaces"}; ${vi.colors.mode} mode`, `- Design language: ${vi.designLanguage.join(", ")}`, "");
  l.push(`## Scene sequence`);
  for (const s of scenes) l.push(`${s.scene}. **${s.purpose}** — ${s.start}s → ${round2(s.start + s.duration)}s — ${s.sourceFile ? `\`${s.sourceFile}\`` : "text"} — "${s.text}"${s.subtext ? ` / "${s.subtext}"` : ""} — motion \`${s.motion}\`, in: ${s.transition}`);
  l.push("");
  l.push(`## Motion requirements`, `- Motion is derived from screen contents (${Array.from(new Set(scenes.map((s) => s.motion))).join(", ")}); the UI must stay readable — no scale beyond 1.14, no spins.`, `- Text: fast in (≤0.9s), then hold; every line meets the reading floor.`, `- Real UI appears in ${scenes.filter((s) => s.sourceKind === "screenshot" || s.sourceKind === "full-page").length} of ${scenes.length} scenes.`, "");
  l.push(`## Music`, music ? `- Track: ${music.title} (\`${music.file.split(/[\\/]/).pop()}\`) · ${music.bpm ? `${music.bpm} BPM` : "tempo unknown"} · cues: ${music.cueSource}` : "- none (disabled)", music ? `- Treatment: fade in 0.8s, fade under CTA; volume 0.55` : "", music && locks.length ? `- Beat locks: ${locks.map((k) => `${k.sceneId} ${k.from}s→${k.to}s (${k.kind})`).join("; ")}` : "- Beat locks: none needed (natural timing kept for readability)", music ? `- License: ${music.license}` : "", "");
  l.push(`## SFX`, sfx.length ? sfx.map((s) => `- ${s.at}s \`${s.file}\` @${s.volume} — ${s.reason}`).join("\n") : "- none", "");
  l.push(`## Audio-reactive`, `- ${plan.audio.reactive}: background glow breathes with RMS/bass; nothing on text or the UI itself. No equalizer visuals.`, "");
  l.push(`## Hyperframes instructions`, `- Standalone composition, one paused GSAP timeline registered at \`window.__timelines["launch"]\`.`, `- Screenshots are \`<img>\` elements inside framed \`.shot\` wrappers; camera moves tween the inner \`.cam\`, never the \`.clip\`.`, `- Music on a \`data-automation\` volume lane; SFX as separate \`<audio id>\` elements.`, `- Gate: \`npx hyperframes check\` must pass before render.`, "");
  return l.filter((x) => x !== undefined).join("\n");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
