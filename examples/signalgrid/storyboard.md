# Storyboard: SignalGrid

- Duration: **24s** · Format: **landscape** (1920×1080) · Tone: **cinematic** · 30 fps
- Real UI scenes: 6/7

## Scene 1 — HOOK — 0s → 3.3s (3.3s)
- Source: `assets/runtime/desktop-explorer.png` (screenshot)
- Text: **Anomaly detection dashboard for streaming metrics** — analytics dashboard
- Motion: `parallax-drift` — The real SignalGrid sits behind the hook, pushed in slowly and slightly dimmed; type is the focus for the first 2 seconds.
- Transition in: cut
- Audio: music enters low; one soft accent as the hook settles

## Scene 2 — REVEAL — 3.3s → 6.8s (3.52s)
- Source: `assets/runtime/desktop-explorer.png` (screenshot)
- Text: **SignalGrid** — Live anomaly feed · Metric explorer
- Motion: `focus-zoom` — Name lockup over the SignalGrid; the screenshot scales from 1.06→1.0 as the name settles.
- Transition in: crossfade (0.5s)
- Audio: product name lands on a strong cue; music opens up · SFX `impact/impactSoft_medium_001.ogg` · beat-locked

## Scene 3 — WORKFLOW — 6.82s → 10.4s (3.56s)
- Source: `assets/runtime/desktop-dashboard.png` (screenshot)
- Text: **Dashboard** — Anomaly feed
- Motion: `pan-vertical` — Camera pans down the full-page capture of SignalGrid, like a slow scroll; ends on the lower content.
- Interaction: click → "navigate"
- Transition in: push (0.5s)
- Audio: steady bed; a click/tick when the interaction fires · SFX `interface/click_003.ogg`

## Scene 4 — WORKFLOW — 10.38s → 13.9s (3.52s)
- Source: `assets/runtime/desktop-alerts.png` (screenshot)
- Text: **Alert rules** — define thresholds per metric
- Motion: `pan-vertical` — Camera pans down the full-page capture of SignalGrid, like a slow scroll; ends on the lower content.
- Interaction: click → "navigate"
- Transition in: wipe (0.5s)
- Audio: steady bed; a click/tick when the interaction fires · SFX `interface/click_003.ogg`

## Scene 5 — WORKFLOW — 13.9s → 17.4s (3.5s)
- Source: `assets/runtime/desktop-investigations.png` (screenshot)
- Text: **Investigation notes** — annotate an anomaly
- Motion: `focus-zoom` — Push toward the most important region of SignalGrid (chart/form) and hold; label in the clear area.
- Interaction: click → "navigate"
- Transition in: crossfade (0.5s)
- Audio: steady bed; a click/tick when the interaction fires · SFX `interface/click_003.ogg`

## Scene 6 — HERO — 17.4s → 21.3s (3.88s)
- Source: `assets/runtime/desktop-explorer.png` (screenshot)
- Text: **Metric explorer**
- Motion: `chart-reveal` — Push into the chart on SignalGrid; a soft mask wipes across it so the data appears to draw in. This is the widest, longest look at the real interface — keep it readable.
- Transition in: push (0.5s)
- Audio: the one impact of the film lands here · SFX `impact/impactBell_heavy_000.ogg` · beat-locked

## Scene 7 — CTA — 21.28s → 24s (2.72s)
- Source: none (text only) (brand)
- Text: **SignalGrid** — Open source · React · Vite
- Motion: `hold` — Name and one line, centered, on the product background; accent underline draws in; music fades.
- Transition in: wipe (0.5s)
- Audio: music resolves and fades under the name · SFX `impact/impactBell_heavy_003.ogg`

## Notes
- Scene 2 (reveal) is 3.6s but its copy needs ~4.1s; the composition shortens the subtext instead of speeding it up.
- Scene 5 (workflow) is 3.5s but its copy needs ~4.1s; the composition shortens the subtext instead of speeding it up.
- Scene 7 (cta) is 2.8s but its copy needs ~3.2s; the composition shortens the subtext instead of speeding it up.
