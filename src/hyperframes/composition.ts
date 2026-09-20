import path from "node:path";
import { promises as fs } from "node:fs";
import { sfxAssetPath, type AudioData } from "../audio/index.js";
import type { MusicSelection, ProductDNA, Scene, SfxSelection, Storyboard, VisualSystem } from "../types.js";
import { ensureContrast, isDark, mix, parseColor, rgbaString, readableTextOn } from "../shared/color.js";
import { escapeHtml } from "../shared/text.js";
import { copyFile, ensureDir, writeText } from "../shared/fs.js";

/**
 * Composition builder — writes a standalone Hyperframes project:
 *
 *   composition/
 *     index.html          one paused GSAP timeline, scenes as timed clips
 *     hyperframes.json    project config (registry paths)
 *     package.json        npm scripts (check / render / preview)
 *     assets/screens/     real screenshots copied from the analysis
 *     assets/music, sfx   audio copied locally (renderer serves from the project)
 *
 * The visual system comes from the analyzed product; motion comes from what
 * each screen contains; copy is limited to verified text.
 */

export interface CompositionInput {
  outputDir: string;
  compositionDir: string;
  dna: ProductDNA;
  storyboard: Storyboard;
  scenes: Scene[];
  music: MusicSelection | null;
  sfx: SfxSelection[];
  audioData: AudioData | null;
  reactive: "none" | "subtle" | "expressive";
  /** Screen id → { file, interactionFile? } lookups (paths relative to outputDir). */
  screenFiles: Map<string, { file: string; fullPageFile?: string; interactionFile?: string; width: number; height: number; fullHeight?: number; mobileFile?: string }>;
  /** Font files (absolute) discovered in the repo keyed by family name. */
  fontFiles: Array<{ family: string; file: string; weight?: string }>;
  hyperframesVersion: string;
}

interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

const WORDMARK_MAX = 30;

