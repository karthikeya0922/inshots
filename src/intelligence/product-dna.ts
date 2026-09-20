import type { Claim, ProductDNA, RepositoryAnalysis, RuntimeAnalysis, UIAnalysis } from "../types.js";
import { firstSentence, truncate } from "../shared/text.js";

/** Build product-dna.json — the single source of truth for the creative pipeline. */
export function buildProductDNA(analysis: RepositoryAnalysis, runtime: RuntimeAnalysis, ui: UIAnalysis, claims: Claim[], audienceHint?: string): ProductDNA {
  const verified = claims.filter((c) => c.verified);
  const unsupported = claims.filter((c) => !c.verified);
  const category = inferCategory(analysis, runtime, ui);
  const audience = audienceHint ?? inferAudience(analysis, ui, category);
  const tagline = analysis.readme.tagline && verified.some((c) => c.kind === "tagline") ? truncate(firstSentence(analysis.readme.tagline), 110) : defaultTagline(analysis, category);

  const screens: ProductDNA["screens"] = runtime.screens.map((s) => ({
    id: s.id,
    route: s.route,
    title: s.title,
    file: s.file,
    fullPageFile: s.fullPageFile,
    components: s.components,
    score: s.score,
    purposeHint: purposeHint(s.route, s.components),
    headline: s.dom.headings.find((h) => h.length >= 3 && h.length <= 80),
    headlines: s.dom.headings.filter((h) => h.length >= 3 && h.length <= 80).slice(0, 3),
  }));
  for (const sd of runtime.sourceDerived) screens.push({ id: sd.id, route: sd.sourceFile, title: sd.title, file: sd.file, components: ["code"], score: 0.3, purposeHint: sd.id === "source-readme" ? "hook" : "feature" });

  return {
    name: analysis.name,
    category,
    description: truncate(analysis.description || tagline, 260),
    tagline,
    value_proposition: valueProposition(analysis, runtime, category),
    audience,
    stack: { frontend: analysis.frameworks.frontend, backend: analysis.frameworks.backend, database: analysis.frameworks.database, ai: analysis.frameworks.ai },
    verified_features: analysis.features.filter((f) => f.confidence >= 0.4),
    screens,
    user_flows: runtime.flows,
    visual_identity: {
      colors: ui.visualSystem.colors,
      typography: ui.visualSystem.typography,
      style: ui.designLanguage.filter((l) => l !== "dark" && l !== "light").slice(0, 3).join(", ") || "neutral",
      designLanguage: ui.designLanguage,
      borderRadius: ui.visualSystem.borderRadius,
      glass: ui.visualSystem.glass,
    },
    brand_assets: analysis.brandAssets,
    license: analysis.license,
    verified_claims: verified,
    unsupported_claims: unsupported,
    runtime: { status: runtime.status, reason: runtime.reason, screenCount: runtime.screens.length },
    generatedAt: new Date().toISOString(),
  };
}

function inferCategory(a: RepositoryAnalysis, r: RuntimeAnalysis, ui: UIAnalysis): string {
  const text = `${a.name} ${a.description} ${a.readme.headings.join(" ")} ${a.features.map((f) => f.name).join(" ")}`.toLowerCase();
  const has = (re: RegExp) => re.test(text);
  if (has(/(risk|fraud|compliance|audit|security|threat|vulnerab|gateway|zero.?trust|pii|guardrail)/)) return "security & compliance tool";
  if (has(/(chat|assistant|copilot|agent|llm|gpt|rag)/) && a.frameworks.ai.length) return "AI assistant";
  if (has(/(anomal|analytics|dashboard|metrics|insight|monitor|observab|telemetry)/)) return "analytics dashboard";
  if (has(/\b(todo|to-do|task manager|tasks app|project management|kanban|planner|habit|note-taking|notes app|journal|outliner?|writing app)\b/)) return "productivity app";
  if (a.frameworks.ai.length && has(/(detect|classif|predict|model|vision|nlp)/)) return "AI-powered tool";
  if (has(/(e-?commerce|shop|store|cart|checkout|product catalog)/)) return "e-commerce app";
  if (has(/(cms|blog|content|publish|markdown|docs site|documentation)/)) return "content platform";
  if (has(/(finance|budget|expense|invoice|payment|banking|portfolio|trading)/)) return "finance app";
  if (has(/(learn|course|quiz|education|student|tutor)/)) return "learning app";
  if (has(/(game|puzzle|play|arcade)/)) return "game";
  if (has(/(api|sdk|library|framework|cli|package)/) && !a.frameworks.frontend.length) return "developer tool";
  if (has(/(portfolio|landing|website|personal site)/) && a.primaryApp?.kind === "static") return "website";
  if (ui.layout === "dashboard") return "analytics dashboard";
  if (r.screens.some((s) => s.dom.hasSidebar)) return "web application";
  if (a.frameworks.frontend.length) return "web app";
  return a.frameworks.backend.length ? "backend service" : "software project";
}

function inferAudience(a: RepositoryAnalysis, ui: UIAnalysis, category: string): string {
  if (ui.designLanguage.includes("developer-focused") || /developer|api|sdk|cli/.test(category)) return "developers";
  if (/security|compliance|analytics|enterprise/.test(category) || ui.designLanguage.includes("enterprise")) return "teams and operators";
  if (/e-commerce|game|learning|productivity|finance/.test(category)) return "everyday users";
  return "builders and early adopters";
}

function defaultTagline(a: RepositoryAnalysis, category: string): string {
  const top = a.features.slice(0, 2).map((f) => f.name);
  if (top.length === 2) return `${top[0]} and ${top[1]} in one ${category}.`;
  if (top.length === 1) return `${a.name}: ${top[0]}.`;
  return `${a.name} — a ${category}.`;
}

function valueProposition(a: RepositoryAnalysis, r: RuntimeAnalysis, category: string): string {
  const feats = a.features.filter((f) => f.confidence >= 0.5).slice(0, 3).map((f) => f.name.toLowerCase());
  const seen = r.screens.length ? `${r.screens.length} real screens captured from the running app` : "built from the repository's own source";
  if (feats.length) return `A ${category} that ships ${feats.join(", ")} — ${seen}.`;
  return `A ${category} — ${seen}.`;
}

export function purposeHint(route: string, components: string[]): string {
  const r = route.toLowerCase();
  if (r === "/") return components.includes("chart") || components.includes("sidebar") ? "reveal" : "hook";
  if (/(dashboard|overview|analytics|insight|report|monitor|graph|result)/.test(r) || components.includes("chart")) return "hero";
  if (/(new|create|upload|import|scan|run|compose|editor|studio|chat)/.test(r) || components.includes("form")) return "workflow";
  if (/(settings|config|admin|profile)/.test(r)) return "feature";
  return "feature";
}
