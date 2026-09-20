import path from "node:path";
import { promises as fs } from "node:fs";
import type { Browser, Page } from "playwright";
import { launchChromium } from "../shared/browser-launch.js";
import type { DomSummary, ProgressReporter, Screen, StaticRoute, StyleSample, VideoFormat } from "../types.js";
import { ensureDir } from "../shared/fs.js";
import { slugify } from "../shared/text.js";
import { isAuthRoute } from "../repository/feature-analyzer.js";

export interface ExploreOptions {
  baseUrl: string;
  outputDir: string;
  /** Sub directory (relative to outputDir) where PNGs are written. */
  assetDir: string;
  staticRoutes: StaticRoute[];
  maxScreens: number;
  navigationTimeoutMs: number;
  format: VideoFormat;
  report?: ProgressReporter;
  /** Capture a phone-sized viewport too (used for vertical formats). */
  mobile?: boolean;
}

export interface ExploreResult {
  screens: Screen[];
  mobileScreens: Screen[];
  warnings: string[];
}

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const SKIP_LINK = /^(mailto:|tel:|javascript:|#|data:)/i;
const SKIP_PATH = /(logout|sign-?out|delete|remove|destroy|\.pdf$|\.zip$|\.png$|\.jpg$|\.svg$|\/api\/|\/_next\/|\/static\/|\/assets\/|\/cdn-cgi\/)/i;

export async function exploreApp(opts: ExploreOptions): Promise<ExploreResult> {
  const warnings: string[] = [];
  const report = opts.report ?? (() => {});
  let browser: Browser;
  try {
    browser = await launchChromium(["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"]);
  } catch (err) {
    throw new Error(`Playwright Chromium could not start: ${(err as Error).message}`);
  }
  try {
    const screens = await exploreViewport(browser, opts, DESKTOP, "desktop", warnings, report);
    let mobileScreens: Screen[] = [];
    if (opts.mobile && screens.length) {
      // Re-capture the top screens at phone width for vertical framing.
      const top = screens.slice(0, Math.min(6, screens.length));
      mobileScreens = await captureRoutes(browser, opts, MOBILE, "mobile", top.map((s) => s.route), warnings, report, true);
    }
    return { screens, mobileScreens, warnings };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function exploreViewport(browser: Browser, opts: ExploreOptions, viewport: { width: number; height: number }, label: string, warnings: string[], report: ProgressReporter): Promise<Screen[]> {
  // Seed the queue with the entry route and static routes (non-dynamic pages first).
  const seed: string[] = ["/"];
  for (const r of opts.staticRoutes.filter((r) => r.kind === "page" && !r.dynamic)) seed.push(r.path);
  const routes = dedupeRoutes(seed);
  return captureRoutes(browser, opts, viewport, label, routes, warnings, report, false);
}

async function captureRoutes(browser: Browser, opts: ExploreOptions, viewport: { width: number; height: number }, label: string, routes: string[], warnings: string[], report: ProgressReporter, fixed: boolean): Promise<Screen[]> {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: viewport.width < 500,
    hasTouch: viewport.width < 500,
    colorScheme: "light",
    reducedMotion: "reduce",
    ignoreHTTPSErrors: true,
    locale: "en-US",
    userAgent: viewport.width < 500 ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" : undefined,
  });
  // tsx/esbuild injects a `__name` helper into functions passed to page.evaluate; provide a no-op in the page.
  await context.addInitScript("window.__name = window.__name || function (f) { return f; };");
  context.setDefaultNavigationTimeout(opts.navigationTimeoutMs);
  context.setDefaultTimeout(Math.min(opts.navigationTimeoutMs, 15_000));
  // Block external network so repos cannot phone home during analysis; allow localhost + data URIs + fonts CDNs.
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (/^(data|blob):/.test(url) || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(url) || /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|esm\.sh|fonts\.bunny\.net|rsms\.me/.test(url)) return route.continue();
    return route.abort();
  });

  const page = await context.newPage();
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  const screens: Screen[] = [];
  const visited = new Set<string>();
  const queue = [...routes];
  const dir = path.join(opts.outputDir, opts.assetDir);
  await ensureDir(dir);
  const discoveredVia = new Map<string, Screen["discoveredVia"]>();
  for (const r of routes) discoveredVia.set(r, r === "/" ? "entry" : "static-route");

  while (queue.length && screens.length < opts.maxScreens) {
    const route = queue.shift()!;
    if (visited.has(route)) continue;
    visited.add(route);
    const url = new URL(route, opts.baseUrl).toString();
    const t0 = Date.now();
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded" });
      const status = resp?.status() ?? 0;
      if (status >= 400 && route !== "/") continue;
      await settle(page);
      // Skip if we were redirected to a route we already captured.
      const finalPath = normalizeRoute(new URL(page.url()).pathname);
      if (finalPath !== route && visited.has(finalPath) && screens.some((s) => s.route === finalPath)) continue;
      visited.add(finalPath);

      const dom = await page.evaluate(extractDomSummary);
      if (dom.textLength < 5 && dom.images === 0 && dom.buttons.length === 0 && route !== "/") continue;
      const styles = await page.evaluate(sampleStyles);
      const id = slugify(`${label}-${finalPath === "/" ? "home" : finalPath}`);
      const file = path.posix.join(opts.assetDir, `${id}.png`);
      await page.screenshot({ path: path.join(opts.outputDir, file), type: "png", animations: "disabled", caret: "hide" });
      let fullPageFile: string | undefined;
      let fullPageHeight: number | undefined;
      const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      if (scrollHeight > viewport.height * 1.3 && scrollHeight < viewport.height * 6) {
        fullPageFile = path.posix.join(opts.assetDir, `${id}-full.png`);
        await page.screenshot({ path: path.join(opts.outputDir, fullPageFile), type: "png", fullPage: true, animations: "disabled", caret: "hide" });
        fullPageHeight = scrollHeight;
      }
      const components = detectComponents(dom, styles);
      const screen: Screen = {
        id,
        route: finalPath,
        url: page.url(),
        title: dom.title || dom.headings[0] || finalPath,
        file,
        fullPageFile,
        fullPageHeight,
        viewport,
        dom,
        styles,
        components,
        richness: 0,
        importance: 0,
        score: 0,
        discoveredVia: discoveredVia.get(route) ?? "link",
        captureMs: Date.now() - t0,
      };
      scoreScreen(screen, opts.staticRoutes);
      screens.push(screen);
      report({ step: "browser", status: "done", message: `Captured ${finalPath} (${components.slice(0, 4).join(", ") || "page"})` });

      // Interaction capture: click the first primary-looking control that does not navigate away (desktop only, first few screens).
      if (!fixed && screens.length <= 3 && !dom.authWall) {
        const interaction = await tryInteraction(page, opts, id);
        if (interaction) screen.interaction = interaction;
      }

      // Discover links (desktop crawl only)
      if (!fixed) {
        const links = dom.links.map((l) => l.href).concat(await page.evaluate(collectNavHrefs));
        for (const href of links) {
          if (SKIP_LINK.test(href)) continue;
          let p: string;
          try {
            const u = new URL(href, opts.baseUrl);
            if (u.origin !== new URL(opts.baseUrl).origin) continue;
            p = normalizeRoute(u.pathname);
          } catch {
            continue;
          }
          if (SKIP_PATH.test(p) || visited.has(p) || queue.includes(p) || [...visited].some((v) => v.toLowerCase() === p.toLowerCase())) continue;
          if (isAuthRoute(p) && screens.length > 1) continue;
          discoveredVia.set(p, "link");
          queue.push(p);
        }
        // Prefer static routes and shallow paths first.
        queue.sort((a, b) => routePriority(a, opts.staticRoutes) - routePriority(b, opts.staticRoutes));
      }
    } catch (err) {
      warnings.push(`${label} ${route}: ${(err as Error).message.split("\n")[0]}`);
    }
  }
  await context.close().catch(() => {});
  return screens.sort((a, b) => b.score - a.score);
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
  await page.evaluate(() => (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready).catch(() => {});
  await page.waitForTimeout(700);
  // Dismiss cookie banners / dev overlays that would pollute screenshots.
  await page
    .evaluate(() => {
      const kill = ["nextjs-portal", "vite-error-overlay", "#webpack-dev-server-client-overlay", "[id*='cookie']", "[class*='cookie-banner']", "[class*='CookieConsent']"];
      for (const sel of kill) document.querySelectorAll(sel).forEach((el) => (el as HTMLElement).remove());
    })
    .catch(() => {});
}

