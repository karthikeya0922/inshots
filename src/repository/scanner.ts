import path from "node:path";
import { walk, readText, type WalkEntry } from "../shared/fs.js";
import { isSecretFile, isSecretTemplateFile, redactSecrets } from "./secrets.js";
import { looksLikeMetric, stripMarkdown } from "../shared/text.js";
import type { DesignTokens, ReadmeSummary } from "../types.js";

export interface ScannedFile extends WalkEntry {
  /** Redacted content, only loaded for text files under the size limit. */
  content?: string;
  redactions: number;
}

export interface ScanResult {
  root: string;
  files: ScannedFile[];
  byRel: Map<string, ScannedFile>;
  languages: Record<string, number>;
  readme: ReadmeSummary;
  designTokens: DesignTokens;
  brandAssets: string[];
  importantFiles: string[];
  secrets: { redactedFiles: string[]; redactedValues: number };
}

const TEXT_EXT = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".astro",
  ".json", ".md", ".mdx", ".txt", ".yml", ".yaml", ".toml", ".html", ".htm", ".css", ".scss",
  ".sass", ".less", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".cs", ".php", ".xml",
  ".gradle", ".sql", ".prisma", ".graphql", ".gql", ".env", ".sh", ".ps1", ".cfg", ".ini",
  ".dockerfile", ".conf", ".ejs", ".hbs", ".pug", ".njk", ".liquid", ".swift", ".dart",
]);

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".vue": "Vue", ".svelte": "Svelte", ".astro": "Astro",
  ".py": "Python", ".rb": "Ruby", ".go": "Go", ".rs": "Rust", ".java": "Java", ".kt": "Kotlin",
  ".cs": "C#", ".php": "PHP", ".swift": "Swift", ".dart": "Dart",
  ".html": "HTML", ".css": "CSS", ".scss": "SCSS", ".sass": "SCSS", ".less": "Less",
  ".sql": "SQL", ".prisma": "Prisma", ".graphql": "GraphQL",
};

const IMPORTANT_NAMES = [
  "README.md", "readme.md", "README", "package.json", "pnpm-lock.yaml", "yarn.lock", "package-lock.json",
  "bun.lockb", "requirements.txt", "pyproject.toml", "Pipfile", "pom.xml", "build.gradle",
  "build.gradle.kts", "go.mod", "Cargo.toml", "Gemfile", "composer.json", "docker-compose.yml",
  "docker-compose.yaml", "Dockerfile", "Procfile", "vercel.json", "netlify.toml", "next.config.js",
  "next.config.mjs", "next.config.ts", "vite.config.ts", "vite.config.js", "nuxt.config.ts", "angular.json",
  "svelte.config.js", "astro.config.mjs", "tailwind.config.js", "tailwind.config.ts", "tailwind.config.cjs",
  "tsconfig.json", "app.json", "manifest.json", "index.html", "main.py", "app.py", "manage.py", "server.js",
  "server.ts", "index.js", "index.ts", "turbo.json", "pnpm-workspace.yaml", "lerna.json", "nx.json",
  "schema.prisma", "supabase/config.toml", "firebase.json",
];

export async function scanRepository(root: string, opts: { maxFiles?: number } = {}): Promise<ScanResult> {
  const entries = await walk(root, { maxFiles: opts.maxFiles ?? 20000 });
  const files: ScannedFile[] = [];
  const byRel = new Map<string, ScannedFile>();
  const languages: Record<string, number> = {};
  const secrets = { redactedFiles: [] as string[], redactedValues: 0 };
  const brandAssets: string[] = [];
  const importantFiles: string[] = [];

  for (const e of entries) {
    const f: ScannedFile = { ...e, redactions: 0 };
    const base = path.basename(e.rel);
    const lang = LANG_BY_EXT[e.ext];
    if (lang && !isTestOrGenerated(e.rel)) languages[lang] = (languages[lang] ?? 0) + e.size;

    if (isSecretFile(e.rel) && !isSecretTemplateFile(e.rel)) {
      // Never load real secret files. Record and move on.
      secrets.redactedFiles.push(e.rel);
      files.push(f);
      byRel.set(e.rel, f);
      continue;
    }

    if (TEXT_EXT.has(e.ext) || base.toLowerCase().startsWith("dockerfile") || IMPORTANT_NAMES.includes(base) || /^(LICENSE|LICENCE|COPYING|NOTICE|Procfile|Makefile)/i.test(base)) {
      if (e.size <= 400 * 1024 && !/\.(min|bundle)\.(js|css)$/.test(base) && !/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(e.rel)) {
        const raw = await readText(e.abs, 400 * 1024);
        const red = redactSecrets(raw);
        f.content = red.text;
        f.redactions = red.count;
        if (red.count) {
          secrets.redactedValues += red.count;
          secrets.redactedFiles.push(e.rel);
        }
      }
    }
    if (isBrandAsset(e.rel)) brandAssets.push(e.rel);
    if (IMPORTANT_NAMES.includes(base) || IMPORTANT_NAMES.includes(e.rel)) importantFiles.push(e.rel);
    files.push(f);
    byRel.set(e.rel, f);
  }

  const readme = parseReadme(findReadme(files));
  const designTokens = await extractDesignTokens(files);

  return {
    root,
    files,
    byRel,
    languages,
    readme,
    designTokens,
    brandAssets: brandAssets.sort((a, b) => brandScore(b) - brandScore(a)).slice(0, 12),
    importantFiles: importantFiles.sort((a, b) => a.split("/").length - b.split("/").length),
    secrets,
  };
}

