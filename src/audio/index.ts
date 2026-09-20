import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import type { MusicSelection, Scene, SfxSelection, Storyboard, TonePreset } from "../types.js";
import { exec, hasCommand } from "../shared/exec.js";
import { exists, readJson } from "../shared/fs.js";

/**
 * Audio: music selection, beat/cue analysis, SFX placement, and audio-reactive
 * band extraction. Everything runs in Node with ffmpeg — no Python required.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Works from both `src/` (tsx) and `dist/` (compiled). */
export const ASSETS_DIR = path.resolve(HERE, "..", "..", "assets");

interface Track {
  file: string;
  title: string;
  moods: TonePreset[];
  license: string;
}

const TRACKS: Track[] = [
  { file: "happy-beats-business-moves-vol-1-by-ende-dot-app.mp3", title: "Happy Beats / Business Moves vol. 1", moods: ["polished", "app-store", "playful"], license: "ende.app Happy Beats series — verify terms before redistribution" },
  { file: "happy-beats-business-moves-vol-9-by-ende-dot-app.mp3", title: "Happy Beats / Business Moves vol. 9", moods: ["technical", "polished", "minimal"], license: "ende.app Happy Beats series — verify terms before redistribution" },
  { file: "happy-beats-business-moves-vol-10-by-ende-dot-app.mp3", title: "Happy Beats / Business Moves vol. 10", moods: ["cinematic", "minimal"], license: "ende.app Happy Beats series — verify terms before redistribution" },
  { file: "happy-beats-business-moves-vol-11-by-ende-dot-app.mp3", title: "Happy Beats / Business Moves vol. 11", moods: ["bold", "playful", "technical"], license: "ende.app Happy Beats series — verify terms before redistribution" },
  { file: "happy-beats-business-moves-vol-12-by-ende-dot-app.mp3", title: "Happy Beats / Business Moves vol. 12", moods: ["cinematic", "polished", "bold"], license: "ende.app Happy Beats series — verify terms before redistribution" },
];

export async function selectMusic(tone: TonePreset, durationSec: number, override?: string): Promise<MusicSelection | null> {
  let track: Track | undefined;
  let file: string;
  if (override) {
    file = path.resolve(override);
    if (!exists(file)) return null;
    track = { file: path.basename(file), title: path.basename(file), moods: [], license: "user-supplied" };
  } else {
    track = TRACKS.find((t) => t.moods[0] === tone) ?? TRACKS.find((t) => t.moods.includes(tone)) ?? TRACKS[0];
    file = path.join(ASSETS_DIR, "music", track.file);
    if (!exists(file)) return null;
  }
  const preset = await readJson<{ tempo?: number; duration?: number; beats?: Array<{ time: number; intensity: number }>; strongCues?: Array<{ time: number; intensity: number }> }>(path.join(ASSETS_DIR, "music", "cues", track.file.replace(/\.mp3$/, ".music-cues.json")));
  if (preset?.beats?.length) {
    return {
      file,
      title: track.title,
      bpm: preset.tempo,
      beats: preset.beats.map((b) => b.time).filter((t) => t <= durationSec + 1),
      strongCues: (preset.strongCues ?? []).map((c) => c.time).filter((t) => t <= durationSec + 1),
      cueSource: "preset",
      license: track.license,
      durationSec: preset.duration,
    };
  }
  const analysis = await analyzeBeats(file, durationSec + 1);
  return { file, title: track.title, bpm: analysis?.bpm, beats: analysis?.beats ?? [], strongCues: analysis?.strongCues ?? [], cueSource: analysis ? "analysis" : "none", license: track.license, durationSec: analysis?.durationSec };
}

// ---------------------------------------------------------------------------
// PCM decoding via ffmpeg
// ---------------------------------------------------------------------------

