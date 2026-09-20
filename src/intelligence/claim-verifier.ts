import type { Claim, RepositoryAnalysis, RuntimeAnalysis } from "../types.js";
import type { ScanResult } from "../repository/scanner.js";
import { keywordsFor, searchEvidence } from "../repository/feature-analyzer.js";
import { slugify } from "../shared/text.js";

/**
 * Claim verification. Every sentence that could end up on screen must trace
 * back to repository evidence. Metrics (users, revenue, accuracy, speed,
 * customers, funding, downloads) are never verifiable from source code, so
 * they are always marked unsupported unless the repository ships a benchmark
 * or test that literally asserts them — and even then we keep them out of the
 * video by default.
 */

const METRIC_RE = /(\d[\d,.]*\s?(%|x\b|k\+?|m\+?|ms\b|users|customers|downloads|stars|companies|teams|developers|requests|accuracy|faster|uptime|revenue|arr|mrr|funding|raised|installs)|\b(millions?|thousands?|billions?)\b|\$\s?\d)/i;
const FABRICATION_RE = /\b(users?|customers?|revenue|accuracy|performance|funding|downloads?|installs?|clients?|companies|teams|enterprises)\b/i;

export function verifyClaims(analysis: RepositoryAnalysis, runtime: RuntimeAnalysis, scan: ScanResult): Claim[] {
  const claims: Claim[] = [];
  const push = (c: Omit<Claim, "id">) => {
    const id = slugify(c.claim).slice(0, 48);
    if (claims.some((x) => x.id === id)) return;
    claims.push({ id, ...c });
  };

  // Tagline
  if (analysis.readme.tagline) {
    const terms = keywordsFor(analysis.readme.tagline);
    const evidence = searchEvidence(scan, terms, 4);
    const metric = METRIC_RE.test(analysis.readme.tagline);
    push({
      claim: analysis.readme.tagline,
      verified: !metric && (evidence.length > 0 || terms.length <= 2),
      evidence,
      reason: metric ? "contains a metric that source code cannot verify" : evidence.length ? `keywords found in ${evidence.length} source file(s)` : "descriptive tagline; used as the project's own words",
      kind: "tagline",
      origin: "readme",
    });
  }

  // Features (already evidence-backed)
  for (const f of analysis.features) {
    push({
      claim: f.name,
      verified: f.evidence.length > 0 && f.confidence >= 0.4,
      evidence: f.evidence,
      reason: f.evidence.length ? `${f.sources.join("+")} evidence (confidence ${f.confidence})` : "no evidence",
      kind: "feature",
      origin: "feature",
    });
  }

  // README bullets that did not become features
  for (const bullet of analysis.readme.featureBullets) {
    const already = analysis.features.some((f) => f.description === bullet);
    if (already) continue;
    const metric = METRIC_RE.test(bullet);
    const terms = keywordsFor(bullet);
    const evidence = metric ? [] : searchEvidence(scan, terms, 3);
    push({
      claim: bullet,
      verified: !metric && evidence.length > 0,
      evidence,
      reason: metric ? "metric claim — not verifiable from code" : evidence.length ? `keywords found in ${evidence.join(", ")}` : "no matching source files",
      kind: metric ? "metric" : "capability",
      origin: "readme",
    });
  }

  // Explicit metric claims from README
  for (const m of analysis.readme.metricClaims) {
    push({ claim: m, verified: false, evidence: [], reason: "numbers about users, performance, accuracy, or scale are never used unless asserted by shipped tests/benchmarks", kind: "metric", origin: "readme" });
  }

  // Stack claims (from manifests — verifiable)
  const stack = [...analysis.frameworks.frontend, ...analysis.frameworks.backend, ...analysis.frameworks.database, ...analysis.frameworks.ai];
  for (const s of stack.slice(0, 12)) {
    const ev = analysis.importantFiles.filter((f) => /(package\.json|requirements|pyproject|pom\.xml|build\.gradle|go\.mod|Cargo\.toml|Gemfile)/.test(f)).slice(0, 2);
    push({ claim: `Built with ${s}`, verified: ev.length > 0, evidence: ev, reason: "declared in dependency manifest", kind: "stack", origin: "package" });
  }

  // Runtime-observed claims (strongest evidence: we saw it on screen)
  for (const s of runtime.screens.slice(0, 8)) {
    const heading = s.dom.headings[0];
    if (heading && heading.length > 3 && heading.length < 80 && !METRIC_RE.test(heading)) {
      push({ claim: heading, verified: true, evidence: [s.file], reason: `rendered on ${s.route}`, kind: "capability", origin: "runtime" });
    }
    for (const c of s.components) {
      const label = componentClaim(c);
      if (label) push({ claim: label, verified: true, evidence: [s.file], reason: `observed on ${s.route}`, kind: "capability", origin: "runtime" });
    }
  }
  return claims;
}

function componentClaim(c: string): string | null {
  switch (c) {
    case "chart":
      return "Data visualized in charts";
    case "table":
      return "Tabular data views";
    case "sidebar":
      return "Sidebar navigation";
    case "form":
      return "Interactive forms";
    case "dialog":
      return "Modal dialogs";
    case "tabs":
      return "Tabbed views";
    case "code":
      return "Code shown in the interface";
    case "glass":
      return "Glass-style surfaces";
    default:
      return null;
  }
}

/** Guard used by the storyboard and copy generators: text must be verified and free of fabricated metrics. */
export function isSafeCopy(text: string, claims: Claim[]): boolean {
  if (METRIC_RE.test(text) && FABRICATION_RE.test(text)) return false;
  if (/\b\d{2,}(,\d{3})*\+?\s*(users|customers|companies|teams|downloads)/i.test(text)) return false;
  if (/\b\d+(\.\d+)?%/.test(text)) return false;
  const lower = text.toLowerCase();
  const unsupported = claims.filter((c) => !c.verified);
  return !unsupported.some((c) => c.claim.length > 12 && lower.includes(c.claim.toLowerCase()));
}
