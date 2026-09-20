/**
 * Shared types for the Hyperframe Launch pipeline.
 *
 * Every stage writes one of these structures to `launch-output/` so that the
 * artifacts are the contract between modules: a module can be replaced as long
 * as it produces the same JSON.
 */

export type VideoFormat = "landscape" | "vertical" | "square";
export type RenderQuality = "draft" | "looks" | "delivery";

export type Platform =
  | "linkedin"
  | "x"
  | "instagram-reel"
  | "youtube-short"
  | "product-hunt"
  | "generic";

export interface LaunchOptions {
  /** GitHub URL, git URL, or local directory path. */
  repositoryUrl: string;
  branch?: string;
  /** Target seconds, 15–30. Default 24. */
  duration: number;
  format: VideoFormat;
  /** Tone preset or freeform creative direction. */
  tone: string;
  voice: boolean;
  music: boolean;
  sfx: boolean;
  platform: Platform;
  style?: string;
  targetAudience?: string;
  /** Output directory (default `launch-output/`, timestamped if it exists). */
  outputDir?: string;
  /** Where repositories get cloned / installed. Default: OS temp dir. */
  workspaceDir?: string;
  /** Attempt to run the application and explore it in a browser. */
  run: boolean;
  /** Allow dependency installation (npm/pnpm/yarn/pip). Scripts are never executed during install. */
  install: boolean;
  /** Attempt a Hyperframes render at the end. */
  render: boolean;
  quality: RenderQuality;
  /** Maximum number of routes to screenshot. */
  maxScreens: number;
  /** Timeouts in ms. */
  timeouts: {
    install: number;
    startup: number;
    navigation: number;
    render: number;
  };
  /** Extra env passed to the launched app (never forwarded from the host env). */
  appEnv?: Record<string, string>;
  /** Name/tagline overrides. */
  title?: string;
  verbose?: boolean;
}

export type ProgressStatus = "start" | "done" | "skip" | "warn" | "fail";
export interface ProgressEvent {
  step: string;
  status: ProgressStatus;
  message: string;
  detail?: string;
}
export type ProgressReporter = (event: ProgressEvent) => void;

// ---------------------------------------------------------------------------
// Repository analysis
// ---------------------------------------------------------------------------

export interface Evidence {
  file: string;
  line?: number;
  snippet?: string;
}

export interface Feature {
  id: string;
  name: string;
  description: string;
  evidence: string[];
  confidence: number;
  /** Where the evidence came from. */
  sources: Array<"route" | "component" | "readme" | "dependency" | "backend" | "runtime">;
  keywords: string[];
  /** Route associated with the feature when known. */
  route?: string;
}

export interface StaticRoute {
  path: string;
  file: string;
  kind: "page" | "api" | "layout";
  framework: string;
  /** Route requires a dynamic parameter. */
  dynamic: boolean;
}

export interface AppCandidate {
  id: string;
  /** Path relative to repository root. */
  dir: string;
  kind: "frontend" | "backend" | "fullstack" | "static" | "library" | "cli" | "unknown";
  frameworks: string[];
  packageManager?: "npm" | "pnpm" | "yarn" | "bun" | "pip" | "poetry" | "uv" | "maven" | "gradle" | "go" | "cargo";
  /** Scripts declared by the app (package.json scripts, etc.). */
  scripts: Record<string, string>;
  /** Detected dev/start command (argv form) or null. */
  runCommand: RunCommand | null;
  score: number;
  reasons: string[];
}

export interface RunCommand {
  cmd: string;
  args: string[];
  cwd: string;
  /** Expected port, when it can be inferred. */
  port?: number;
  /** How the command was chosen. */
  reason: string;
  /** Optional install step run before the command. */
  install?: { cmd: string; args: string[]; cwd: string; reason: string };
  /** Env for the app; only safe, known keys. */
  env?: Record<string, string>;
  /** URL path to open first. */
  openPath?: string;
}

export interface DesignTokens {
  colors: Record<string, string>;
  fonts: string[];
  radii: string[];
  /** Raw CSS custom properties found. */
  customProperties: Record<string, string>;
  tailwind?: { darkMode?: string; themeColors: Record<string, string> };
  source: string[];
}

export interface ReadmeSummary {
  title?: string;
  tagline?: string;
  description?: string;
  featureBullets: string[];
  headings: string[];
  badges: string[];
  /** Numbers / claims that look like metrics. */
  metricClaims: string[];
  installCommands: string[];
  usageCommands: string[];
  screenshots: string[];
}

