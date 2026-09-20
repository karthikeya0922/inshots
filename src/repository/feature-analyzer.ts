import path from "node:path";
import type { Feature, StaticRoute } from "../types.js";
import type { ScanResult } from "./scanner.js";
import type { FrameworkDetection } from "./framework-detector.js";
import { humanize, looksLikeMetric, slugify, uniq } from "../shared/text.js";

/**
 * Feature extraction with evidence.
 *
 * A feature is only emitted when there is a concrete file backing it. Sources
 * are combined so that a README bullet that matches a route and a component
 * gets a much higher confidence than a bullet alone.
 */

const GENERIC_ROUTE = new Set(["", "index", "home", "app", "main", "start", "welcome", "404", "500", "not-found", "error", "layout", "loading", "template", "default", "_app", "_document", "api", "callback", "auth", "login", "signin", "sign-in", "signup", "sign-up", "register", "logout", "reset-password", "forgot-password", "verify", "terms", "privacy", "legal", "about", "contact", "test", "debug", "health", "docs", "sitemap", "robots"]);

const AUTH_ROUTES = new Set(["login", "signin", "sign-in", "signup", "sign-up", "register", "auth", "forgot-password", "reset-password", "verify"]);

const DEP_FEATURES: Array<{ deps: RegExp; name: string; description: string; keywords: string[] }> = [
  { deps: /^(recharts|chart\.js|react-chartjs-2|@nivo\/|echarts|victory|d3|plotly|apexcharts|@visx|lightweight-charts|@tremor\/react)/, name: "Charts & Visualizations", description: "Interactive charts render data visually.", keywords: ["chart", "graph", "visual", "analytics", "metric"] },
  { deps: /^(socket\.io|ws|pusher|ably|@supabase\/realtime|partysocket|liveblocks|yjs)/, name: "Real-time Updates", description: "Live updates are pushed to the UI over websockets.", keywords: ["realtime", "real-time", "live", "socket", "websocket", "stream"] },
  { deps: /^(openai|@anthropic-ai\/sdk|ai|@ai-sdk|langchain|@langchain|@google\/generative-ai|ollama|replicate|cohere-ai|@huggingface)/, name: "AI Assistance", description: "Language-model powered features are built in.", keywords: ["ai", "assistant", "chat", "llm", "gpt", "generate", "summar", "prompt", "agent", "copilot"] },
  { deps: /^(stripe|@stripe|paddle|lemonsqueezy|razorpay|paypal)/, name: "Payments & Billing", description: "Payments are handled through a billing provider.", keywords: ["payment", "billing", "checkout", "subscription", "pricing", "plan"] },
  { deps: /^(next-auth|@auth\/|@clerk|passport|@supabase\/auth|firebase|lucia|better-auth|@kinde|@auth0|jsonwebtoken|bcrypt)/, name: "Authentication", description: "Accounts and sign-in are supported.", keywords: ["auth", "login", "sign in", "signup", "account", "session", "user"] },
  { deps: /^(@tanstack\/react-table|ag-grid|react-data-grid|@mui\/x-data-grid|material-react-table|handsontable)/, name: "Data Tables", description: "Tabular data with sorting and filtering.", keywords: ["table", "grid", "rows", "list", "records"] },
  { deps: /^(reactflow|@xyflow|cytoscape|vis-network|react-force-graph|sigma|d3-force|elkjs|dagre)/, name: "Graph / Node View", description: "Node-and-edge graph visualizations.", keywords: ["graph", "node", "edge", "flow", "network", "diagram", "canvas"] },
  { deps: /^(mapbox-gl|leaflet|react-leaflet|@react-google-maps|maplibre-gl|deck\.gl|cesium)/, name: "Maps", description: "Geographic data is shown on interactive maps.", keywords: ["map", "location", "geo", "route", "marker"] },
  { deps: /^(monaco-editor|@monaco-editor|codemirror|@codemirror|@uiw\/react-codemirror|prismjs|shiki|highlight\.js)/, name: "Code Editor", description: "Code editing or highlighting is built into the UI.", keywords: ["code", "editor", "snippet", "syntax", "sql"] },
  { deps: /^(@tiptap|lexical|slate|quill|react-quill|prosemirror|@blocknote|editorjs|draft-js)/, name: "Rich Text Editor", description: "Rich text editing for documents and notes.", keywords: ["editor", "document", "note", "write", "content"] },
  { deps: /^(react-dropzone|uppy|@uppy|filepond|multer|formidable|busboy|react-filepond|uploadthing)/, name: "File Upload", description: "Users upload files into the product.", keywords: ["upload", "file", "drop", "import", "attach"] },
  { deps: /^(pdf-lib|pdfjs-dist|react-pdf|jspdf|puppeteer|@react-pdf)/, name: "PDF Export / Viewing", description: "PDF documents can be generated or viewed.", keywords: ["pdf", "export", "report", "print", "download"] },
  { deps: /^(nodemailer|resend|@sendgrid|postmark|mailgun|@react-email)/, name: "Email Notifications", description: "Transactional emails are sent from the app.", keywords: ["email", "notification", "invite", "digest"] },
  { deps: /^(three|@react-three|babylonjs|@babylonjs|pixi\.js)/, name: "3D Graphics", description: "3D rendering in the browser.", keywords: ["3d", "scene", "model", "render", "webgl"] },
  { deps: /^(i18next|react-i18next|next-intl|vue-i18n|@lingui|react-intl)/, name: "Internationalization", description: "The interface is translated into multiple languages.", keywords: ["language", "locale", "translate", "i18n"] },
  { deps: /^(next-pwa|workbox|vite-plugin-pwa|@vite-pwa)/, name: "Offline / PWA", description: "Installable progressive web app with offline support.", keywords: ["offline", "pwa", "install", "cache"] },
  { deps: /^(framer-motion|motion|gsap|@react-spring|lottie|@lottiefiles|animejs)/, name: "Animated Interface", description: "Motion and animation are part of the UI.", keywords: ["animation", "motion", "transition"] },
  { deps: /^(zustand|jotai|redux|@reduxjs|pinia|vuex|mobx|xstate|@xstate)/, name: "Stateful Workflows", description: "Client-side state machines and stores drive multi-step flows.", keywords: ["workflow", "state", "step", "wizard", "flow"] },
  { deps: /^(cmdk|kbar|@tanstack\/react-virtual|fuse\.js|minisearch|flexsearch|lunr|algoliasearch|meilisearch|typesense)/, name: "Search", description: "Fast search across the product's content.", keywords: ["search", "find", "filter", "command", "palette"] },
  { deps: /^(react-big-calendar|@fullcalendar|react-calendar|date-fns|dayjs|luxon)/, name: "Scheduling & Dates", description: "Calendar and date-driven views.", keywords: ["calendar", "schedule", "date", "event", "booking", "appointment"] },
  { deps: /^(react-markdown|remark|rehype|marked|markdown-it|mdx|@mdx-js)/, name: "Markdown Content", description: "Markdown-authored content is rendered in the app.", keywords: ["markdown", "docs", "content", "article", "post", "blog"] },
  { deps: /^(zod|yup|valibot|react-hook-form|formik|@hookform)/, name: "Validated Forms", description: "Forms with schema validation.", keywords: ["form", "input", "validate", "submit", "create"] },
  { deps: /^(fastapi|flask|django|express|fastify|hono|@nestjs\/core|gin|axum)$/, name: "HTTP API", description: "A server-side API backs the product.", keywords: ["api", "endpoint", "server", "backend"] },
  { deps: /^(presidio|spacy|transformers|torch|tensorflow|scikit-learn|sentence-transformers|xgboost|lightgbm|opencv-python|ultralytics)$/, name: "Machine Learning Models", description: "ML models run as part of the product.", keywords: ["model", "detect", "classif", "predict", "analy", "recogni", "nlp", "vision"] },
];

