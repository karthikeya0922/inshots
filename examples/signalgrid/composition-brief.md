# Hyperframes Composition Brief: SignalGrid

## Project
- Product: SignalGrid (analytics dashboard)
- Source: 5 screens captured from the running app
- Audience: teams and operators

## Output
- Composition directory: `vite-final/composition/`
- Rendered video: `vite-final/launch.mp4`
- Format: landscape — 1920×1080 @ 30fps
- Duration: 24s

## Product angle
Open on the real explorer screen with sidebar and cards and let it carry the film — then move through explorer → dashboard → alerts → investigations before landing on metric explorer.

Hook: **Anomaly detection dashboard for streaming metrics** · CTA: **SignalGrid**

## Source screens & actual UI elements
- `assets/runtime/desktop-explorer.png` — /explorer · navbar, sidebar, cards, chart, buttons, badges · score 0.77
- `assets/runtime/desktop-dashboard.png` — /dashboard · navbar, sidebar, table, chart, buttons, badges · score 0.72
- `assets/runtime/desktop-alerts.png` — /alerts · navbar, sidebar, table, buttons, form · score 0.58
- `assets/runtime/desktop-investigations.png` — /investigations · navbar, sidebar, cards, buttons, form · score 0.39

## Verified copy (only these lines may appear)
- Anomaly detection dashboard for streaming metrics
- analytics dashboard
- SignalGrid
- Live anomaly feed · Metric explorer
- Dashboard
- Anomaly feed
- Alert rules
- define thresholds per metric
- Investigation notes
- annotate an anomaly
- Metric explorer
- Open source · React · Vite

## Creative direction
- Tone: cinematic — dark, glowing, slow pushes into the interface
- Interpretation: Big type, wide pushes, a single impact at the hero reveal.
- Avoid: generic SaaS language, abstract filler, redesigning the product, invented screens, unverified numbers

## Visual identity (preserve, do not restyle)
- Background #0b1220 · Surface #374151 · Accent #22d3ee · Text #e5e7eb
- Type: Arial / IBM Plex Sans / JetBrains Mono
- Radius: rounded; solid surfaces; dark mode
- Design language: dark, dashboard, premium

## Scene sequence
1. **hook** — 0s → 3.3s — `assets/runtime/desktop-explorer.png` — "Anomaly detection dashboard for streaming metrics" / "analytics dashboard" — motion `parallax-drift`, in: cut
2. **reveal** — 3.3s → 6.82s — `assets/runtime/desktop-explorer.png` — "SignalGrid" / "Live anomaly feed · Metric explorer" — motion `focus-zoom`, in: crossfade
3. **workflow** — 6.82s → 10.38s — `assets/runtime/desktop-dashboard.png` — "Dashboard" / "Anomaly feed" — motion `pan-vertical`, in: push
4. **workflow** — 10.38s → 13.9s — `assets/runtime/desktop-alerts.png` — "Alert rules" / "define thresholds per metric" — motion `pan-vertical`, in: wipe
5. **workflow** — 13.9s → 17.4s — `assets/runtime/desktop-investigations.png` — "Investigation notes" / "annotate an anomaly" — motion `focus-zoom`, in: crossfade
6. **hero** — 17.4s → 21.28s — `assets/runtime/desktop-explorer.png` — "Metric explorer" — motion `chart-reveal`, in: push
7. **cta** — 21.28s → 24s — text — "SignalGrid" / "Open source · React · Vite" — motion `hold`, in: wipe

## Motion requirements
- Motion is derived from screen contents (parallax-drift, focus-zoom, pan-vertical, chart-reveal, hold); the UI must stay readable — no scale beyond 1.14, no spins.
- Text: fast in (≤0.9s), then hold; every line meets the reading floor.
- Real UI appears in 6 of 7 scenes.

## Music
- Track: Happy Beats / Business Moves vol. 10 (`happy-beats-business-moves-vol-10-by-ende-dot-app.mp3`) · 109.96 BPM · cues: preset
- Treatment: fade in 0.8s, fade under CTA; volume 0.55
- Beat locks: workflow-3 6.9s→6.82s (beat); workflow-4 10.4s→10.38s (beat); cta-7 21.2s→21.28s (beat)
- License: ende.app Happy Beats series — verify terms before redistribution

## SFX
- 3.4s `impact/impactSoft_medium_001.ogg` @0.45 — reveal — product name lands on a strong cue; music opens up
- 6.92s `interface/click_003.ogg` @0.45 — workflow — steady bed; a click/tick when the interaction fires
- 10.48s `interface/click_003.ogg` @0.45 — workflow — steady bed; a click/tick when the interaction fires
- 14s `interface/click_003.ogg` @0.45 — workflow — steady bed; a click/tick when the interaction fires
- 17.5s `impact/impactBell_heavy_000.ogg` @0.7 — hero — the one impact of the film lands here

## Audio-reactive
- subtle: background glow breathes with RMS/bass; nothing on text or the UI itself. No equalizer visuals.

## Hyperframes instructions
- Standalone composition, one paused GSAP timeline registered at `window.__timelines["launch"]`.
- Screenshots are `<img>` elements inside framed `.shot` wrappers; camera moves tween the inner `.cam`, never the `.clip`.
- Music on a `data-automation` volume lane; SFX as separate `<audio id>` elements.
- Gate: `npx hyperframes check` must pass before render.
