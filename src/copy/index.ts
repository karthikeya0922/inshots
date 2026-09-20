import type { ProductDNA, StoryPlan } from "../types.js";
import { isSafeCopy } from "../intelligence/claim-verifier.js";
import { containsBannedPhrase, truncate } from "../shared/text.js";

/**
 * Share copy. Only verified material: the product's own tagline (when it
 * passed verification), evidence-backed feature names, and the declared
 * stack. No invented traction, no generic AI-startup language.
 */

export interface ShareCopy {
  linkedin: string;
  x: string;
  productHunt: string;
  shortCaption: string;
}

export function generateShareCopy(dna: ProductDNA, plan: StoryPlan, repoUrl: string): ShareCopy {
  const claims = [...dna.verified_claims, ...dna.unsupported_claims];
  const ok = (s: string) => isSafeCopy(s, claims) && !containsBannedPhrase(s);
  const name = dna.name;
  const tagline = dna.tagline && ok(dna.tagline) ? dna.tagline.replace(/\.$/, "") : `a ${dna.category}`;
  const features = dna.verified_features.filter((f) => ok(f.name) && f.name !== "HTTP API").slice(0, 4).map((f) => f.name);
  const stack = [...dna.stack.frontend.slice(0, 2), ...dna.stack.backend.slice(0, 1), ...dna.stack.database.slice(0, 1), ...dna.stack.ai.slice(0, 1)].filter(Boolean);
  const link = /^https?:\/\//.test(repoUrl) ? repoUrl : "";
  const realUi = dna.runtime.status === "ok";
  const flow = dna.user_flows[0];
  const hashtags = hashtagsFor(dna);

  const linkedin = [
    `${name} — ${tagline}.`,
    "",
    realUi ? `Everything in this clip is the actual interface, captured from the running app — ${flow ? `the ${flow.name.toLowerCase()} (${flow.steps.map((s) => s.label.toLowerCase()).join(" → ")})` : `${dna.runtime.screenCount} real screens`}.` : `The clip is built from the project's own source and README — nothing mocked up.`,
    "",
    features.length ? `What's in it:\n${features.map((f) => `• ${f}`).join("\n")}` : "",
    "",
    stack.length ? `Built with ${listJoin(stack)}.` : "",
    link ? `Code: ${link}` : "",
    hashtags.slice(0, 4).map((h) => `#${h}`).join(" "),
  ]
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n")
    .trim();

  const xLine = truncate(`${name}: ${tagline}.${features[0] ? ` ${features[0]} — ${realUi ? "shown running, not mocked" : "straight from the repo"}.` : ""}`, 200);
  const x = [xLine, link, hashtags.slice(0, 2).map((h) => `#${h}`).join(" ")].filter(Boolean).join("\n");

  const productHunt = [
    `**${name}** — ${tagline}.`,
    "",
    dna.description && ok(dna.description) ? truncate(dna.description, 240) : "",
    "",
    features.length ? `**What it does**\n${features.map((f) => `- ${f}`).join("\n")}` : "",
    "",
    `**Who it's for**\n${dna.audience}.`,
    "",
    stack.length ? `**Under the hood**\n${listJoin(stack)}.` : "",
    link ? `\nOpen source: ${link}` : "",
  ]
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n")
    .trim();

  const shortCaption = truncate(`${name} — ${tagline}.${features[0] ? ` ${features[0]}.` : ""}${realUi ? " Real UI, real app." : ""}`, 140) + (hashtags.length ? ` #${hashtags[0]}` : "");

  return { linkedin, x, productHunt, shortCaption };
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

function hashtagsFor(dna: ProductDNA): string[] {
  const tags: string[] = [];
  const cat = dna.category.toLowerCase();
  if (/security|compliance/.test(cat)) tags.push("security");
  if (/analytics|dashboard/.test(cat)) tags.push("analytics");
  if (/ai/.test(cat) || dna.stack.ai.length) tags.push("AI");
  if (dna.stack.frontend.some((f) => /React|Next/.test(f))) tags.push("react");
  if (dna.stack.backend.some((f) => /FastAPI|Flask|Django/.test(f)) || dna.stack.ai.length) tags.push("python");
  tags.push("opensource", "buildinpublic");
  return Array.from(new Set(tags));
}
