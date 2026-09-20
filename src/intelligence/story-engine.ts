import type { LaunchOptions, ProductDNA, StoryPlan, TonePreset } from "../types.js";
import { isSafeCopy } from "./claim-verifier.js";
import { containsBannedPhrase, firstSentence, truncate } from "../shared/text.js";

/**
 * Story engine: decides the creative angle from verified material only.
 * The output is deliberately specific — it names real screens, real
 * features and the product's own words — so the video cannot become a
 * generic SaaS promo.
 */

export const TONE_PRESETS: Record<TonePreset, { energy: string; scenes: [number, number]; transitions: Array<"cut" | "crossfade" | "slide" | "wipe" | "push">; interpretation: string }> = {
  polished: { energy: "restrained, confident", scenes: [5, 6], transitions: ["crossfade", "slide"], interpretation: "Slow reveals, generous holds, product speaks for itself." },
  cinematic: { energy: "dramatic, trailer-scale", scenes: [5, 7], transitions: ["wipe", "crossfade", "push"], interpretation: "Big type, wide pushes, a single impact at the hero reveal." },
  minimal: { energy: "quiet, precise", scenes: [4, 5], transitions: ["crossfade"], interpretation: "Few words, long holds, whitespace, no decoration." },
  playful: { energy: "light, bouncy", scenes: [6, 8], transitions: ["slide", "push", "cut"], interpretation: "Quick cuts, staggered card entrances, a friendly voice." },
  technical: { energy: "matter-of-fact, developer", scenes: [5, 7], transitions: ["cut", "slide"], interpretation: "Show the real thing working; mono type accents; no hype." },
  "app-store": { energy: "smooth, feature-card clean", scenes: [5, 7], transitions: ["slide", "wipe"], interpretation: "One feature per card, clean reveals, consistent rhythm." },
  bold: { energy: "fast, loud", scenes: [6, 8], transitions: ["cut", "push"], interpretation: "Hard cuts on beats, oversized headlines, high contrast." },
};

const TONE_ALIASES: Array<[RegExp, TonePreset]> = [
  [/(polished|premium|elegant|serious|clean|professional|corporate|refined)/i, "polished"],
  [/(cinematic|trailer|dramatic|epic|film)/i, "cinematic"],
  [/(minimal|apple|quiet|calm|subtle|understated|deadpan|zen)/i, "minimal"],
  [/(playful|fun|friendly|bouncy|cheerful|light|warm|chaotic|meme)/i, "playful"],
  [/(technical|developer|dev|engineer|hacker|terminal|nerd)/i, "technical"],
  [/(app.?store|feature.?card|product.?tour|showcase|walkthrough)/i, "app-store"],
  [/(bold|loud|aggressive|punchy|hype|fast|energetic|startup|launch day)/i, "bold"],
];

export function resolveTone(input: string | undefined, dna: ProductDNA): { preset: TonePreset; direction: string } {
  const raw = (input ?? "").trim();
  if (raw && (raw as TonePreset) in TONE_PRESETS) return { preset: raw as TonePreset, direction: raw };
  if (raw) {
    for (const [re, preset] of TONE_ALIASES) if (re.test(raw)) return { preset, direction: raw };
    return { preset: "polished", direction: raw };
  }
  // Infer from the product's own design language.
  const lang = dna.visual_identity.designLanguage;
  if (lang.includes("developer-focused")) return { preset: "technical", direction: "show the real tool working, no hype" };
  if (lang.includes("playful")) return { preset: "playful", direction: "light and quick, let the UI's color carry it" };
  if (lang.includes("premium") || lang.includes("glass")) return { preset: "cinematic", direction: "dark, glowing, slow pushes into the interface" };
  if (lang.includes("minimal")) return { preset: "minimal", direction: "quiet product film, few words" };
  if (lang.includes("dashboard") || lang.includes("enterprise")) return { preset: "polished", direction: "confident product walkthrough" };
  return { preset: "polished", direction: "clean launch film built from the real interface" };
}