function isTestOrGenerated(rel: string): boolean {
  return /(^|\/)(test|tests|__tests__|spec|e2e|fixtures)\//.test(rel) || /\.(test|spec)\.[jt]sx?$/.test(rel) || /\.d\.ts$/.test(rel);
}

function isBrandAsset(rel: string): boolean {
  const base = path.basename(rel).toLowerCase();
  if (!/\.(svg|png|jpg|jpeg|webp|ico|gif)$/.test(base)) return false;
  if (/(^|\/)(node_modules|test|tests|fixtures|screenshots?|docs?\/images?)\//.test(rel)) return false;
  return /(logo|brand|icon|favicon|mark|wordmark|hero|og[-_]?image|banner|cover|screenshot|demo|preview)/.test(rel.toLowerCase()) || /^(public|static|assets|src\/assets|app\/assets)\//.test(rel);
}

function brandScore(rel: string): number {
  const l = rel.toLowerCase();
  let s = 0;
  if (/logo/.test(l)) s += 5;
  if (/wordmark|brand/.test(l)) s += 4;
  if (/\.svg$/.test(l)) s += 2;
  if (/favicon|icon/.test(l)) s += 1;
  if (/screenshot|demo|preview|hero|banner|og/.test(l)) s += 3;
  s -= l.split("/").length * 0.1;
  return s;
}

function findReadme(files: ScannedFile[]): string {
  const candidates = files
    .filter((f) => /^readme(\.(md|mdx|rst|txt))?$/i.test(path.basename(f.rel)) && f.content)
    .sort((a, b) => a.rel.split("/").length - b.rel.split("/").length);
  return candidates[0]?.content ?? "";
}

export function parseReadme(md: string): ReadmeSummary {
  const summary: ReadmeSummary = {
    featureBullets: [],
    headings: [],
    badges: [],
    metricClaims: [],
    installCommands: [],
    usageCommands: [],
    screenshots: [],
  };
  if (!md.trim()) return summary;
  const lines = md.split(/\r?\n/);

  // Title
  const h1 = lines.find((l) => /^#\s+/.test(l));
  if (h1) summary.title = stripMarkdown(h1.replace(/^#\s+/, "")).trim();
  else {
    const setext = lines.findIndex((l, i) => /^=+\s*$/.test(l) && i > 0);
    if (setext > 0) summary.title = stripMarkdown(lines[setext - 1]).trim();
  }

  // Badges & screenshots
  for (const m of md.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
    const alt = m[1].toLowerCase();
    const url = m[2];
    if (/shields\.io|badge|travis|circleci|codecov|coveralls|github\.com\/.+\/workflows/.test(url) || /badge|build|license|coverage|npm|version/.test(alt)) summary.badges.push(url);
    else summary.screenshots.push(url);
  }

  // Headings
  summary.headings = lines.filter((l) => /^#{2,4}\s+/.test(l)).map((l) => stripMarkdown(l.replace(/^#+\s+/, "")));

  // Tagline: first non-empty, non-badge, non-heading paragraph line after title
  const bodyStart = h1 ? lines.indexOf(h1) + 1 : 0;
  const paragraphs: string[] = [];
  let buf: string[] = [];
  for (let i = bodyStart; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*$/.test(l)) {
      if (buf.length) paragraphs.push(buf.join(" "));
      buf = [];
      continue;
    }
    if (/^#{1,6}\s/.test(l)) {
      if (buf.length) paragraphs.push(buf.join(" "));
      buf = [];
      if (paragraphs.length >= 3) break;
      continue;
    }
    if (/^\s*(!\[|\[!\[|<img|<p align|<div|<a |<\/|<br|\|)/i.test(l)) continue;
    if (/^\s*[-*+]\s|^\s*\d+\.\s|^```/.test(l)) continue;
    buf.push(l.trim());
  }
  if (buf.length) paragraphs.push(buf.join(" "));
  const clean = paragraphs.map(stripMarkdown).filter((p) => p.length > 12);
  if (clean[0]) summary.tagline = clean[0].length > 160 ? clean[0].slice(0, 157).replace(/\s+\S*$/, "") + "…" : clean[0];
  summary.description = clean.slice(0, 2).join(" ").slice(0, 600);

  // Feature bullets under a Features/What/Highlights/Capabilities heading (or top-level bullets)
  let inFeatures = false;
  let inExcluded = false;
  let inCode = false;
  let genericBullets: string[] = [];
  for (const l of lines) {
    if (/^\s*```/.test(l)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    if (/^#{1,4}\s+/.test(l)) {
      // Bullets under these headings describe setup, structure or process — never product features.
      inExcluded = /requirement|prerequisite|install|setup|getting started|usage|quick ?start|licen[cs]e|contribut|structure|layout|files?|folders?|in (this|the) repo|repo(sitory)? (contents|tree)|credits?|acknowledg|faq|troubleshoot|changelog|roadmap|todo|configuration|options|flags|command|develop|testing|deploy|environment|dependenc|support|community|author|related|reference|links?|table of contents|contents|security|limitation|error|verif|rules?|laws?|pipeline|differs?|comparison|output|caveat|known issues|disclaimer/i.test(l);
      inFeatures = !inExcluded && /feature|highlight|capabilit|what (it|you|can) do|key|why|includes|overview|functionality/i.test(l);
      continue;
    }
    const bullet = l.match(/^\s*[-*+]\s+(.+)/);
    if (!bullet || inExcluded) continue;
    const text = stripMarkdown(bullet[1]).replace(/^\*\*|\*\*$/g, "").trim();
    if (text.length < 4 || text.length > 200) continue;
    if (/^["'“‘`]/.test(text)) continue; // quoted rule/example bullets are never features
    if (/^(npm|yarn|pnpm|pip|git|cd|docker|node|python|brew|apt|curl|wget)\b/i.test(text)) continue;
    if (/^[\w.@-]*\/[\w./-]*(\s*([—–:-]|$))/.test(text) || /^\.[\w-]/.test(text)) continue; // paths and dotfiles (also "dir/ — description")
    if (/^[\w.+-]+\s+v?\d+(\.\d+)*\+?$/i.test(text) || /\bv?\d+(\.\d+)+\+?$/.test(text)) continue; // version requirements
    if (inFeatures) summary.featureBullets.push(text);
    else genericBullets.push(text);
  }
  if (summary.featureBullets.length === 0) summary.featureBullets = genericBullets.filter((b) => !/^http/.test(b) && b.split(/\s+/).length >= 2).slice(0, 12);
  summary.featureBullets = summary.featureBullets.slice(0, 20);

  // Metric-looking claims
  for (const line of lines) {
    if (/^\s*(```|\||<|!\[|\[!\[)/.test(line) || /shields|badge|http/.test(line)) continue;
    for (const sentence of stripMarkdown(line.replace(/^\s*[-*+]\s+|^\s*\d+\.\s+/, "")).split(/(?<=[.!?])\s+/)) {
      const s = sentence.trim();
      if (s.length > 8 && s.length < 200 && looksLikeMetric(s)) summary.metricClaims.push(s);
    }
  }
  summary.metricClaims = Array.from(new Set(summary.metricClaims)).slice(0, 10);

  // Commands in code fences
  for (const block of md.matchAll(/```(?:bash|sh|shell|zsh|console|cmd|powershell)?\n([\s\S]*?)```/g)) {
    for (const line of block[1].split(/\r?\n/)) {
      const cmd = line.replace(/^\s*\$\s*/, "").trim();
      if (!cmd || cmd.startsWith("#")) continue;
      if (/^(npm i|npm install|pnpm i|pnpm install|yarn( install)?$|pip install|poetry install|uv (sync|pip)|bun install|go get|cargo build|mvn install)/.test(cmd)) summary.installCommands.push(cmd);
      else if (/^(npm run|npm start|pnpm( run)? (dev|start)|yarn (dev|start)|bun (run )?(dev|start)|python|uvicorn|flask|streamlit|gunicorn|node |npx |mvn spring-boot|gradle bootRun|go run|cargo run|docker compose up|docker-compose up|rails s)/.test(cmd)) summary.usageCommands.push(cmd);
    }
  }
  summary.installCommands = Array.from(new Set(summary.installCommands)).slice(0, 6);
  summary.usageCommands = Array.from(new Set(summary.usageCommands)).slice(0, 8);
  return summary;
}

/** Extract CSS custom properties, fonts, and tailwind theme colors from source. */
export async function extractDesignTokens(files: ScannedFile[]): Promise<DesignTokens> {
  const tokens: DesignTokens = { colors: {}, fonts: [], radii: [], customProperties: {}, source: [] };
  const cssFiles = files.filter((f) => f.content && /\.(css|scss|sass|less)$/.test(f.rel) && !/(^|\/)(node_modules|dist|build)\//.test(f.rel) && !/\.min\.css$/.test(f.rel));
  // Prefer global-looking files first.
  cssFiles.sort((a, b) => globalCssScore(b.rel) - globalCssScore(a.rel));
  const colorCounts: Record<string, number> = {};
  const fontCounts: Record<string, number> = {};
  const radiusCounts: Record<string, number> = {};

  for (const f of cssFiles.slice(0, 40)) {
    const css = f.content!;
    let matchedAny = false;
    for (const m of css.matchAll(/--([a-zA-Z0-9_-]+)\s*:\s*([^;}]+)[;}]/g)) {
      const name = m[1];
      const value = m[2].trim();
      if (value.length > 120) continue;
      if (!(name in tokens.customProperties)) tokens.customProperties[name] = value;
      matchedAny = true;
      if (/^(#|rgb|hsl|oklch|oklab)/.test(value) || /^\d+(\.\d+)?%?\s+\d/.test(value)) {
        if (/(color|bg|background|primary|accent|brand|foreground|surface|muted|border|ring|text)/i.test(name)) tokens.colors[name] = value;
      }
      if (/radius/i.test(name)) radiusCounts[value] = (radiusCounts[value] ?? 0) + 3;
      if (/font/i.test(name) && /['",a-z]/i.test(value) && !/^\d/.test(value)) fontCounts[value] = (fontCounts[value] ?? 0) + 3;
    }
    for (const m of css.matchAll(/(?:background(?:-color)?|color|border-color|fill)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\))/g)) {
      colorCounts[m[1].toLowerCase()] = (colorCounts[m[1].toLowerCase()] ?? 0) + 1;
      matchedAny = true;
    }
    for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/g)) {
      const fam = m[1].trim().replace(/!important/g, "").trim();
      if (!/^var\(/.test(fam)) fontCounts[fam] = (fontCounts[fam] ?? 0) + 1;
      matchedAny = true;
    }
    for (const m of css.matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
      const v = m[1].trim();
      if (!/^var\(/.test(v)) radiusCounts[v] = (radiusCounts[v] ?? 0) + 1;
    }
    if (matchedAny) tokens.source.push(f.rel);
  }

  // Google Fonts links in HTML
  for (const f of files.filter((f) => f.content && /\.(html|astro|vue|svelte|tsx|jsx|ts|js)$/.test(f.rel)).slice(0, 200)) {
    for (const m of f.content!.matchAll(/fonts\.googleapis\.com\/css2?\?[^"'\s)]*family=([^"'&\s)]+)/g)) {
      for (const fam of m[1].split("|")) {
        const name = decodeURIComponent(fam.split(":")[0].replace(/\+/g, " "));
        fontCounts[name] = (fontCounts[name] ?? 0) + 4;
      }
    }
    // next/font usage: import { Inter } from "next/font/google"
    for (const m of f.content!.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']next\/font\/google["']/g)) {
      for (const n of m[1].split(",")) {
        const name = n.trim().replace(/_/g, " ");
        if (name) fontCounts[name] = (fontCounts[name] ?? 0) + 4;
      }
    }
  }

  // Tailwind config theme colors
  const tw = files.find((f) => f.content && /(^|\/)tailwind\.config\.(js|cjs|mjs|ts)$/.test(f.rel));
  if (tw?.content) {
    const themeColors: Record<string, string> = {};
    for (const m of tw.content.matchAll(/([a-zA-Z0-9_-]+|"[^"]+"|'[^']+')\s*:\s*["'](#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsl\([^)]*\)|oklch\([^)]*\))["']/g)) {
      themeColors[m[1].replace(/["']/g, "")] = m[2];
    }
    const darkMode = tw.content.match(/darkMode\s*:\s*["']?([a-z]+)/)?.[1];
    tokens.tailwind = { darkMode, themeColors };
    tokens.source.push(tw.rel);
  }

  tokens.fonts = Object.entries(fontCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([f]) => f)
    .slice(0, 6);
  tokens.radii = Object.entries(radiusCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([r]) => r)
    .slice(0, 4);
  // Fall back to most frequent literal colors if no semantic custom props.
  if (Object.keys(tokens.colors).length === 0) {
    for (const [c] of Object.entries(colorCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)) tokens.colors[`literal-${Object.keys(tokens.colors).length}`] = c;
  }
  return tokens;
}

function globalCssScore(rel: string): number {
  const l = rel.toLowerCase();
  let s = 0;
  if (/(global|globals|index|main|app|style|styles|theme|tokens|variables|base|root)\.(css|scss)$/.test(l)) s += 5;
  if (/tailwind/.test(l)) s += 2;
  s -= l.split("/").length * 0.3;
  if (/\.module\./.test(l)) s -= 3;
  return s;
}