async function tryInteraction(page: Page, opts: ExploreOptions, id: string): Promise<Screen["interaction"] | undefined> {
  try {
    const target = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>("button, [role=tab], [role=button], summary"));
      const good = candidates.find((el) => {
        const r = el.getBoundingClientRect();
        const text = (el.innerText || el.getAttribute("aria-label") || "").trim();
        if (r.width < 40 || r.height < 20 || r.top < 0 || r.top > window.innerHeight) return false;
        if (!text || /(sign ?out|log ?out|delete|remove|close|dismiss|submit|pay|buy|purchase|send|confirm|reset|cancel|github|twitter)/i.test(text)) return false;
        return /(tab|toggle|open|show|view|expand|details|filter|analy|run|generate|create|new|add|menu|settings|dark|theme|preview|explore|demo|start)/i.test(text) || el.getAttribute("role") === "tab";
      });
      if (!good) return null;
      good.setAttribute("data-hfl-target", "1");
      return (good.innerText || good.getAttribute("aria-label") || "").trim().slice(0, 40);
    });
    if (!target) return undefined;
    const urlBefore = page.url();
    await page.click("[data-hfl-target='1']", { timeout: 3000 });
    await page.waitForTimeout(900);
    if (page.url() !== urlBefore) {
      await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
      return undefined;
    }
    const file = path.posix.join(opts.assetDir, `${id}-after-click.png`);
    const after = await page.screenshot({ path: path.join(opts.outputDir, file), type: "png", animations: "disabled" });
    // Close anything we opened.
    await page.keyboard.press("Escape").catch(() => {});
    // A click that changed nothing visible is not an interaction worth showing.
    const before = await fs.readFile(path.join(opts.outputDir, opts.assetDir, `${id}.png`)).catch(() => null);
    if (before && before.equals(after)) {
      await fs.rm(path.join(opts.outputDir, file), { force: true }).catch(() => {});
      return undefined;
    }
    return { action: "click", target, file };
  } catch {
    return undefined;
  }
}