export interface RepositoryAnalysis {
  source: {
    url: string;
    branch?: string;
    commit?: string;
    localPath: string;
    clonedAt: string;
  };
  name: string;
  description: string;
  languages: Record<string, number>;
  fileCount: number;
  readme: ReadmeSummary;
  frameworks: {
    frontend: string[];
    backend: string[];
    database: string[];
    tooling: string[];
    ai: string[];
  };
  dependencies: string[];
  apps: AppCandidate[];
  primaryApp: AppCandidate | null;
  routes: StaticRoute[];
  features: Feature[];
  designTokens: DesignTokens;
  brandAssets: string[];
  secrets: {
    redactedFiles: string[];
    redactedValues: number;
  };
  importantFiles: string[];
  license?: string;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Runtime + browser exploration
// ---------------------------------------------------------------------------

export interface DomElementSummary {
  tag: string;
  text: string;
  role?: string;
  href?: string;
}

export interface DomSummary {
  title: string;
  headings: string[];
  buttons: string[];
  links: Array<{ text: string; href: string }>;
  navItems: string[];
  forms: number;
  inputs: number;
  tables: number;
  charts: number;
  images: number;
  cards: number;
  hasSidebar: boolean;
  hasNavbar: boolean;
  hasDialog: boolean;
  tabs: number;
  badges: number;
  textLength: number;
  /** Detected login/auth form. */
  authWall: boolean;
  bodyBackground: string;
  bodyColor: string;
  /** Page content wider than the viewport (layout does not adapt to this width). */
  overflowsViewport: boolean;
}

export interface StyleSample {
  backgrounds: Record<string, number>;
  textColors: Record<string, number>;
  fontFamilies: Record<string, number>;
  fontSizes: Record<string, number>;
  fontWeights: Record<string, number>;
  borderRadii: Record<string, number>;
  shadows: Record<string, number>;
  gradients: string[];
  backdropFilters: number;
  iconCount: number;
  monospaceUsage: number;
}

export interface Screen {
  id: string;
  route: string;
  url: string;
  title: string;
  /** Path (relative to output dir) of the viewport screenshot. */
  file: string;
  /** Full-page screenshot when the page scrolls, relative to output dir. */
  fullPageFile?: string;
  fullPageHeight?: number;
  viewport: { width: number; height: number };
  dom: DomSummary;
  styles: StyleSample;
  components: string[];
  /** 0–1 visual richness. */
  richness: number;
  /** 0–1 product importance. */
  importance: number;
  score: number;
  discoveredVia: "static-route" | "link" | "nav" | "entry";
  captureMs: number;
  /** Interaction captured after clicking / opening something. */
  interaction?: { action: string; target: string; file: string };
}

export interface UserFlow {
  id: string;
  name: string;
  steps: Array<{ screenId: string; label: string; action?: string }>;
  score: number;
  rationale: string[];
}

export interface RuntimeAnalysis {
  status: "ok" | "runtime_unavailable" | "skipped";
  reason?: string;
  app?: AppCandidate;
  command?: RunCommand;
  url?: string;
  startupMs?: number;
  installMs?: number;
  screens: Screen[];
  flows: UserFlow[];
  logExcerpt: string[];
  /** Screenshots generated from source (code cards) when the app could not run. */
  sourceDerived: Array<{ id: string; file: string; title: string; sourceFile: string }>;
  mobileScreens?: Screen[];
}

// ---------------------------------------------------------------------------
// UI/UX analysis
// ---------------------------------------------------------------------------

export interface VisualSystem {
  colors: {
    background: string;
    surface: string;
    text: string;
    mutedText: string;
    accent: string;
    accentText: string;
    palette: string[];
    gradients: string[];
    mode: "dark" | "light";
  };
  typography: {
    display: string;
    body: string;
    mono?: string;
    families: string[];
    sizes: string[];
    weights: string[];
    displayStack: string;
    bodyStack: string;
  };
  borderRadius: string;
  radiiPx: number;
  shadows: string[];
  glass: boolean;
  spacingScale: "tight" | "regular" | "airy";
  iconStyle?: string;
}

export interface UIAnalysis {
  status: "runtime" | "static" | "none";
  visualSystem: VisualSystem;
  components: Record<string, number>;
  designLanguage: string[];
  designConfidence: number;
  layout: "dashboard" | "landing" | "app" | "docs" | "content" | "tool" | "unknown";
  perScreen: Array<{ screenId: string; components: string[]; dominantColors: string[] }>;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Product DNA + claims + story
// ---------------------------------------------------------------------------

export interface Claim {
  id: string;
  claim: string;
  verified: boolean;
  evidence: string[];
  reason: string;
  kind: "feature" | "metric" | "tagline" | "capability" | "stack";
  origin: "readme" | "feature" | "runtime" | "package";
}

export interface ProductDNA {
  name: string;
  category: string;
  description: string;
  tagline: string;
  value_proposition: string;
  audience: string;
  stack: { frontend: string[]; backend: string[]; database: string[]; ai: string[] };
  verified_features: Feature[];
  screens: Array<{
    id: string;
    route: string;
    title: string;
    file: string;
    fullPageFile?: string;
    components: string[];
    score: number;
    purposeHint: string;
    /** First visible heading rendered on the screen (real product copy). */
    headline?: string;
    /** Up to three visible headings, in page order. */
    headlines?: string[];
  }>;
  user_flows: UserFlow[];
  visual_identity: {
    colors: VisualSystem["colors"];
    typography: VisualSystem["typography"];
    style: string;
    designLanguage: string[];
    borderRadius: string;
    glass: boolean;
  };
  brand_assets: string[];
  /** SPDX-ish license name when a LICENSE file exists. */
  license?: string;
  verified_claims: Claim[];
  unsupported_claims: Claim[];
  runtime: { status: RuntimeAnalysis["status"]; reason?: string; screenCount: number };
  generatedAt: string;
}

export interface StoryPlan {
  productName: string;
  whatIsIt: string;
  whatMakesItInteresting: string;
  strongestAngle: string;
  hook: { text: string; sub?: string; rationale: string };
  uiMoments: Array<{ screenId: string; why: string }>;
  cta: { text: string; sub?: string };
  tone: { preset: TonePreset; direction: string; interpretation: string };
  audio: {
    role: string;
    music: boolean;
    sfx: boolean;
    reactive: "none" | "subtle" | "expressive";
    restraint: string;
  };
  shareLine: string;
  audience: string;
}

export type TonePreset =
  | "polished"
  | "cinematic"
  | "minimal"
  | "playful"
  | "technical"
  | "app-store"
  | "bold";

export type ScenePurpose =
  | "hook"
  | "reveal"
  | "workflow"
  | "feature"
  | "hero"
  | "cta";

export type MotionPreset =
  | "slow-push"
  | "parallax-drift"
  | "pan-vertical"
  | "pan-horizontal"
  | "row-reveal"
  | "card-stagger"
  | "focus-zoom"
  | "device-scroll"
  | "chart-reveal"
  | "hold"
  | "type-on";

export interface Scene {
  scene: number;
  id: string;
  start: number;
  duration: number;
  purpose: ScenePurpose;
  /** Screenshot asset id (from DNA screens) or null for text-only scenes. */
  source: string | null;
  sourceFile?: string;
  sourceKind: "screenshot" | "full-page" | "source-card" | "text" | "brand";
  text: string;
  subtext?: string;
  /** Text lines that must appear verbatim (verified). */
  verifiedCopy: string[];
  motion: MotionPreset;
  motionNotes: string;
  /** Optional focus rectangle in screenshot pixel space. */
  focus?: { x: number; y: number; w: number; h: number };
  transition: "cut" | "crossfade" | "slide" | "wipe" | "push";
  transitionDuration: number;
  audio: { sfx?: string; intent: string; beatLock?: boolean };
  /** Simulated interaction, e.g. cursor click on a nav item. */
  interaction?: { kind: "click" | "scroll" | "type" | "hover"; target: string };
}

export interface Storyboard {
  duration: number;
  format: VideoFormat;
  width: number;
  height: number;
  fps: number;
  tone: TonePreset;
  scenes: Scene[];
  music?: MusicSelection;
  notes: string[];
}

export interface MusicSelection {
  file: string;
  title: string;
  bpm?: number;
  strongCues: number[];
  beats: number[];
  cueSource: "preset" | "analysis" | "none";
  license: string;
  durationSec?: number;
}

export interface SfxSelection {
  sceneId: string;
  file: string;
  at: number;
  volume: number;
  reason: string;
}

export interface RenderResult {
  status: "rendered" | "not_rendered";
  reason?: string;
  videoPath?: string;
  posterPath?: string;
  checkOk?: boolean;
  checkFindings?: number;
  renderMs?: number;
  ffprobe?: { durationSec?: number; width?: number; height?: number; hasAudio?: boolean };
  command?: string;
}

export interface LaunchResult {
  ok: boolean;
  outputDir: string;
  steps: ProgressEvent[];
  repositoryAnalysis: RepositoryAnalysis;
  runtimeAnalysis: RuntimeAnalysis;
  uiAnalysis: UIAnalysis;
  productDNA: ProductDNA;
  storyboard: Storyboard;
  render: RenderResult;
  qualityGate: QualityGate;
  files: Record<string, string>;
}

export interface QualityGate {
  passed: boolean;
  checks: Array<{ id: string; ok: boolean; message: string; severity: "error" | "warn" }>;
}
