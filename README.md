# Frameo

**One command. A 30-second launch video built from a repository's real, running UI.**

```
/frameo https://github.com/user/project
```

Frameo is a connector/plugin for AI agents (MCP server + Claude Code skill + CLI) with a single
command, `/frameo`. Give it a repository and it clones the code, understands the codebase, **runs the application**,
explores it in a real browser, captures the actual screens, analyzes the UI/UX, verifies every
claim against source, writes a storyboard, hands a UI-aware composition to
[Hyperframes](https://hyperframes.heygen.com), and renders a 30-second launch film plus share
copy for LinkedIn, X, Product Hunt and short-form.

The result feels like a designer, a product marketer, a developer and a motion designer looked at
the whole repository and made a film for **this** product — not like an AI generated a SaaS promo.

```
✓ Repository analyzed (15 files, 7 features with evidence)
✓ Frontend detected: React, Vite, React Router
✓ Application launched (http://127.0.0.1:5173)
✓ 9 screens discovered
✓ UI system analyzed (dark, dashboard, premium)
✓ 6 product flows identified
✓ Product DNA generated
✓ Storyboard generated (7 scenes, 30s, landscape)
✓ Claims verified (18 verified, 2 excluded)
✓ Hyperframes composition created
✓ Video rendered → frameo.mp4
✓ Quality gate passed

Your launch package is ready: frameo-output/
```

---

## How it differs from `/brag`

[`/brag`](https://github.com/latent-spaces/brag) is the reference: read the project → creative plan →
composition brief → Hyperframes → launch video → share copy. Frameo keeps that
architecture (discover → plan → brief → compose → check → render → deliver, music/SFX handling,
beat-aware timing, poster baked as frame 0) and goes much deeper on the *understanding* side:

| | `/brag` | Frameo |
|---|---|---|
| Input | current project directory | any GitHub URL, git URL, `owner/repo`, or local path |
| Understanding | reads `index.html`, CSS, README | full repository intelligence: frameworks, backend, database, package managers, monorepo apps, file-based + code-based routes, evidence-backed features, design tokens, brand assets, license |
| UI material | recreates UI in HTML from source | **runs the app** (npm/pnpm/yarn/bun, Vite/Next/Astro/SvelteKit/Angular, FastAPI/Flask/Django/Streamlit/Gradio, Spring Boot, Go, static HTML) and **captures the real interface** with Playwright |
| UI analysis | color/font extraction from CSS | `UIUXAnalyzer`: computed-style sampling weighted by area → colors, typography, radius, shadows, glass; component detection (navbar, sidebar, cards, tables, charts, forms, dialogs, tabs, badges); design-language classification with confidence |
| Story | 9-question rubric | Product DNA + story engine + user-flow ranking (visual quality, importance, storytelling value, interaction richness) |
| Claims | "use the project's actual copy" | explicit claim verification: every line traced to files; metrics about users/revenue/accuracy/speed/funding are **never** shown |
| Motion | Hyperframes decides | UI-aware presets derived from what each screen contains (chart-reveal, row-reveal, card-stagger, pan-vertical, focus-zoom, device-scroll, parallax-drift, slow-push) |
| Fallback | n/a | app can't run → `runtime_unavailable` + source-derived visuals (real code cards, README words) — never a fake render |
| Interface | skill | one command everywhere: MCP tool `frameo`, Claude Code skill `/frameo`, CLI `frameo` |

## Pipeline

```
GitHub Repository
   ↓  clone (depth 1, hooks removed)                       src/repository/clone.ts
Repository Intelligence
   ↓  scan + secrets redaction + README + design tokens     src/repository/scanner.ts
Deep Codebase Analysis
   ↓  frameworks · backend · db · apps · routes             src/repository/framework-detector.ts
   ↓  evidence-backed features                              src/repository/feature-analyzer.ts
Detect & Run Application
   ↓  install (scripts disabled) · start · find port        src/runtime/launcher.ts, process-manager.ts
Browser / UI Exploration
   ↓  routes · links · nav · DOM · styles · screenshots     src/runtime/browser.ts
UI/UX Analysis
   ↓  visual system · components · design language          src/ui/design-system.ts
Product Understanding
   ↓  flows · claim verification · Product DNA              src/intelligence/*
Creative Storyboard
   ↓  story plan · scenes · UI-aware motion                  src/intelligence/story-engine.ts, src/storyboard/
Hyperframes Composition
   ↓  brief · index.html · music · SFX · beats · reactive    src/hyperframes/*, src/audio/
Render
   ↓  hyperframes check → render → poster → bake frame 0    src/hyperframes/renderer.ts
Launch Video + Share Copy                                     src/copy/, src/output/
```

Every stage writes JSON/Markdown to `frameo-output/`; the artifacts are the contract between
modules, so any module can be replaced.

## Install

Requirements: Node ≥ 22, FFmpeg on PATH, Hyperframes (`npx hyperframes` — installed on first
use), Playwright Chromium (`npx playwright install chromium`). Python 3 is needed only to run
Python projects; git only to clone remote repositories.

```bash
git clone <this repo> frameo
cd frameo
npm install
npx playwright install chromium
npm run build
```

### As a Claude Code plugin / MCP server

`.claude-plugin/plugin.json` + `.mcp.json` register the `frameo` MCP server and the
`/frameo` skill. There is exactly one command and one tool:

| Tool | Purpose |
|---|---|
| `frameo` | the whole pipeline; returns output dir, step summary, quality gate, storyboard |

Run the server directly: `node bin/frameo-mcp.js` (stdio).

### CLI

```bash
frameo https://github.com/user/project
frameo https://github.com/user/project --tone cinematic --platform linkedin
frameo . --format vertical
frameo owner/repo --tone "minimal Apple-style" --no-sfx
```

`npm run dev -- <repo>` runs it from source via `tsx`.

## Options

```json
{
  "repository_url": "https://github.com/user/project",
  "duration": 30,           // 15–30, default 30
  "format": "landscape",    // landscape (16:9) | vertical (9:16) | square (1:1)
  "tone": "polished",       // polished | cinematic | minimal | playful | technical | app-store | bold | freeform text
  "voice": false,
  "music": true,
  "sfx": true,
  "branch": "main",
  "platform": "linkedin",   // linkedin | x | instagram-reel | youtube-short | product-hunt
  "style": "…",
  "target_audience": "developers",
  "run": true,              // run the app + browser exploration
  "install": true,          // allow dependency install (lifecycle scripts always disabled)
  "quality": "looks"        // draft | looks | delivery
}
```

The user never has to provide a feature list, screenshots, storyboard, colors, UI descriptions
or copy — all of it is derived. When the tone is omitted it is inferred from the product's own
design language (developer-focused → `technical`, dark + saturated accent → `cinematic`, …).

## Output

```
frameo-output/
├── product-dna.json            source of truth: features, screens, flows, identity, claims
├── repository-analysis.json    frameworks, apps, routes, features, tokens, brand assets, redactions
├── runtime-analysis.json       launch command, URL, screens (DOM + style samples), flows, logs
├── ui-analysis.json            visual system, components, design language, confidence
├── claim-verification.json     verified / unsupported claims with evidence and reasons
├── launch-plan.md              what it is · strongest angle · hook · UI moments · CTA · tone
├── storyboard.md / .json       scenes with source, text, motion, transition, audio
├── composition-brief.md        the focused handoff to Hyperframes
├── share-copy/
│   ├── linkedin.md  x.md  product-hunt.md  short-caption.md
├── assets/                     runtime/*.png screenshots (+ full-page, after-click), source cards
├── composition/                standalone Hyperframes project (index.html, assets/, hyperframes.json)
├── hyperframes-check.json      the check report
├── render-status.json          rendered | not_rendered + reason
├── quality-gate.json           the quality gate
├── launch-result.json          summary
├── poster.png                  hero frame (also baked as frame 0 of the video)
└── frameo.mp4
```

## What "UI-aware" means in practice

- **Screens are ranked**, not assumed: richness (charts, tables, cards, imagery, controls) ×
  importance (dashboard/editor/results over about/legal/login) → hero, reveal, workflow, feature.
- **Motion follows content**: a chart gets a masked draw-in and a push; a table gets a slow
  vertical pan over its full-page capture; cards get a staggered wipe; forms get a focus zoom;
  vertical formats get phone-framed device scroll from a real mobile-viewport capture.
- **Interactions are real**: the explorer clicks a primary control, keeps the after-state only if
  pixels changed, and the composition animates a cursor to it before cross-fading to the result.
- **Design is preserved**: page background, surface, accent, muted text (contrast-corrected to
  WCAG), radius, glass, and typography. Google Fonts the product uses are declared so
  Hyperframes renders them; fonts shipped in the repo are embedded via `@font-face`.
- **Audio is tasteful**: one bundled bed matched to the tone, 1–3 beat locks (±0.15 s) and beat
  snaps (±0.10 s) that never violate the reading floor, ≤ 5 SFX ≥ 1.2 s apart, and a subtle
  audio-reactive background glow driven by pre-extracted RMS/bass bands — never an equalizer.

## Claim verification

Every candidate line (README tagline and bullets, feature names, screen headlines, stack) becomes a
claim with `verified`, `evidence` and `reason`. Rules:

- A feature exists only with file evidence (route file, component, importer of a dependency, or
  README keywords found in source).
- Numbers about users, customers, revenue, accuracy, performance, funding, downloads, or scale are
  never verified from source and never appear in the video or copy (`looksLikeMetric`).
- Runtime observations ("Data visualized in charts", the first heading of a captured screen) are
  the strongest evidence: we saw them rendered.
- Generic SaaS phrases ("streamline your workflow", "revolutionize", "10x", …) are banned.
- "Open source" is only said when a LICENSE file (or `package.json` license) exists.

## Security

Repositories are untrusted input.

- Dependency installation always runs with lifecycle scripts disabled (`--ignore-scripts`; pip has
  none). Dev scripts that invoke docker/ssh/rm -rf/sudo/curl-pipe-sh are never chosen.
- The app runs with a scrubbed environment (no host secrets forwarded), on a private free port; a
  port that was already serving something before startup is never accepted, so an unrelated local
  server can never be screenshotted. Processes are killed (whole tree) when done.
- The browser blocks all non-localhost network except font/JS CDNs, dismisses dialogs, and runs
  headless with a fresh context.
- `.env*`, key files, credentials and service-account JSON are never read. Secret-looking values
  (API keys, tokens, JWTs, connection strings, `KEY=value` assignments) are redacted before any text
  reaches analysis, artifacts, logs, or an LLM. The quality gate re-scans artifacts.
- Cloned repositories live in an isolated temp workspace and are deleted afterwards; Python
  virtualenvs are created outside the repository.
- Docker-based sandboxing is not built in; run the connector inside a container when analyzing
  hostile code.

## Error handling

- App cannot run (no command, install failure, startup timeout, crash): the pipeline continues with
  `runtime.status = "runtime_unavailable"` and renders source-derived visuals — real code from the
  most important files and the README's own words, in the project's palette.
- Hyperframes missing or `check` fails: everything except the MP4 is produced,
  `render-status.json` records the actionable reason, and the video is **not** claimed to exist.
- Contrast-only `check` failures are retried with `--no-contrast` and recorded; all other findings
  block the render.

## Testing

Fixtures under `test/fixtures/` cover the required project types: React SaaS (Vite + React
Router + Recharts), Next.js dashboard (app router, Prisma, NextAuth, Tailwind), a Vite application,
a Python/FastAPI app with Jinja templates, a static HTML project, a project with no runnable
frontend (CLI library) and a monorepo with multiple frontends.

```bash
npm test          # unit: detection, routes, features, secrets, claims, DNA, story, storyboard, composition, copy, gate
npm run test:e2e  # end-to-end: runs the app, captures screens, renders with Hyperframes (needs Chromium + Hyperframes)
```

## Project layout

```
src/
├── connector/     cli.ts · mcp-server.ts · pipeline.ts (orchestration, defaults, platform presets)
├── repository/    clone · scanner · framework-detector · feature-analyzer · secrets
├── runtime/       launcher · process-manager · static-server · browser (Playwright)
├── ui/            design-system (UIUXAnalyzer) · source-visuals (fallback cards)
├── intelligence/  flows · claim-verifier · product-dna · story-engine
├── storyboard/    scene generation + UI-aware motion presets
├── hyperframes/   brief · composition · renderer
├── audio/         music selection · beat analysis · audio-reactive bands · SFX placement
├── copy/          share copy
├── output/        output dir, quality gate, summary
└── shared/        exec (safe spawn), fs, color, text
skills/frameo/   the agent skill (+ review rubric)
assets/                bundled music (ende.app Happy Beats — verify license before redistribution) and CC0 Kenney SFX
test/                  fixtures, unit tests, e2e tests
```

## Limitations

- `--voice` is accepted and recorded but narration is not generated in this build.
- Authentication walls are detected but not bypassed; if every route redirects to login the film
  uses the login screen plus source-derived visuals.
- Very large monorepos are capped at 20,000 scanned files and 10 captured routes by default
  (`--max-screens`).
- `render` / `analyze` are not separate commands: `/frameo <repo>` always produces the full package.
- Beat detection for user-supplied tracks uses an energy-based onset detector (deterministic, no
  Python); bundled tracks ship with precomputed cue presets.