/** `/index.html`, `/index`, trailing slashes → canonical route. */
export function normalizeRoute(pathname: string): string {
  let p = pathname.replace(/\/+$/, "");
  p = p.replace(/\/index(\.html?)?$/i, "");
  return p || "/";
}

function dedupeRoutes(routes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of routes) {
    const p = normalizeRoute(r);
    if (!seen.has(p) && !SKIP_PATH.test(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

function routePriority(p: string, staticRoutes: StaticRoute[]): number {
  let s = p.split("/").filter(Boolean).length * 2;
  if (staticRoutes.some((r) => r.path === p)) s -= 3;
  if (/(dashboard|app|home|overview|analytics|projects?|reports?|editor|studio|workspace|explore|feed|inbox|chat)/i.test(p)) s -= 2;
  if (isAuthRoute(p)) s += 4;
  if (/(about|contact|terms|privacy|blog|docs|changelog|pricing|faq)/i.test(p)) s += 2;
  return s;
}

/** Runs inside the page. Must be self-contained. */
function extractDomSummary(): DomSummary {
  const text = (el: Element | null) => (el ? ((el as HTMLElement).innerText || el.textContent || "").trim().replace(/\s+/g, " ") : "");
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  };
  const headings = Array.from(document.querySelectorAll("h1, h2, h3")).filter(visible).map(text).filter((t) => t.length > 1 && t.length < 120).slice(0, 20);
  const buttons = Array.from(document.querySelectorAll("button, [role=button], input[type=submit], a.btn, a[class*='button'], a[class*='Button']")).filter(visible).map(text).filter((t) => t && t.length < 40).slice(0, 30);
  const links = Array.from(document.querySelectorAll("a[href]")).filter(visible).map((a) => ({ text: text(a).slice(0, 60), href: (a as HTMLAnchorElement).getAttribute("href") || "" })).filter((l) => l.href).slice(0, 80);
  const navRoot = document.querySelector("nav, [role=navigation], aside, header");
  const navItems = navRoot ? Array.from(navRoot.querySelectorAll("a, button")).filter(visible).map(text).filter((t) => t && t.length < 32).slice(0, 20) : [];
  const forms = document.querySelectorAll("form").length;
  const inputs = Array.from(document.querySelectorAll("input:not([type=hidden]), textarea, select")).filter(visible).length;
  const tables = Array.from(document.querySelectorAll("table, [role=table], [role=grid], .ag-root, [class*='DataGrid'], [class*='data-grid']")).filter(visible).length;
  const charts = Array.from(document.querySelectorAll("canvas, svg.recharts-surface, .recharts-wrapper, [class*='chart'], [class*='Chart'], .apexcharts-canvas, .highcharts-container, .plotly, .echarts, [class*='graph'], [class*='Graph']")).filter(visible).filter((el) => el.getBoundingClientRect().width > 80).length;
  const images = Array.from(document.querySelectorAll("img, picture, video, [style*='background-image']")).filter(visible).filter((el) => el.getBoundingClientRect().width > 48).length;
  const cardSel = "[class*='card'], [class*='Card'], [class*='tile'], [class*='panel'], [class*='Panel'], article, .rounded-xl, .rounded-2xl, .rounded-lg";
  const cards = Array.from(document.querySelectorAll(cardSel)).filter(visible).filter((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 120 && r.height > 60 && (cs.boxShadow !== "none" || cs.borderStyle !== "none" || cs.backgroundColor !== "rgba(0, 0, 0, 0)");
  }).length;
  const aside = document.querySelector("aside, [class*='sidebar'], [class*='Sidebar'], nav[class*='side']");
  const hasSidebar = !!aside && visible(aside) && aside.getBoundingClientRect().height > window.innerHeight * 0.5 && aside.getBoundingClientRect().width < 420;
  const header = document.querySelector("header, nav, [role=navigation], [class*='navbar'], [class*='Navbar'], [class*='topbar']");
  const hasNavbar = !!header && visible(header) && header.getBoundingClientRect().top < 120;
  const hasDialog = Array.from(document.querySelectorAll("dialog[open], [role=dialog], [role=alertdialog], [class*='modal'], [class*='Modal']")).some(visible);
  const tabs = Array.from(document.querySelectorAll("[role=tab], [class*='tab-'], [class*='Tab']")).filter(visible).length;
  const badges = Array.from(document.querySelectorAll("[class*='badge'], [class*='Badge'], [class*='chip'], [class*='Chip'], [class*='tag'], [class*='Tag'], [class*='pill']")).filter(visible).filter((el) => el.getBoundingClientRect().width < 200).length;
  const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
  const authWall = (() => {
    const pw = Array.from(document.querySelectorAll("input[type=password]")).filter(visible).length > 0;
    const t = bodyText.toLowerCase();
    return pw && /(sign in|log in|login|password)/.test(t) && bodyText.length < 1500;
  })();
  const bodyCs = getComputedStyle(document.body);
  let bodyBackground = bodyCs.backgroundColor;
  if (bodyBackground === "rgba(0, 0, 0, 0)" || bodyBackground === "transparent") {
    const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
    bodyBackground = htmlBg === "rgba(0, 0, 0, 0)" ? "rgb(255, 255, 255)" : htmlBg;
    // Full-bleed wrappers often carry the real background.
    const first = document.body.firstElementChild as HTMLElement | null;
    if (first) {
      const bg = getComputedStyle(first).backgroundColor;
      const r = first.getBoundingClientRect();
      if (bg !== "rgba(0, 0, 0, 0)" && r.width > window.innerWidth * 0.8 && r.height > window.innerHeight * 0.6) bodyBackground = bg;
    }
  }
  return {
    title: document.title || "",
    headings,
    buttons,
    links,
    navItems,
    forms,
    inputs,
    tables,
    charts,
    images,
    cards,
    hasSidebar,
    hasNavbar,
    hasDialog,
    tabs,
    badges,
    textLength: bodyText.length,
    authWall,
    bodyBackground,
    bodyColor: bodyCs.color,
    overflowsViewport: document.documentElement.scrollWidth > window.innerWidth + 8,
  };
}

/** Runs inside the page. Samples computed styles weighted by element area. */
function sampleStyles(): StyleSample {
  const out: StyleSample = { backgrounds: {}, textColors: {}, fontFamilies: {}, fontSizes: {}, fontWeights: {}, borderRadii: {}, shadows: {}, gradients: [], backdropFilters: 0, iconCount: 0, monospaceUsage: 0 };
  const els = Array.from(document.querySelectorAll("body *")).slice(0, 2500) as HTMLElement[];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const bump = (rec: Record<string, number>, key: string, w: number) => {
    if (!key) return;
    rec[key] = (rec[key] ?? 0) + w;
  };
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > vh * 1.5) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const area = Math.min(r.width, vw) * Math.min(r.height, vh);
    const bg = cs.backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") bump(out.backgrounds, bg, area);
    const bgi = cs.backgroundImage;
    if (bgi && /gradient\(/.test(bgi) && out.gradients.length < 12 && !out.gradients.includes(bgi)) out.gradients.push(bgi);
    const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim().length > 0);
    if (hasText) {
      const chars = (el.textContent || "").trim().length;
      bump(out.textColors, cs.color, chars);
      const fam = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
      bump(out.fontFamilies, fam, chars);
      bump(out.fontSizes, cs.fontSize, chars);
      bump(out.fontWeights, cs.fontWeight, chars);
      if (/mono|code|courier|consolas|menlo/i.test(cs.fontFamily)) out.monospaceUsage += chars;
    }
    const br = cs.borderRadius;
    if (br && br !== "0px" && r.width > 24 && r.height > 24) bump(out.borderRadii, br.split(" ")[0], 1);
    if (cs.boxShadow && cs.boxShadow !== "none" && r.width > 40) bump(out.shadows, cs.boxShadow.slice(0, 80), 1);
    const bf = (cs as CSSStyleDeclaration & { backdropFilter?: string; webkitBackdropFilter?: string }).backdropFilter || (cs as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter;
    if (bf && bf !== "none") out.backdropFilters++;
    if ((el.tagName === "svg" || el.tagName === "SVG") && r.width <= 48 && r.height <= 48) out.iconCount++;
  }
  return out;
}

function collectNavHrefs(): string[] {
  return Array.from(document.querySelectorAll("nav a[href], aside a[href], header a[href], [role=navigation] a[href], [role=menuitem][href]")).map((a) => (a as HTMLAnchorElement).getAttribute("href") || "");
}

export function detectComponents(dom: DomSummary, styles: StyleSample): string[] {
  const c: string[] = [];
  if (dom.hasNavbar) c.push("navbar");
  if (dom.hasSidebar) c.push("sidebar");
  if (dom.cards >= 2) c.push("cards");
  if (dom.tables) c.push("table");
  if (dom.charts) c.push("chart");
  if (dom.buttons.length >= 2) c.push("buttons");
  if (dom.forms || dom.inputs >= 2) c.push("form");
  if (dom.hasDialog) c.push("dialog");
  if (dom.tabs >= 2) c.push("tabs");
  if (dom.badges >= 2) c.push("badges");
  if (dom.images >= 2) c.push("images");
  if (styles.backdropFilters > 0) c.push("glass");
  if (styles.monospaceUsage > 200) c.push("code");
  if (dom.authWall) c.push("auth");
  if (dom.headings.length && dom.textLength > 400 && !dom.tables && !dom.charts && dom.cards < 2) c.push("content");
  return c;
}

export function scoreScreen(screen: Screen, staticRoutes: StaticRoute[]): void {
  const d = screen.dom;
  // Visual richness: variety of components, imagery, cards, charts, non-empty content.
  let rich = 0;
  rich += Math.min(0.25, d.charts * 0.12);
  rich += Math.min(0.2, d.cards * 0.04);
  rich += Math.min(0.15, d.tables * 0.08);
  rich += Math.min(0.12, d.images * 0.03);
  rich += Math.min(0.1, d.buttons.length * 0.015);
  rich += d.hasSidebar ? 0.08 : 0;
  rich += d.hasNavbar ? 0.04 : 0;
  rich += Math.min(0.08, Object.keys(screen.styles.backgrounds).length * 0.01);
  rich += screen.styles.gradients.length ? 0.05 : 0;
  if (d.textLength < 40) rich *= 0.4;
  if (d.authWall) rich *= 0.35;
  screen.richness = Math.min(1, rich);

  // Product importance: is this a "working app" screen rather than a marketing/legal page?
  let imp = 0.3;
  const r = screen.route.toLowerCase();
  if (r === "/") imp += 0.25;
  if (/(dashboard|overview|home|app|workspace|studio|editor|projects?|analytics|reports?|insights?|inbox|feed|chat|explore|search|results?|monitor|graph|map|board|canvas|table|list|detail|review|cases?|risk|alerts?|scan|analy)/.test(r)) imp += 0.3;
  if (/(settings?|profile|account|preferences?|admin)/.test(r)) imp += 0.05;
  if (/(about|contact|terms|privacy|legal|blog|changelog|faq|docs|404)/.test(r)) imp -= 0.25;
  if (isAuthRoute(r)) imp -= 0.2;
  if (staticRoutes.some((s) => s.path === screen.route)) imp += 0.1;
  if (d.tables || d.charts) imp += 0.1;
  if (d.forms && d.inputs >= 3) imp += 0.05;
  screen.importance = Math.max(0, Math.min(1, imp));
  screen.score = Math.round((screen.richness * 0.55 + screen.importance * 0.45) * 100) / 100;
}