async function decodePcm(file: string, seconds: number, sampleRate = 22050): Promise<Float32Array | null> {
  if (!(await hasCommand("ffmpeg"))) return null;
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.pcm`);
  const res = await exec("ffmpeg", ["-v", "error", "-y", "-i", file, "-t", String(seconds), "-ac", "1", "-ar", String(sampleRate), "-f", "f32le", tmp], { timeoutMs: 60_000, inheritEnv: true });
  if (res.code !== 0) return null;
  try {
    const buf = await fs.readFile(tmp);
    await fs.rm(tmp, { force: true });
    return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  } catch {
    return null;
  }
}

/** Energy-based onset detection → beat grid + strong cues. Deterministic. */
export async function analyzeBeats(file: string, seconds: number): Promise<{ bpm: number; beats: number[]; strongCues: number[]; durationSec: number } | null> {
  const sr = 22050;
  const pcm = await decodePcm(file, seconds, sr);
  if (!pcm || pcm.length < sr) return null;
  const hop = 512;
  const frames = Math.floor(pcm.length / hop);
  const energy = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let e = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) e += pcm[j] * pcm[j];
    energy[i] = Math.sqrt(e / hop);
  }
  // Onset strength: positive energy difference, normalized.
  const onset = new Float32Array(frames);
  for (let i = 1; i < frames; i++) onset[i] = Math.max(0, energy[i] - energy[i - 1]);
  const max = Math.max(...onset) || 1;
  for (let i = 0; i < frames; i++) onset[i] /= max;
  // Adaptive threshold peak picking.
  const win = 16;
  const peaks: Array<{ t: number; v: number }> = [];
  for (let i = 2; i < frames - 2; i++) {
    let mean = 0;
    let n = 0;
    for (let k = Math.max(0, i - win); k < Math.min(frames, i + win); k++) {
      mean += onset[k];
      n++;
    }
    mean /= n;
    if (onset[i] > mean * 1.8 + 0.04 && onset[i] >= onset[i - 1] && onset[i] >= onset[i + 1] && onset[i] > onset[i - 2] && onset[i] > onset[i + 2]) {
      const t = (i * hop) / sr;
      if (!peaks.length || t - peaks[peaks.length - 1].t > 0.18) peaks.push({ t, v: onset[i] });
    }
  }
  // Tempo estimate from inter-onset intervals.
  const intervals: number[] = [];
  for (let i = 1; i < peaks.length; i++) intervals.push(peaks[i].t - peaks[i - 1].t);
  const bpm = estimateBpm(intervals);
  // Beat grid: snap a regular grid to onsets.
  const period = 60 / bpm;
  const beats: number[] = [];
  let anchor = peaks.length ? peaks.reduce((a, b) => (b.v > a.v ? b : a)).t : 0;
  while (anchor - period > 0) anchor -= period;
  for (let t = anchor; t < seconds; t += period) {
    const near = peaks.find((p) => Math.abs(p.t - t) < period * 0.2);
    beats.push(Math.round((near ? near.t : t) * 1000) / 1000);
  }
  const strong = [...peaks].sort((a, b) => b.v - a.v).slice(0, Math.max(3, Math.floor(seconds / 3))).map((p) => Math.round(p.t * 1000) / 1000).sort((a, b) => a - b);
  return { bpm: Math.round(bpm * 100) / 100, beats, strongCues: strong, durationSec: pcm.length / sr };
}

function estimateBpm(intervals: number[]): number {
  if (!intervals.length) return 120;
  // Histogram of intervals folded into the 0.3–1.0s range (60–200 BPM).
  const hist = new Map<number, number>();
  for (let iv of intervals) {
    while (iv < 0.3) iv *= 2;
    while (iv > 1.0) iv /= 2;
    const key = Math.round(iv * 40) / 40;
    hist.set(key, (hist.get(key) ?? 0) + 1);
  }
  let best = 0.5;
  let bestN = -1;
  for (const [k, n] of hist) if (n > bestN) (best = k), (bestN = n);
  return 60 / best;
}

// ---------------------------------------------------------------------------
// Audio-reactive bands
// ---------------------------------------------------------------------------

export interface AudioData {
  fps: number;
  totalFrames: number;
  frames: Array<{ bands: number[]; rms: number }>;
}

/** Per-frame RMS + frequency bands (0 = bass) for subtle audio-reactive motion. */
export async function extractAudioData(file: string, seconds: number, fps = 30, bandCount = 8): Promise<AudioData | null> {
  const sr = 22050;
  const pcm = await decodePcm(file, seconds, sr);
  if (!pcm) return null;
  const N = 2048;
  const totalFrames = Math.ceil(seconds * fps);
  const frames: AudioData["frames"] = [];
  const window = new Float32Array(N);
  for (let i = 0; i < N; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const edges = bandEdges(bandCount, 40, 11000, sr, N);
  const raw: number[][] = [];
  const rmsRaw: number[] = [];
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let f = 0; f < totalFrames; f++) {
    const center = Math.floor((f / fps) * sr);
    const start = Math.max(0, center - N / 2);
    let rms = 0;
    for (let i = 0; i < N; i++) {
      const s = start + i < pcm.length ? pcm[start + i] : 0;
      re[i] = s * window[i];
      im[i] = 0;
      rms += s * s;
    }
    rmsRaw.push(Math.sqrt(rms / N));
    fft(re, im);
    const bands: number[] = [];
    for (let b = 0; b < bandCount; b++) {
      let sum = 0;
      let n = 0;
      for (let k = edges[b]; k < edges[b + 1]; k++) {
        sum += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        n++;
      }
      bands.push(n ? sum / n : 0);
    }
    raw.push(bands);
  }
  // Normalize each band independently, then smooth slightly.
  const maxes = new Array(bandCount).fill(1e-9);
  for (const b of raw) for (let i = 0; i < bandCount; i++) maxes[i] = Math.max(maxes[i], b[i]);
  const rmsMax = Math.max(1e-9, ...rmsRaw);
  for (let f = 0; f < raw.length; f++) {
    const bands = raw[f].map((v, i) => Math.min(1, v / maxes[i]));
    const prev = frames[f - 1]?.bands;
    frames.push({ bands: bands.map((v, i) => round3(prev ? prev[i] * 0.4 + v * 0.6 : v)), rms: round3(rmsRaw[f] / rmsMax) });
  }
  return { fps, totalFrames, frames };
}

function bandEdges(count: number, fmin: number, fmax: number, sr: number, N: number): number[] {
  const edges: number[] = [];
  for (let i = 0; i <= count; i++) {
    const f = fmin * Math.pow(fmax / fmin, i / count);
    edges.push(Math.max(1, Math.min(N / 2 - 1, Math.round((f / sr) * N))));
  }
  return edges;
}

/** In-place iterative radix-2 FFT. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Beat alignment + SFX placement
// ---------------------------------------------------------------------------

/**
 * Nudge scene starts toward musical cues: major (beat-locked) scenes move up to
 * ±0.15s toward a strong cue, other scene changes up to ±0.10s toward a beat.
 * Readability always wins: a scene is never shortened below its reading floor.
 */
export function alignScenesToMusic(storyboard: Storyboard, music: MusicSelection | null): { scenes: Scene[]; locks: Array<{ sceneId: string; from: number; to: number; kind: "strong" | "beat" }> } {
  const scenes = storyboard.scenes.map((s) => ({ ...s }));
  const locks: Array<{ sceneId: string; from: number; to: number; kind: "strong" | "beat" }> = [];
  if (!music || (!music.beats.length && !music.strongCues.length)) return { scenes, locks };
  let strongLocks = 0;
  for (let i = 1; i < scenes.length; i++) {
    const s = scenes[i];
    const prev = scenes[i - 1];
    const wantStrong = s.audio.beatLock && strongLocks < 3;
    const pool = wantStrong && music.strongCues.length ? music.strongCues : music.beats;
    const tolerance = wantStrong ? 0.15 : 0.1;
    const nearest = pool.reduce<number | null>((best, t) => (best === null || Math.abs(t - s.start) < Math.abs(best - s.start) ? t : best), null);
    if (nearest === null) continue;
    const delta = round2(nearest - s.start);
    if (Math.abs(delta) > tolerance || delta === 0) continue;
    // Keep the previous scene long enough for its text and never below 1.6s.
    const minPrev = Math.max(1.6, readingFloor(prev));
    if (prev.duration + delta < minPrev) continue;
    prev.duration = round2(prev.duration + delta);
    s.start = round2(s.start + delta);
    s.duration = round2(s.duration - delta);
    if (s.duration < 1.6) {
      // Undo if this scene became too short.
      prev.duration = round2(prev.duration - delta);
      s.start = round2(s.start - delta);
      s.duration = round2(s.duration + delta);
      continue;
    }
    locks.push({ sceneId: s.id, from: round2(s.start - delta), to: s.start, kind: wantStrong ? "strong" : "beat" });
    if (wantStrong) strongLocks++;
  }
  return { scenes, locks };
}

function readingFloor(s: Scene): number {
  const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
  const need = (t: string) => (words(t) <= 3 ? 0.8 : Math.max(1.2, words(t) * 0.3));
  return need(s.text) + (s.subtext ? need(s.subtext) : 0) + 0.5;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function placeSfx(scenes: Scene[], enabled: boolean): SfxSelection[] {
  if (!enabled) return [];
  const out: SfxSelection[] = [];
  for (const s of scenes) {
    if (!s.audio.sfx) continue;
    const file = path.join(ASSETS_DIR, "sfx", s.audio.sfx);
    if (!exists(file)) continue;
    // Fire with the visual: at scene start plus the transition-in time (the element's first visible frame).
    const at = round2(s.start + Math.min(0.1, s.transitionDuration * 0.2));
    const volume = s.purpose === "hero" ? 0.7 : s.purpose === "cta" ? 0.6 : 0.45;
    out.push({ sceneId: s.id, file: s.audio.sfx, at, volume, reason: `${s.purpose} — ${s.audio.intent}` });
  }
  // Restraint: never more than 5 SFX in a 30s film, and no two within 1.2s.
  const spaced: SfxSelection[] = [];
  for (const sfx of out) if (!spaced.length || sfx.at - spaced[spaced.length - 1].at >= 1.2) spaced.push(sfx);
  return spaced.slice(0, 5);
}

export function sfxAssetPath(rel: string): string {
  return path.join(ASSETS_DIR, "sfx", rel);
}
