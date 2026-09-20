/** Text helpers shared across analysis and copy generation. */

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";
}

export function humanize(input: string): string {
  const cleaned = input
    .replace(/\.[a-z]+$/i, "")
    .replace(/[\[\]()]/g, "")
    .replace(/[-_./]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!cleaned) return "";
  return cleaned
    .split(/\s+/)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

const ACRONYMS = new Set(["ai", "api", "ui", "ux", "id", "url", "sql", "ml", "llm", "pdf", "csv", "json", "seo", "crm", "erp", "kpi", "sso", "iot", "qr", "ocr", "faq", "rss", "cli", "sdk", "ci", "cd"]);

export function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\-–]+$/, "") + "…";
}

/**
 * A short, complete phrase for on-screen subtext: cut at the first clause boundary once we have ≥3 words,
 * never mid-word, never with an ellipsis. Returns null when nothing clean fits.
 */
export function shortPhrase(s: string, maxChars = 52): string | null {
  const clean = s.replace(/\s+/g, " ").replace(/[.]+$/, "").trim();
  if (!clean) return null;
  if (clean.length <= maxChars) return clean;
  const parts = clean.split(/\s*(?:,|;|:|\s—\s|\s–\s|\s-\s|\band\b|\bwith\b|\bso\b|\bthen\b|\(|\bthat\b|\bwhich\b)\s*/);
  const first = parts[0]?.trim() ?? "";
  if (first.split(" ").length >= 3 && first.length <= maxChars) return first;
  const words = clean.split(" ");
  let out = "";
  for (const w of words) {
    if ((out + " " + w).trim().length > maxChars) break;
    out = (out + " " + w).trim();
  }
  return out.split(" ").length >= 3 && !/\b(a|an|the|and|or|of|to|for|with|in|on|by)$/i.test(out) ? out : null;
}

export function firstSentence(s: string): string {
  const m = s.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : s).trim();
}

export function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Seconds of settled time a viewer needs to read `text` (brag's readability rule). */
export function readingTime(text: string): number {
  const words = countWords(text);
  if (words <= 3) return 0.8;
  return Math.max(1.2, words * 0.3);
}

export function stripMarkdown(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*_~#>]+/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export function topN<T>(counts: Record<string, number>, n: number): Array<[string, number]> {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Does this text assert a number about scale, speed, accuracy, traction or money?
 * Such claims can never be verified from source code, so they never reach the video.
 */
export function looksLikeMetric(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\d[\d,.]*\s?(%|percent\b|x\b|×|k\b|m\b|b\b|ms\b|mb\b|gb\b|tb\b)/.test(t) ||
    /\b\d{1,3}(,\d{3})+\b/.test(t) ||
    /\b\d+\+?\s+[a-z-]+\s+(per|a|an|every)\s+(second|minute|hour|day|week|month|year)\b/.test(t) ||
    /\b\d{2,}\+?\s+(users|customers|teams|companies|developers|downloads|stars|installs|clients|countries|invoices|requests|documents|files|events|transactions|messages|projects|repos|orgs|organizations|people|engineers|founders|startups|enterprises|brands|merchants|stores|sites|apps)\b/.test(t) ||
    /\b(millions?|thousands?|billions?|hundreds)\s+of\b/.test(t) ||
    /\b(trusted|used|loved)\s+by\b/.test(t) ||
    /\b\d+(\.\d+)?\s?(×|x)\s?(faster|cheaper|quicker|more|less|better)\b/.test(t) ||
    /\b\d+(\.\d+)?\s?(nines|uptime|sla|accuracy|precision|recall|latency)\b/.test(t) ||
    /\$\s?\d/.test(t) ||
    /\b(series [a-d]|raised \$|funding|valuation|arr|mrr|revenue)\b/.test(t)
  );
}

/** Generic SaaS phrases that must never appear in generated copy. */
export const BANNED_PHRASES = [
  "streamline your workflow",
  "revolutionize",
  "revolutionizing",
  "game-changer",
  "game changer",
  "next-generation",
  "cutting-edge",
  "seamlessly",
  "unlock the power",
  "supercharge",
  "empower your",
  "take your .* to the next level",
  "the future of",
  "all-in-one solution",
  "best-in-class",
  "world-class",
  "10x",
];

export function containsBannedPhrase(s: string): string | null {
  const lower = s.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (new RegExp(phrase, "i").test(lower)) return phrase;
  }
  return null;
}