export function buildStoryPlan(dna: ProductDNA, options: LaunchOptions): StoryPlan {
  const tone = resolveTone(options.tone, dna);
  const claims = [...dna.verified_claims, ...dna.unsupported_claims];
  const safe = (s: string) => isSafeCopy(s, claims) && !containsBannedPhrase(s);
  const features = dna.verified_features.slice(0, 5);
  const screens = [...dna.screens].sort((a, b) => b.score - a.score);
  const hasRuntime = dna.runtime.status === "ok" && screens.some((s) => !s.id.startsWith("source-"));

  // ---- Strongest angle: the best-scoring real screen + the highest-confidence feature it supports.
  const heroScreen = screens.find((s) => s.purposeHint === "hero") ?? screens[0];
  const heroFeature = features.find((f) => heroScreen && f.route === heroScreen.route) ?? features[0];
  const strongestAngle = hasRuntime && heroScreen
    ? `Open on the real ${describeScreen(heroScreen)} and let it carry the film — then move through ${flowSummary(dna)} before landing on ${heroFeature ? heroFeature.name.toLowerCase() : "the product"}.`
    : `The product cannot be run here, so the film is built from its own source: ${dna.screens.slice(0, 3).map((s) => s.title).join(", ")} rendered in the project's palette, framed by the README's own words.`;

  // ---- Hook: the project's own tagline when verified; otherwise a specific question about the hero feature.
  let hookText: string;
  let hookSub: string | undefined;
  let hookRationale: string;
  const taglineClaim = dna.verified_claims.find((c) => c.kind === "tagline");
  const shortTagline = taglineClaim && safe(taglineClaim.claim) ? shortenForHook(firstSentence(taglineClaim.claim)) : null;
  if (shortTagline) {
    hookText = shortTagline;
    hookRationale = "the project's own verified tagline";
  } else if (heroFeature) {
    hookText = hookFromFeature(heroFeature.name, tone.preset, dna.name);
    hookRationale = `derived from the highest-confidence feature (${heroFeature.name}, ${heroFeature.evidence[0]})`;
  } else {
    hookText = dna.name;
    hookRationale = "product name — nothing else was verifiable";
  }
  if (!safe(hookText)) {
    hookText = dna.name;
    hookRationale = "fell back to the product name after claim verification";
  }
  hookSub = tone.preset === "minimal" ? undefined : truncate(dna.category, 40);

  // ---- UI moments: distinct screens by purpose, best score first.
  const uiMoments: StoryPlan["uiMoments"] = [];
  const seenPurpose = new Set<string>();
  for (const s of screens) {
    if (uiMoments.length >= 5) break;
    if (seenPurpose.has(s.purposeHint) && uiMoments.length >= 2 && s.score < 0.5) continue;
    seenPurpose.add(s.purposeHint);
    uiMoments.push({ screenId: s.id, why: `${describeScreen(s)} — ${s.components.length ? s.components.slice(0, 3).join(", ") : "source"} (score ${s.score})` });
  }

  const cta = buildCta(dna, tone.preset);
  const shareLine = buildShareLine(dna, heroFeature?.name, tone.preset);

  return {
    productName: dna.name,
    whatIsIt: truncate(dna.description || dna.tagline, 200),
    whatMakesItInteresting: interesting(dna, features),
    strongestAngle,
    hook: { text: hookText, sub: hookSub, rationale: hookRationale },
    uiMoments,
    cta,
    tone: { preset: tone.preset, direction: tone.direction, interpretation: TONE_PRESETS[tone.preset].interpretation },
    audio: {
      role: audioRole(tone.preset),
      music: options.music,
      sfx: options.sfx,
      reactive: options.music ? (tone.preset === "minimal" ? "none" : "subtle") : "none",
      restraint: "No whoosh on every cut, no equalizer visuals; at most one impact on the hero reveal and one soft cue per scene change.",
    },
    shareLine,
    audience: dna.audience,
  };
}

/** Hooks must read in ~2s: keep ≤ 8 words, cutting at a natural clause boundary. */
export function shortenForHook(s: string): string | null {
  const clean = s.replace(/\.$/, "").trim();
  const words = clean.split(/\s+/);
  if (words.length <= 8) return clean;
  const separators = [/\s+[—–-]\s+/, /:\s+/, /\s+for\s+/, /\s+that\s+/, /\s+with\s+/, /\s+so\s+/, /,\s+/];
  for (const sep of separators) {
    const clause = clean.split(sep)[0].trim().replace(/[,;:]+$/, "");
    const n = clause.split(/\s+/).length;
    if (n >= 3 && n <= 8) return clause;
  }
  return null;
}

