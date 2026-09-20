import path from "node:path";
import { launchChromium } from "../shared/browser-launch.js";
import type { RepositoryAnalysis, RuntimeAnalysis } from "../types.js";
import type { ScanResult } from "../repository/scanner.js";
import { ensureDir } from "../shared/fs.js";
import { escapeHtml, slugify } from "../shared/text.js";
import { isDark, parseColor, toHex } from "../shared/color.js";

/**
 * Source-derived visuals: when the application cannot run (or has no UI at
 * all) we still show *real* artifacts from the repository — the actual code
 * of its most important files, rendered as cards in the project's own colors,
 * and the README's own words. Nothing here is invented.
 */

export interface SourceVisualOptions {
  outputDir: string;
  assetDir: string;
  palette: { background: string; surface: string; text: string; accent: string; mono: string };
}

export async function renderSourceVisuals(scan: ScanResult, analysis: RepositoryAnalysis, opts: SourceVisualOptions): Promise<RuntimeAnalysis["sourceDerived"]> {
  const dir = path.join(opts.outputDir, opts.assetDir);
  await ensureDir(dir);
  const picks = pickSourceFiles(scan, analysis);
  const out: RuntimeAnalysis["sourceDerived"] = [];
  let browser;
  try {
    browser = await launchChromium(["--disable-gpu", "--no-sandbox"]);
  } catch {
    return out;
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page.addInitScript("window.__name = window.__name || function (f) { return f; };");
    for (const pick of picks) {
      const id = `source-${slugify(path.basename(pick.rel))}`;
      const file = path.posix.join(opts.assetDir, `${id}.png`);
      await page.setContent(codeCardHtml(pick.rel, pick.snippet, pick.language, opts.palette), { waitUntil: "load" });
      await page.screenshot({ path: path.join(opts.outputDir, file), type: "png" });
      out.push({ id, file, title: pick.title, sourceFile: pick.rel });
    }
    // README words card
    if (analysis.readme.tagline) {
      const id = "source-readme";
      const file = path.posix.join(opts.assetDir, `${id}.png`);
      await page.setContent(readmeCardHtml(analysis, opts.palette), { waitUntil: "load" });
      await page.screenshot({ path: path.join(opts.outputDir, file), type: "png" });
      out.push({ id, file, title: "README", sourceFile: "README.md" });
    }
    await page.close();
  } finally {
    await browser.close().catch(() => {});
  }
  return out;
}

interface SourcePick {
  rel: string;
  snippet: string;
  language: string;
  title: string;
}

export function pickSourceFiles(scan: ScanResult, analysis: RepositoryAnalysis): SourcePick[] {
  const candidates = new Map<string, number>();
  const bump = (rel: string, w: number) => candidates.set(rel, (candidates.get(rel) ?? 0) + w);
  for (const f of analysis.features.slice(0, 8)) for (const e of f.evidence.slice(0, 2)) bump(e, 3 + f.confidence);
  for (const r of analysis.routes.slice(0, 6)) bump(r.file, 1.5);
  for (const a of analysis.apps) if (a.runCommand) bump(a.runCommand.reason.match(/[\w/.-]+\.(py|ts|js|tsx)/)?.[0] ?? "", 2);
  for (const rel of ["src/main.py", "main.py", "app.py", "src/index.ts", "src/main.ts", "src/App.tsx", "src/app.ts", "server.js", "index.js", "src/lib.rs", "main.go", "cmd/main.go"]) if (scan.byRel.get(rel)?.content) bump(rel, 1);
  const picks: SourcePick[] = [];
  const ranked = [...candidates.entries()].filter(([rel]) => rel && scan.byRel.get(rel)?.content).sort((a, b) => b[1] - a[1]);
  for (const [rel] of ranked) {
    const f = scan.byRel.get(rel)!;
    if (!/\.(tsx?|jsx?|py|go|rs|java|kt|rb|vue|svelte|html|css)$/.test(rel)) continue;
    const snippet = bestSnippet(f.content!, rel);
    if (snippet.split("\n").length < 6) continue;
    picks.push({ rel, snippet, language: path.extname(rel).slice(1), title: rel.split("/").pop() ?? rel });
    if (picks.length >= 4) break;
  }
  return picks;
}