const PY_DEP_ALIASES = /^(fastapi|flask|django|presidio|spacy|transformers|torch|tensorflow|scikit-learn|sentence-transformers|xgboost|lightgbm|opencv-python|ultralytics|openai|anthropic|langchain|streamlit|gradio)/;

export function analyzeFeatures(scan: ScanResult, det: FrameworkDetection): Feature[] {
  const features = new Map<string, Feature>();
  const add = (f: Feature) => {
    const key = slugify(f.name);
    const existing = features.get(key);
    if (existing) {
      existing.evidence = uniq([...existing.evidence, ...f.evidence]).slice(0, 8);
      existing.sources = uniq([...existing.sources, ...f.sources]);
      existing.keywords = uniq([...existing.keywords, ...f.keywords]);
      existing.confidence = Math.min(0.99, existing.confidence + f.confidence * 0.5);
      if (!existing.route && f.route) existing.route = f.route;
      if (f.description.length > existing.description.length && f.sources.includes("readme")) existing.description = f.description;
    } else features.set(key, { ...f, id: key });
  };

  const componentIndex = buildComponentIndex(scan, det);

  // 1. Routes → features (pages the user can actually visit)
  for (const r of det.routes.filter((r) => r.kind === "page" && !r.dynamic)) {
    const seg = lastSegment(r.path);
    if (GENERIC_ROUTE.has(seg)) continue;
    const name = humanize(seg);
    if (!name || name.length < 3) continue;
    const comps = componentIndex.filter((c) => c.keywords.some((k) => seg.includes(k) || k.includes(seg))).map((c) => c.file);
    add({
      id: "",
      name,
      description: `${name} screen at ${r.path}.`,
      evidence: uniq([r.file, ...comps.slice(0, 3)]),
      confidence: 0.5 + Math.min(0.25, comps.length * 0.08),
      sources: comps.length ? ["route", "component"] : ["route"],
      keywords: [seg, ...seg.split("-")],
      route: r.path,
    });
  }

  // 2. Component directories → features (larger clusters of UI)
  const clusters = clusterComponents(componentIndex);
  for (const [name, files] of clusters) {
    if (files.length < 2) continue;
    const kw = name.toLowerCase().split(/\s+/);
    add({
      id: "",
      name,
      description: `${name} UI components (${files.length} files).`,
      evidence: files.slice(0, 6),
      confidence: 0.45 + Math.min(0.3, files.length * 0.05),
      sources: ["component"],
      keywords: kw,
    });
  }

  // 3. Dependencies → capability features (only if code actually imports them)
  const depNames = det.dependencies;
  for (const spec of DEP_FEATURES) {
    const matched = depNames.filter((d) => spec.deps.test(d) || PY_DEP_ALIASES.test(d) && spec.deps.test(d));
    if (!matched.length) continue;
    const importers = findImporters(scan, matched).slice(0, 5);
    if (!importers.length) continue;
    add({
      id: "",
      name: spec.name,
      description: spec.description,
      evidence: importers,
      confidence: 0.5 + Math.min(0.3, importers.length * 0.06),
      sources: ["dependency"],
      keywords: spec.keywords,
    });
  }

  // 4. README bullets → features, verified against code
  for (const bullet of scan.readme.featureBullets) {
    if (looksLikeMetric(bullet)) continue; // metrics are claims, never features (see claim-verifier)
    const name = bulletName(bullet);
    if (!name || looksLikeMetric(name)) continue;
    const terms = keywordsFor(bullet);
    const evidence = searchEvidence(scan, terms, 4);
    // Associate by the bullet's *name* (the part before the dash), never by words in its body — otherwise
    // "Invoice extraction — ... pulls out the vendor" would attach itself to a "Vendors" screen.
    const nameTerms = keywordsFor(name);
    const related = [...features.values()].find((f) => {
      const fTerms = keywordsFor(f.name);
      return fTerms.some((k) => k.length > 3 && nameTerms.includes(k)) || (f.route && nameTerms.some((t) => t.length > 3 && f.route!.toLowerCase().includes(t)));
    });
    if (related) {
      if (name.length <= 32 && name.length >= related.name.length - 2 && !/ API$/.test(related.name)) related.name = name;
      related.description = bullet.length <= 180 ? bullet : related.description;
      related.sources = uniq([...related.sources, "readme"]);
      related.evidence = uniq([...related.evidence, ...evidence]).slice(0, 8);
      related.confidence = Math.min(0.99, related.confidence + 0.15);
      continue;
    }
    if (evidence.length === 0) continue; // claim without code evidence → handled by claim verifier
    add({
      id: "",
      name,
      description: bullet,
      evidence,
      confidence: 0.45 + Math.min(0.3, evidence.length * 0.08),
      sources: ["readme"],
      keywords: terms,
    });
  }

  // 5. Backend endpoints → features (grouped by first path segment)
  const apiGroups = new Map<string, StaticRoute[]>();
  for (const r of det.routes.filter((r) => r.kind === "api")) {
    const seg = r.path.split("/").filter((s) => s && s !== "api" && !/^[:*{]/.test(s))[0];
    if (!seg || GENERIC_ROUTE.has(seg)) continue;
    apiGroups.set(seg, [...(apiGroups.get(seg) ?? []), r]);
  }
  for (const [seg, rs] of apiGroups) {
    const name = humanize(seg) + " API";
    add({
      id: "",
      name,
      description: `${rs.length} ${seg} endpoint${rs.length > 1 ? "s" : ""} (${rs.map((r) => r.path).slice(0, 3).join(", ")}).`,
      evidence: uniq(rs.map((r) => r.file)).slice(0, 4),
      confidence: 0.4 + Math.min(0.3, rs.length * 0.05),
      sources: ["backend"],
      keywords: [seg],
    });
  }

  // Filter noise and rank
  const out = [...features.values()]
    .filter((f) => f.evidence.length > 0)
    .filter((f) => !/^(Components?|Utils?|Lib|Hooks?|Types?|Shared|Common|Layout|Ui|Styles?|Assets?|Config|Icons?|Helpers?|Constants?|Store|Api)$/i.test(f.name))
    .map((f) => ({ ...f, confidence: Math.round(Math.min(0.99, f.confidence) * 100) / 100 }))
    .sort((a, b) => b.confidence - a.confidence || b.evidence.length - a.evidence.length);
  return out.slice(0, 24);
}

interface ComponentEntry {
  file: string;
  name: string;
  keywords: string[];
  dir: string;
}

function buildComponentIndex(scan: ScanResult, det: FrameworkDetection): ComponentEntry[] {
  const base = det.primaryApp?.dir ?? "";
  return scan.files
    .filter((f) => /\.(tsx|jsx|vue|svelte|astro)$/.test(f.rel) && (base ? f.rel.startsWith(base + "/") : true))
    .filter((f) => /(^|\/)(components?|features?|modules?|views?|screens?|widgets?|sections?|containers?|pages?|app|routes|src)\//.test(f.rel))
    .filter((f) => !/\.(test|spec|stories)\./.test(f.rel) && !/(^|\/)(ui|primitives|icons?)\//.test(f.rel))
    .map((f) => {
      const name = path.basename(f.rel).replace(/\.[^.]+$/, "");
      const words = humanize(name).toLowerCase().split(/\s+/);
      return { file: f.rel, name, keywords: words, dir: path.posix.dirname(f.rel) };
    });
}

function clusterComponents(index: ComponentEntry[]): Map<string, string[]> {
  const clusters = new Map<string, string[]>();
  for (const c of index) {
    // Cluster by the directory directly under components/features/modules.
    const m = c.dir.match(/(?:components?|features?|modules?|views?|screens?|widgets?|sections?)\/([^/]+)/);
    let key: string | null = null;
    if (m && !/^(ui|shared|common|layout|primitives|icons?)$/i.test(m[1])) key = humanize(m[1]);
    if (!key) {
      // Cluster by a shared prefix: RiskChart, RiskPanel → Risk
      const prefix = c.name.match(/^([A-Z][a-z]+)[A-Z]/)?.[1];
      if (prefix && prefix.length > 3 && !/^(Base|App|Main|Page|Use|Get|Set|New|Root)$/.test(prefix)) key = prefix;
    }
    if (!key) continue;
    clusters.set(key, [...(clusters.get(key) ?? []), c.file]);
  }
  return clusters;
}

function findImporters(scan: ScanResult, deps: string[]): string[] {
  const out: string[] = [];
  const res = deps.map((d) => new RegExp(`(from\\s+["']${escapeRe(d)}(/|["'])|require\\(["']${escapeRe(d)}(/|["'])|^\\s*(import|from)\\s+${escapeRe(d.replace(/-/g, "_"))}\\b)`, "m"));
  for (const f of scan.files) {
    if (!f.content || !/\.(tsx?|jsx?|mjs|vue|svelte|astro|py)$/.test(f.rel)) continue;
    if (/\.(test|spec)\./.test(f.rel) || /(^|\/)(tests?|__tests__)\//.test(f.rel)) continue;
    if (res.some((re) => re.test(f.content!))) out.push(f.rel);
    if (out.length >= 12) break;
  }
  // Prefer UI files over config
  return out.sort((a, b) => uiScore(b) - uiScore(a));
}

function uiScore(rel: string): number {
  let s = 0;
  if (/\.(tsx|jsx|vue|svelte)$/.test(rel)) s += 3;
  if (/(components?|pages?|app|views?|screens?)\//.test(rel)) s += 2;
  if (/(config|setup|lib|utils?)\//.test(rel)) s -= 2;
  return s;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lastSegment(p: string): string {
  const segs = p.split("/").filter(Boolean);
  return (segs[segs.length - 1] ?? "").toLowerCase().replace(/\.(html?|php|aspx?|jsp)$/, "");
}

export function isAuthRoute(p: string): boolean {
  return AUTH_ROUTES.has(lastSegment(p));
}

const STOP = new Set(["the", "and", "with", "for", "your", "you", "from", "that", "this", "into", "are", "can", "all", "any", "our", "via", "using", "use", "each", "every", "over", "more", "than", "then", "also", "just", "get", "set", "new", "app", "web", "based", "built", "support", "supports", "supported", "easy", "simple", "fast", "powerful", "modern", "fully", "out", "box", "one", "two"]);

export function keywordsFor(text: string): string[] {
  return uniq(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/(ings?|ed|es|s)$/, ""))
      .filter((w) => w.length > 2 && !STOP.has(w)),
  ).slice(0, 8);
}

function bulletName(bullet: string): string | null {
  // "**Risk Dashboard** — see everything" → "Risk Dashboard"; "Real-time detection of X" → "Real-time detection of X"
  // The name/description separator is a colon or a dash *surrounded by spaces* — hyphens inside words ("Full-text") stay.
  const bold = bullet.match(/^\*{0,2}([^*:]{3,60}?)\*{0,2}(?::\s+|\s+[—–-]\s+)/);
  const raw = bold ? bold[1].trim() : bullet.split(/\s+/).slice(0, 4).join(" ").replace(/[.,;:!]+$/, "");
  if (raw.length < 3) return null;
  // Keep the author's casing (README names are already product vocabulary); just capitalise the first letter.
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** The descriptive tail of a README bullet ("**Name** — tail"), or the whole bullet when there is no name part. */
export function bulletTail(bullet: string): string {
  const m = bullet.match(/^\*{0,2}[^*:]{3,60}?\*{0,2}(?::\s+|\s+[—–-]\s+)(.+)$/);
  return (m ? m[1] : bullet).trim();
}

/** Look for files whose path or content mentions several of the keywords. */
export function searchEvidence(scan: ScanResult, terms: string[], max = 4): string[] {
  const strong = terms.filter((t) => t.length > 3);
  if (!strong.length) return [];
  const scored: Array<[string, number]> = [];
  for (const f of scan.files) {
    if (!/\.(tsx?|jsx?|vue|svelte|astro|py|go|rs|java|kt|rb|php|html)$/.test(f.rel)) continue;
    if (/\.(test|spec)\./.test(f.rel) || /(^|\/)(tests?|__tests__|node_modules)\//.test(f.rel)) continue;
    const pathLower = f.rel.toLowerCase();
    let score = 0;
    for (const t of strong) {
      if (pathLower.includes(t)) score += 3;
      else if (f.content) {
        const idx = f.content.toLowerCase().indexOf(t);
        if (idx >= 0) score += 1;
      }
    }
    if (score >= Math.min(2, strong.length)) scored.push([f.rel, score + uiScore(f.rel) * 0.1]);
  }
  return scored
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([rel]) => rel);
}