function describeScreen(s: ProductDNA["screens"][number]): string {
  if (s.id.startsWith("source-")) return `source card for ${s.title}`;
  const name = s.route === "/" ? "home screen" : `${s.route.split("/").filter(Boolean).pop()?.replace(/[-_]/g, " ")} screen`;
  const comps = s.components.filter((c) => ["chart", "table", "sidebar", "cards", "form", "code", "tabs"].includes(c));
  return comps.length ? `${name} with ${comps.slice(0, 2).join(" and ")}` : name;
}

function flowSummary(dna: ProductDNA): string {
  const flow = dna.user_flows[0];
  if (!flow || flow.steps.length < 2) return "its main screens";
  return flow.steps.map((s) => s.label.toLowerCase()).join(" → ");
}

function interesting(dna: ProductDNA, features: ProductDNA["verified_features"]): string {
  const parts: string[] = [];
  if (features.length) parts.push(`${features.length} evidence-backed features (${features.slice(0, 3).map((f) => f.name).join(", ")})`);
  if (dna.runtime.status === "ok") parts.push(`${dna.runtime.screenCount} screens captured from the running app`);
  const style = dna.visual_identity.style;
  if (style && style !== "neutral") parts.push(`a ${style} interface in ${dna.visual_identity.colors.mode} mode`);
  if (dna.stack.ai.length) parts.push(`${dna.stack.ai.join("/")} in the stack`);
  return parts.join("; ") || "a working project with real source to show";
}

function hookFromFeature(feature: string, tone: TonePreset, name: string): string {
  const f = feature.replace(/ API$/, "");
  switch (tone) {
    case "technical":
      return `${f}. Running, not mocked.`;
    case "cinematic":
      return `${f}, in one view.`;
    case "playful":
      return `Meet ${name}. Start with ${f.toLowerCase()}.`;
    case "bold":
      return `${f.toUpperCase()}.`;
    case "minimal":
      return f;
    case "app-store":
      return `${name} — ${f}`;
    default:
      return `${f}, the way ${name} does it.`;
  }
}

function buildCta(dna: ProductDNA, tone: TonePreset): StoryPlan["cta"] {
  const name = dna.name;
  const stack = [...dna.stack.frontend.slice(0, 2), ...dna.stack.backend.slice(0, 1)].join(" · ");
  const sub = [dna.license ? "Open source" : "", stack].filter(Boolean).join(" · ") || dna.category;
  switch (tone) {
    case "technical":
      return { text: name, sub: "Clone it. Run it." };
    case "cinematic":
      return { text: name, sub: dna.tagline && dna.tagline.length < 60 ? dna.tagline : sub };
    case "playful":
      return { text: `Try ${name}`, sub };
    case "bold":
      return { text: `${name}. Now.`, sub };
    case "minimal":
      return { text: name };
    default:
      return { text: name, sub };
  }
}

function buildShareLine(dna: ProductDNA, heroFeature: string | undefined, tone: TonePreset): string {
  const name = dna.name;
  const what = dna.tagline && dna.tagline.length < 100 ? dna.tagline.replace(/\.$/, "") : `a ${dna.category}`;
  const feat = heroFeature ? heroFeature.toLowerCase() : null;
  switch (tone) {
    case "technical":
      return `${name}: ${what}. ${feat ? `The ${feat} is real and running in the video.` : "Everything in the video is the actual app."}`;
    case "minimal":
      return `${name}. ${what}.`;
    case "bold":
      return `${name} is live. ${what}.`;
    default:
      return `Introducing ${name} — ${what}.${feat ? ` Watch the ${feat} in action.` : ""}`;
  }
}

function audioRole(tone: TonePreset): string {
  switch (tone) {
    case "cinematic":
      return "cinematic bed with one low swell at the hero reveal";
    case "minimal":
      return "sparse, warm bed kept low; almost no SFX";
    case "playful":
      return "upbeat bed; light UI ticks on card entrances";
    case "bold":
      return "driving bed; transitions cut on beats";
    case "technical":
      return "steady, unobtrusive bed; click/keypress accents on interactions";
    case "app-store":
      return "clean corporate bed; soft drop on each feature card";
    default:
      return "warm professional bed; 2–3 subtle accents";
  }
}