/** Choose ~22 interesting lines: prefer the first exported function/class/component. */
function bestSnippet(content: string, rel: string): string {
  const lines = content.split(/\r?\n/);
  const isPy = rel.endsWith(".py");
  let start = lines.findIndex((l) => (isPy ? /^(class |def |async def |@app\.|@router\.|app = )/.test(l) : /^(export (default )?(async )?(function|class|const)|function |class |const \w+ = \(|@(Get|Post|Controller)\()/.test(l)));
  if (start < 0) start = lines.findIndex((l) => l.trim() && !/^(import|from|\/\/|#|\*|\/\*|"use|'use)/.test(l.trim()));
  if (start < 0) start = 0;
  const slice = lines.slice(start, start + 24).map((l) => l.replace(/\t/g, "  "));
  // Trim trailing blanks
  while (slice.length && !slice[slice.length - 1].trim()) slice.pop();
  return slice.join("\n");
}

const KEYWORDS = /\b(import|from|export|default|function|return|const|let|var|class|extends|async|await|if|else|for|while|def|self|None|True|False|try|except|with|as|new|this|interface|type|enum|public|private|static|void|fn|pub|struct|impl|match|use|package|func|go|defer|lambda|yield|in|not|and|or|is|elif|pass|raise|switch|case|break|continue)\b/g;

export function highlight(code: string, accent: string, text: string): string {
  const esc = escapeHtml(code);
  const muted = "opacity:.55";
  return esc
    .replace(/(&quot;.*?&quot;|&#39;.*?&#39;|`.*?`)/g, `<span style="color:${accent}">$1</span>`)
    .replace(/(\/\/.*$|#(?!\w).*$)/gm, `<span style="${muted}">$1</span>`)
    .replace(KEYWORDS, `<span style="color:${text};font-weight:700">$1</span>`)
    .replace(/\b(\d+(\.\d+)?)\b/g, `<span style="color:${accent}">$1</span>`);
}

export function codeCardHtml(rel: string, snippet: string, language: string, p: SourceVisualOptions["palette"]): string {
  const dark = isDark(p.background);
  const border = dark ? "rgba(255,255,255,.1)" : "rgba(0,0,0,.08)";
  const lines = snippet.split("\n");
  const gutter = lines.map((_, i) => `<span>${i + 1}</span>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1440px;height:900px;background:${p.background};color:${p.text};font-family:${p.mono};overflow:hidden}
  .wrap{position:absolute;inset:60px 90px;display:flex;flex-direction:column;border-radius:18px;background:${p.surface};border:1px solid ${border};box-shadow:0 30px 80px rgba(0,0,0,${dark ? ".45" : ".18"});overflow:hidden}
  .bar{display:flex;align-items:center;gap:10px;padding:16px 22px;border-bottom:1px solid ${border};font-size:16px;font-family:system-ui,sans-serif}
  .dot{width:12px;height:12px;border-radius:50%;background:${border}} .dot:first-child{background:${p.accent}}
  .path{opacity:.75;margin-left:8px}
  .lang{margin-left:auto;font-size:13px;padding:3px 10px;border-radius:99px;background:${p.accent};color:${dark ? "#0b0f14" : "#fff"};font-weight:600}
  .body{display:flex;flex:1;padding:24px 0;font-size:22px;line-height:1.5}
  .gutter{display:flex;flex-direction:column;padding:0 22px;opacity:.35;text-align:right;user-select:none}
  pre{margin:0;white-space:pre;overflow:hidden;flex:1;padding-right:24px}
  </style></head><body><div class="wrap">
  <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="path">${escapeHtml(rel)}</span><span class="lang">${escapeHtml(language)}</span></div>
  <div class="body"><div class="gutter">${gutter}</div><pre>${highlight(snippet, p.accent, p.text)}</pre></div>
  </div></body></html>`;
}

function readmeCardHtml(analysis: RepositoryAnalysis, p: SourceVisualOptions["palette"]): string {
  const dark = isDark(p.background);
  const bullets = analysis.readme.featureBullets.slice(0, 4).map((b) => `<li>${escapeHtml(b.length > 90 ? b.slice(0, 88) + "…" : b)}</li>`).join("");
  const accentSoft = (() => {
    const c = parseColor(p.accent);
    return c ? `rgba(${c.r},${c.g},${c.b},.18)` : "rgba(0,0,0,.1)";
  })();
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1440px;height:900px;background:${p.background};color:${p.text};font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden}
  .wrap{position:absolute;inset:90px 120px;display:flex;flex-direction:column;justify-content:center;gap:28px}
  h1{font-size:76px;margin:0;letter-spacing:-.03em;line-height:1.05}
  p{font-size:30px;margin:0;opacity:.85;max-width:1000px;line-height:1.35}
  ul{margin:8px 0 0;padding:0;list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:14px 28px;font-size:24px}
  li{padding:14px 18px;border-radius:12px;background:${accentSoft};border-left:5px solid ${p.accent}}
  .badge{display:inline-block;font-size:16px;letter-spacing:.14em;text-transform:uppercase;padding:6px 12px;border-radius:99px;background:${p.accent};color:${dark ? "#0b0f14" : "#fff"};width:max-content;font-weight:700}
  </style></head><body><div class="wrap">
  <span class="badge">${escapeHtml(toHex(parseColor(p.accent) ?? { r: 0, g: 0, b: 0, a: 1 }) && "README")}</span>
  <h1>${escapeHtml(analysis.name)}</h1>
  <p>${escapeHtml(analysis.readme.tagline ?? analysis.description)}</p>
  ${bullets ? `<ul>${bullets}</ul>` : ""}
  </div></body></html>`;
}