export async function buildComposition(input: CompositionInput): Promise<{ indexHtml: string; heroTime: number }> {
  const { compositionDir, dna, storyboard, scenes } = input;
  const vs = dna.visual_identity;
  await ensureDir(path.join(compositionDir, "assets", "screens"));

  // ---- Copy assets --------------------------------------------------------------
  const assetMap = new Map<string, string>(); // absolute/outputDir-relative source → composition-relative path
  const copyAsset = async (relToOutput: string | undefined, sub = "screens", uniqueTag?: string): Promise<string | undefined> => {
    if (!relToOutput) return undefined;
    const key = uniqueTag ? `${uniqueTag}:${relToOutput}` : relToOutput;
    if (assetMap.has(key)) return assetMap.get(key);
    const src = path.isAbsolute(relToOutput) ? relToOutput : path.join(input.outputDir, relToOutput);
    const base = path.basename(relToOutput);
    // A screenshot reused by two scenes gets a distinct file name so media discovery never sees duplicates.
    const dest = path.posix.join("assets", sub, uniqueTag && [...assetMap.keys()].some((k) => k.endsWith(relToOutput) && k !== key) ? base.replace(/(\.[a-z]+)$/i, `-${uniqueTag}$1`) : base);
    await copyFile(src, path.join(compositionDir, dest));
    assetMap.set(key, dest);
    return dest;
  };
  let musicPath: string | undefined;
  if (input.music) musicPath = await copyAsset(input.music.file, "music");
  const sfxPaths = new Map<string, string>();
  for (const s of input.sfx) {
    const dest = await copyAsset(sfxAssetPath(s.file), "sfx").catch(() => undefined);
    if (dest) sfxPaths.set(s.sceneId, dest);
  }
  const fontFaces: string[] = [];
  const fontFamilies = new Map<string, string>();
  for (const f of input.fontFiles.slice(0, 4)) {
    const dest = await copyAsset(f.file, "fonts").catch(() => undefined);
    if (!dest) continue;
    const fam = `HFL ${f.family}`;
    fontFaces.push(`@font-face{font-family:"${fam}";src:url("${dest}") format("${/\.woff2$/.test(dest) ? "woff2" : /\.woff$/.test(dest) ? "woff" : /\.otf$/.test(dest) ? "opentype" : "truetype"}");font-weight:${f.weight ?? "100 900"};font-display:block}`);
    fontFamilies.set(f.family.toLowerCase(), fam);
  }
  const displayStack = resolveStack(vs.typography.display, vs.typography.displayStack, fontFamilies);
  const bodyStack = resolveStack(vs.typography.body, vs.typography.bodyStack, fontFamilies);

  // ---- Palette ----------------------------------------------------------------------
  const p = palette(vs);
  const W = storyboard.width;
  const H = storyboard.height;
  const fmt = storyboard.format;
  const radius = Math.max(8, Math.min(28, Math.round(vs.borderRadius === "sharp" ? 6 : vs.borderRadius === "subtly rounded" ? 10 : vs.borderRadius === "rounded" ? 16 : 24)));
  const total = round2(scenes.reduce((a, s) => a + s.duration, 0));

  // ---- Scenes ------------------------------------------------------------------------
  const sceneHtml: string[] = [];
  const tl: string[] = [];
  let heroTime = 0;
  for (const scene of scenes) {
    const sf = scene.source ? input.screenFiles.get(scene.source) : undefined;
    const usesFull = scene.sourceKind === "full-page" && sf?.fullPageFile;
    const useMobile = fmt === "vertical" && sf?.mobileFile && scene.purpose !== "hook";
    const tag = `s${sceneHtml.length + 1}`;
    const imgRel = useMobile ? await copyAsset(sf!.mobileFile, "screens", tag) : usesFull ? await copyAsset(sf!.fullPageFile, "screens", tag) : await copyAsset(sf?.file, "screens", tag);
    const afterRel = scene.interaction && sf?.interactionFile ? await copyAsset(sf.interactionFile, "screens", tag) : undefined;
    const imgW = useMobile ? 390 : sf?.width ?? 1440;
    const imgH = useMobile ? (sf?.fullHeight && usesFull ? sf.fullHeight : 844) : usesFull ? sf!.fullHeight ?? 900 : sf?.height ?? 900;
    const geo = geometry(scene, fmt, W, H, imgW, imgH, !!useMobile);
    const s = sceneHtml.length + 1;
    const id = `s${s}`;
    const t0 = scene.start;
    const d = scene.duration;
    const tin = scene.transitionDuration;
    if (scene.purpose === "hero") heroTime = round2(t0 + Math.min(d - 0.4, Math.max(1.4, d * 0.55)));

    // --- markup
    const parts: string[] = [];
    parts.push(`<section id="${id}" class="clip scene scene-${scene.purpose}" data-start="${t0}" data-duration="${d}" data-track-index="${s}">`);
    parts.push(`<div id="${id}-stage" class="stage">`);
    if (imgRel && geo.shot) {
      const frameCls = useMobile ? "shot phone" : "shot";
      parts.push(`<div id="${id}-shot" class="${frameCls}" style="left:${geo.shot.x}px;top:${geo.shot.y}px;width:${geo.shot.w}px;height:${geo.shot.h}px">`);
      if (!useMobile) parts.push(`<div class="chrome"><span></span><span></span><span></span><i data-layout-ignore>${escapeHtml(routeLabel(scene, dna))}</i></div>`);
      parts.push(`<div id="${id}-cam" class="cam"><img id="${id}-img" class="ui" src="${imgRel}" alt="" />${afterRel ? `<img id="${id}-after" class="ui after" src="${afterRel}" alt="" />` : ""}</div>`);
      if (scene.purpose === "hook") parts.push(`<div class="dim"></div>`);
      if (afterRel) parts.push(`<div id="${id}-cursor" class="cursor"><b></b></div>`);
      parts.push(`</div>`);
    }
    if (geo.text) {
      const isHero = scene.purpose === "hero" || scene.purpose === "hook" || scene.purpose === "reveal" || scene.purpose === "cta";
      parts.push(`<div id="${id}-text" class="text ${isHero ? "big" : "label"} ${scene.purpose === "cta" ? "center" : ""}" style="left:${geo.text.x}px;top:${geo.text.y}px;width:${geo.text.w}px">`);
      const kicker = scene.purpose === "cta" ? (dna.stack.frontend[0] ?? dna.category) : scene.purpose === "reveal" ? dna.category : scene.purpose === "hook" ? scene.subtext ?? "" : "";
      if (kicker) parts.push(`<div id="${id}-kicker" class="kicker">${escapeHtml(kicker)}</div>`);
      parts.push(`<h1 id="${id}-h">${escapeHtml(scene.text)}</h1>`);
      if (scene.subtext && scene.purpose !== "hook") parts.push(`<p id="${id}-p">${escapeHtml(scene.subtext)}</p>`);
      if (scene.purpose === "cta") parts.push(`<div id="${id}-rule" class="rule"></div>`);
      parts.push(`</div>`);
    }
    parts.push(`</div></section>`);
    sceneHtml.push(parts.join("\n"));

    // --- timeline (global time)
    const stage = `#${id}-stage`;
    const shot = `#${id}-shot`;
    const cam = `#${id}-cam`;
    const text = `#${id}-text`;
    const settle = Math.min(0.9, Math.max(0.35, d * 0.18));
    // Transition in (never animate the .clip itself)
    switch (scene.transition) {
      case "crossfade":
        tl.push(`tl.fromTo("${stage}", {opacity:0}, {opacity:1, duration:${tin}, ease:"power2.out"}, ${t0});`);
        break;
      case "slide":
        tl.push(`tl.fromTo("${stage}", {opacity:0, x:${fmt === "vertical" ? 0 : 80}, y:${fmt === "vertical" ? 80 : 0}}, {opacity:1, x:0, y:0, duration:${tin}, ease:"power3.out"}, ${t0});`);
        break;
      case "push":
        tl.push(`tl.fromTo("${stage}", {opacity:0, scale:1.08}, {opacity:1, scale:1, duration:${tin}, ease:"power3.out"}, ${t0});`);
        break;
      case "wipe":
        tl.push(`tl.fromTo("${stage}", {clipPath:"inset(0 100% 0 0)"}, {clipPath:"inset(0 0% 0 0)", duration:${tin}, ease:"power3.inOut"}, ${t0});`);
        break;
      default:
        tl.push(`tl.set("${stage}", {opacity:1}, ${t0});`);
    }
    // Shot motion
    if (imgRel && geo.shot) {
      const camTween = cameraTween(scene, cam, shot, geo, imgW, imgH, useMobile ? 1 : geo.shot.w / imgW, t0, d, tin);
      tl.push(...camTween);
      tl.push(`tl.fromTo("${shot}", {y:${scene.purpose === "hook" ? 0 : 40}, opacity:${scene.transition === "cut" ? 1 : 0.001}}, {y:0, opacity:1, duration:${Math.max(0.4, tin + 0.2)}, ease:"power3.out"}, ${t0});`);
      if (afterRel) {
        const clickAt = round2(t0 + Math.max(0.9, d * 0.42));
        const target = { x: geo.shot.w * 0.5, y: geo.shot.h * 0.45 };
        tl.push(`tl.fromTo("#${id}-cursor", {x:${Math.round(geo.shot.w * 0.85)}, y:${Math.round(geo.shot.h * 0.9)}, opacity:0}, {x:${Math.round(target.x)}, y:${Math.round(target.y)}, opacity:1, duration:0.7, ease:"power2.inOut"}, ${round2(clickAt - 0.75)});`);
        tl.push(`tl.fromTo("#${id}-cursor b", {scale:0.6, opacity:0}, {scale:1.6, opacity:0.0, duration:0.35, ease:"power2.out"}, ${clickAt});`);
        tl.push(`tl.to("#${id}-cursor", {opacity:0, duration:0.3}, ${round2(clickAt + 0.4)});`);
        tl.push(`tl.fromTo("#${id}-after", {opacity:0}, {opacity:1, duration:0.35, ease:"power2.out"}, ${round2(clickAt + 0.05)});`);
      }
    }
    // Text entrance — fast in, then hold (readability rule)
    if (geo.text) {
      const tText = round2(t0 + (scene.purpose === "hook" ? 0.15 : tin * 0.6 + 0.1));
      tl.push(`tl.fromTo("#${id}-h", {y:28, opacity:0}, {y:0, opacity:1, duration:${settle}, ease:"power3.out"}, ${tText});`);
      if (scene.subtext && scene.purpose !== "hook") tl.push(`tl.fromTo("#${id}-p", {y:18, opacity:0}, {y:0, opacity:1, duration:${settle}, ease:"power3.out"}, ${round2(tText + 0.18)});`);
      if (scene.purpose === "reveal" || scene.purpose === "cta" || (scene.purpose === "hook" && scene.subtext)) tl.push(`tl.fromTo("#${id}-kicker", {y:10, opacity:0}, {y:0, opacity:1, duration:0.4, ease:"power2.out"}, ${round2(tText - 0.1)});`);
      if (scene.purpose === "cta") {
        tl.push(`tl.fromTo("#${id}-rule", {scaleX:0}, {scaleX:1, duration:0.7, ease:"power3.inOut"}, ${round2(tText + 0.35)});`);
        tl.push(`tl.fromTo("${text}", {scale:1}, {scale:1.02, duration:${Math.max(0.5, d - 1)}, ease:"sine.inOut"}, ${round2(t0 + 0.8)});`);
      }
      // Exit: fade text slightly before the clip ends so the last frame is clean (half-open window rule)
      if (scene.purpose !== "cta" && d > 2.2) tl.push(`tl.to("${text}", {opacity:0, y:-10, duration:0.25, ease:"power1.in"}, ${round2(t0 + d - 0.3)});`);
    }
  }

  // ---- Audio ---------------------------------------------------------------------------
  const audioHtml: string[] = [];
  if (musicPath && input.music) {
    const fadeIn = 0.8;
    const fadeOut = Math.min(2.2, total * 0.12);
    const lanes = JSON.stringify({ version: 1, lanes: [{ target: "volume", points: [{ t: 0, v: 0 }, { t: fadeIn, v: 1 }, { t: round2(total - fadeOut), v: 1 }, { t: total, v: 0 }] }] });
    audioHtml.push(`<audio id="music" data-timeline-role="music" src="${musicPath}" data-start="0" data-duration="${total}" data-track-index="8" data-volume="0.55" data-automation='${lanes}'></audio>`);
  }
  input.sfx.forEach((s, i) => {
    const p2 = sfxPaths.get(s.sceneId);
    if (!p2) return;
    audioHtml.push(`<audio id="sfx-${i + 1}" src="${p2}" data-start="${s.at}" data-duration="1.5" data-track-index="${9 + i}" data-volume="${s.volume}"></audio>`);
  });

  // ---- Audio-reactive glow ---------------------------------------------------------------
  const reactive: string[] = [];
  if (input.audioData && input.reactive !== "none") {
    const frames = input.audioData.frames.slice(0, Math.ceil(total * input.audioData.fps));
    const compact = frames.map((f) => [round2(f.rms), round2(f.bands[0] ?? 0), round2(f.bands[Math.min(5, f.bands.length - 1)] ?? 0)]);
    const amp = input.reactive === "expressive" ? 1 : 0.5;
    reactive.push(`var AUDIO = {fps:${input.audioData.fps}, frames:${JSON.stringify(compact)}};`);
    reactive.push(`var glow = document.getElementById("glow"); var glow2 = document.getElementById("glow2");`);
    reactive.push(`function drawAudio(f){ var rms=f[0], bass=f[1], hi=f[2]; gsap.set(glow, {opacity: ${0.22 * amp + 0.18} + rms*${0.28 * amp}, scale: 1 + bass*${0.08 * amp}}); gsap.set(glow2, {opacity: ${0.12 * amp + 0.08} + hi*${0.2 * amp}}); }`);
    reactive.push(`for (var f = 0; f < AUDIO.frames.length; f++) { tl.call((function(fr){ return function(){ drawAudio(fr); }; })(AUDIO.frames[f]), [], f / AUDIO.fps); }`);
  } else {
    reactive.push(`tl.fromTo("#glow", {opacity:0.3, scale:1}, {opacity:0.5, scale:1.06, duration:${Math.max(4, total / 2)}, ease:"sine.inOut", yoyo:true, repeat:1}, 0);`);
  }

  // ---- Styles -------------------------------------------------------------------------------
  const accentSoft = rgbaString(parseColor(p.accent)!, 0.55);
  const accentFaint = rgbaString(parseColor(p.accent)!, 0.22);
  const glowColor = `radial-gradient(closest-side, ${accentSoft}, transparent 72%)`;
  const shadow = vs.colors.mode === "dark" ? "0 40px 120px rgba(0,0,0,.55)" : "0 30px 90px rgba(15,23,42,.22)";
  const border = vs.colors.mode === "dark" ? "rgba(255,255,255,.12)" : "rgba(15,23,42,.10)";
  const big = fmt === "landscape" ? 92 : 78;
  const label = fmt === "landscape" ? 46 : 42;
  const css = `
  ${fontFaces.join("\n  ")}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:${p.background};color:${p.text};font-family:${bodyStack};-webkit-font-smoothing:antialiased}
  #root{position:relative;width:100%;height:100%;overflow:hidden;background:${p.background}}
  .bg{position:absolute;inset:0;background:${p.background};overflow:hidden}
  .bg .glow{position:absolute;left:${Math.round(W * 0.15)}px;top:${Math.round(H * -0.2)}px;width:${Math.round(W * 0.9)}px;height:${Math.round(H * 1.0)}px;background:${glowColor};filter:blur(40px);opacity:.55;will-change:transform,opacity}
  .bg .glow2{position:absolute;right:${Math.round(W * -0.1)}px;bottom:${Math.round(H * -0.25)}px;width:${Math.round(W * 0.6)}px;height:${Math.round(H * 0.7)}px;background:radial-gradient(closest-side, ${accentFaint}, transparent 70%);filter:blur(30px);opacity:.3}
  .bg .grid{position:absolute;inset:0;background-image:linear-gradient(${border} 1px, transparent 1px),linear-gradient(90deg, ${border} 1px, transparent 1px);background-size:96px 96px;opacity:.35;mask-image:radial-gradient(ellipse at 50% 40%, #000 30%, transparent 75%);-webkit-mask-image:radial-gradient(ellipse at 50% 40%, #000 30%, transparent 75%)}
  .scene{position:absolute;inset:0}
  .stage{position:absolute;inset:0;will-change:transform,opacity}
  .shot{position:absolute;border-radius:${radius}px;overflow:hidden;background:${p.surface};box-shadow:${shadow};border:1px solid ${border};display:block}
  .shot .chrome{position:absolute;left:0;top:0;right:0;height:40px;background:${mix(p.surface, p.background, 0.35)};border-bottom:1px solid ${border};display:flex;align-items:center;gap:8px;padding:0 16px;z-index:2}
  .shot .chrome span{width:11px;height:11px;border-radius:50%;background:${border}} .shot .chrome span:first-child{background:${p.accent}}
  .shot .chrome i{font-style:normal;font-size:15px;color:${p.mutedText};margin-left:10px;letter-spacing:.01em;font-family:${bodyStack}}
  .shot .cam{position:absolute;left:0;top:40px;right:0;bottom:0;overflow:hidden;will-change:transform}
  .shot.phone{border-radius:44px;border:10px solid ${vs.colors.mode === "dark" ? "#0a0a0a" : "#111"};background:#000}
  .shot.phone .cam{top:0}
  .shot .ui{display:block;width:100%;height:auto}
  .shot .ui.after{position:absolute;left:0;top:0;opacity:0}
  .shot .dim{position:absolute;inset:0;background:${rgbaString(parseColor(p.background)!, 0.55)}}
  .cursor{position:absolute;left:0;top:0;width:22px;height:22px;z-index:5;opacity:0;pointer-events:none}
  .cursor:before{content:"";position:absolute;left:0;top:0;border:11px solid transparent;border-top:18px solid ${p.text};border-left:11px solid ${p.text};transform:rotate(-8deg);filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))}
  .cursor b{position:absolute;left:-14px;top:-14px;width:44px;height:44px;border-radius:50%;border:3px solid ${p.accent};opacity:0;display:block}
  .text{position:absolute;display:block}
  .text.big h1{font-family:${displayStack};font-size:${big}px;line-height:1.02;letter-spacing:-.03em;font-weight:${weightFor(vs)};color:${p.text};text-wrap:balance}
  .text.label{padding:26px 34px;border-radius:${Math.max(10, radius)}px;background:${p.panel};border:1px solid ${border};box-shadow:${shadow}}
  .text.label h1{font-family:${displayStack};font-size:${label}px;line-height:1.1;letter-spacing:-.02em;font-weight:700;color:${p.panelText}}
  .text p{margin-top:18px;font-size:${fmt === "landscape" ? 30 : 30}px;line-height:1.3;color:${p.mutedText};max-width:100%}
  .text.label p{color:${p.panelMuted};font-size:26px;margin-top:12px}
  .text.center{text-align:center}
  .text .kicker{display:inline-block;font-size:19px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:${p.accentOn};background:${p.accent};padding:8px 14px;border-radius:999px;margin-bottom:22px}
  .text .rule{width:140px;height:6px;border-radius:3px;background:${p.accent};margin:34px auto 0;transform-origin:center}
  `;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <title>${escapeHtml(dna.name)} — launch video</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>${css}</style>
  </head>
  <body>
    <div id="root" data-composition-id="launch" data-start="0" data-duration="${total}" data-width="${W}" data-height="${H}" data-fps="${storyboard.fps}">
      <div class="bg" data-layout-allow-overflow><div id="glow" class="glow" data-layout-ignore></div><div id="glow2" class="glow2" data-layout-ignore></div><div class="grid" data-layout-ignore></div></div>
${sceneHtml.join("\n")}
${audioHtml.join("\n")}
    </div>
    <script>
      // Generated by Hyperframe Launch for "${escapeHtml(dna.name)}". Palette, type, radius and motion derive from the analyzed product.
      const tl = gsap.timeline({ paused: true });
${tl.map((l) => "      " + l).join("\n")}
      ${reactive.join("\n      ")}
      window.__timelines["launch"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
  await writeText(path.join(compositionDir, "index.html"), html);
  await writeText(path.join(compositionDir, "hyperframes.json"), JSON.stringify({ $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry", paths: { blocks: "compositions", components: "compositions/components", assets: "assets" }, media: { autoProxy: true } }, null, 2) + "\n");
  await writeText(path.join(compositionDir, "package.json"), JSON.stringify({ name: `${slug(dna.name)}-launch-video`, private: true, type: "module", scripts: { dev: `npx --yes hyperframes@${input.hyperframesVersion} preview`, check: `npx --yes hyperframes@${input.hyperframesVersion} check`, render: `npx --yes hyperframes@${input.hyperframesVersion} render` } }, null, 2) + "\n");
  await writeText(path.join(compositionDir, "meta.json"), JSON.stringify({ id: `${slug(dna.name)}-launch`, name: `${dna.name} launch video`, createdAt: new Date().toISOString(), generator: "hyperframe-launch" }, null, 2) + "\n");
  await fs.writeFile(path.join(compositionDir, ".gitignore"), "node_modules/\n.hyperframes/\nout/\n");
  return { indexHtml: html, heroTime: heroTime || round2(total * 0.6) };
}

function cameraTween(scene: Scene, cam: string, shot: string, geo: { shot?: Geometry }, imgW: number, imgH: number, scale: number, t0: number, d: number, tin: number): string[] {
  const out: string[] = [];
  const dur = round2(d - 0.05);
  const frameH = geo.shot!.h - 40;
  const renderedH = imgH * scale;
  const overflow = Math.max(0, renderedH - frameH);
  // One baseline `set` per element, then `to` tweens — keeps every seek deterministic (lint: gsap_repeated_fromto_without_baseline).
  const base = (vars: string) => out.push(`tl.set("${cam}", {${vars}}, ${t0});`);
  const to = (vars: string, at: number) => out.push(`tl.to("${cam}", {${vars}}, ${at});`);
  const revealAt = round2(t0 + tin * 0.5);
  switch (scene.motion) {
    case "slow-push":
      base("scale:1, x:0, y:0");
      to(`scale:1.06, duration:${dur}, ease:"none"`, t0);
      break;
    case "parallax-drift":
      base("scale:1.04, x:-10, y:0");
      to(`x:10, y:-6, duration:${dur}, ease:"sine.inOut"`, t0);
      break;
    case "pan-vertical":
    case "device-scroll": {
      const travel = Math.min(overflow, frameH * 1.6);
      base("scale:1, x:0, y:0");
      if (travel > 8) {
        out.push(`tl.set("${cam} .ui", {y:0}, ${t0});`);
        out.push(`tl.to("${cam} .ui", {y:${-Math.round(travel)}, duration:${round2(dur - Math.min(0.4, tin))}, ease:"power1.inOut"}, ${round2(t0 + Math.min(0.4, tin))});`);
      } else to(`scale:1.05, duration:${dur}, ease:"none"`, t0);
      break;
    }
    case "pan-horizontal":
      base("scale:1.08, x:20, y:0");
      to(`x:-20, duration:${dur}, ease:"sine.inOut"`, t0);
      break;
    case "row-reveal":
      base('clipPath:"inset(0 0 100% 0)", scale:1');
      to(`clipPath:"inset(0 0 0% 0)", duration:${Math.min(1.4, d * 0.5)}, ease:"power2.out"`, revealAt);
      to(`scale:1.04, duration:${dur}, ease:"none"`, t0);
      break;
    case "card-stagger":
      base('clipPath:"inset(0 100% 0 0)", scale:1.02, y:0');
      to(`clipPath:"inset(0 0% 0 0)", duration:${Math.min(1.2, d * 0.45)}, ease:"power3.out"`, revealAt);
      to(`y:-14, duration:${dur}, ease:"sine.inOut"`, t0);
      break;
    case "focus-zoom":
      base('scale:1, transformOrigin:"60% 40%"');
      to(`scale:1.14, duration:${dur}, ease:"power1.inOut"`, t0);
      break;
    case "chart-reveal":
      base('clipPath:"inset(0 100% 0 0)", scale:1, transformOrigin:"55% 45%"');
      to(`clipPath:"inset(0 0% 0 0)", duration:${Math.min(1.5, d * 0.5)}, ease:"power3.inOut"`, revealAt);
      to(`scale:1.08, duration:${dur}, ease:"none"`, t0);
      break;
    case "type-on":
      base('clipPath:"inset(0 0 100% 0)", scale:1');
      to(`clipPath:"inset(0 0 0% 0)", duration:${Math.min(1.8, d * 0.6)}, ease:"power1.inOut"`, revealAt);
      to(`scale:1.03, duration:${dur}, ease:"none"`, t0);
      break;
    default:
      base("scale:1");
      to(`scale:1.02, duration:${dur}, ease:"none"`, t0);
  }
  void shot;
  return out;
}

/** Layout geometry per scene purpose and format. Keeps the UI readable and leaves a clear area for text. */
function geometry(scene: Scene, fmt: Storyboard["format"], W: number, H: number, imgW: number, imgH: number, mobile: boolean): { shot?: Geometry; text?: Geometry } {
  const fit = (w: number, extraH = 40): Geometry => ({ x: 0, y: 0, w, h: Math.round((w / imgW) * Math.min(imgH, mobile ? 844 : 900)) + extraH });
  const textOnly = !scene.source;
  if (fmt === "landscape") {
    switch (scene.purpose) {
      case "hook": {
        const s = fit(W + 120);
        return { shot: textOnly ? undefined : { ...s, x: -60, y: 60 }, text: { x: 140, y: Math.round(H * 0.36), w: 1240, h: 0 } };
      }
      case "reveal": {
        const s = fit(1380);
        return { shot: textOnly ? undefined : { ...s, x: 460, y: 360 }, text: { x: 120, y: 110, w: 1100, h: 0 } };
      }
      case "hero": {
        const s = fit(1680);
        return { shot: { ...s, x: 120, y: 170 }, text: { x: 120, y: 44, w: 1400, h: 0 } };
      }
      case "cta":
        return { text: { x: 260, y: Math.round(H * 0.34), w: 1400, h: 0 } };
      default: {
        const s = fit(1500);
        return { shot: textOnly ? undefined : { ...s, x: 380, y: 90 }, text: { x: 70, y: Math.round(H * 0.6), w: 600, h: 0 } };
      }
    }
  }
  if (fmt === "vertical") {
    const shotW = mobile ? 640 : 980;
    const shotH = mobile ? 1380 : fit(shotW).h;
    switch (scene.purpose) {
      case "hook":
        return { shot: textOnly ? undefined : { x: (W - shotW) / 2, y: 720, w: shotW, h: shotH }, text: { x: 90, y: 260, w: 900, h: 0 } };
      case "cta":
        return { text: { x: 90, y: Math.round(H * 0.38), w: 900, h: 0 } };
      case "hero":
        return { shot: { x: (W - shotW) / 2, y: 420, w: shotW, h: Math.min(shotH, 1380) }, text: { x: 90, y: 150, w: 900, h: 0 } };
      default:
        return { shot: textOnly ? undefined : { x: (W - shotW) / 2, y: 520, w: shotW, h: Math.min(shotH, 1250) }, text: { x: 90, y: 170, w: 900, h: 0 } };
    }
  }
  // square
  const shotW = 940;
  const s = fit(shotW);
  switch (scene.purpose) {
    case "hook":
      return { shot: textOnly ? undefined : { ...s, x: 70, y: 520 }, text: { x: 70, y: 120, w: 940, h: 0 } };
    case "cta":
      return { text: { x: 90, y: 400, w: 900, h: 0 } };
    case "hero":
      return { shot: { ...s, x: 70, y: 300 }, text: { x: 70, y: 80, w: 940, h: 0 } };
    default:
      return { shot: textOnly ? undefined : { ...s, x: 70, y: 380 }, text: { x: 70, y: 90, w: 940, h: 0 } };
  }
}

function palette(vs: ProductDNA["visual_identity"]) {
  const background = vs.colors.background;
  const surface = vs.colors.surface;
  const accent = vs.colors.accent;
  const text = ensureContrast(vs.colors.text, background, 7);
  const mutedText = ensureContrast(vs.colors.mutedText, background, 7);
  // Opaque panel for labels over screenshots — guarantees WCAG contrast in the audit.
  const panel = isDark(background) ? mix(surface, "#000000", 0.25) : mix(surface, "#ffffff", 0.5);
  const panelText = ensureContrast(text, panel, 7);
  const panelMuted = ensureContrast(mutedText, panel, 4.5);
  const accentOn = ensureContrast(readableTextOn(accent), accent, 4.5);
  return { background, surface, accent, text, mutedText, panel, panelText, panelMuted, accentOn };
}

function weightFor(vs: ProductDNA["visual_identity"]): number {
  const w = vs.typography.weights.map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n));
  const heavy = w.some((n) => n >= 700);
  return heavy ? 800 : 700;
}

function resolveStack(family: string, fallbackStack: string, shipped: Map<string, string>): string {
  const local = shipped.get(family.toLowerCase());
  return local ? `"${local}", ${fallbackStack}` : fallbackStack;
}

function routeLabel(scene: Scene, dna: ProductDNA): string {
  const screen = dna.screens.find((s) => s.id === scene.source);
  if (!screen) return dna.name.toLowerCase().replace(/\s+/g, "");
  if (screen.id.startsWith("source-")) return screen.route;
  const host = dna.name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, WORDMARK_MAX) || "app";
  return `${host}.app${screen.route}`;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type { VisualSystem };
