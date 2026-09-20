# Review rubric for a generated launch video

Answer each question from the artifacts in `launch-output/`. A "no" is a reason to refine —
but only by rearranging verified material, never by inventing.

## Product understanding

1. **What is the product?** `product-dna.json → description / tagline`. Would a stranger get it
   from the hook plus the reveal scene?
2. **Which screen is the hero?** `storyboard.md → HERO scene → Source`. Is it the richest real
   screen (`product-dna.json → screens[].score`) — a dashboard, an editor, a result view — rather
   than a landing page or a login form?
3. **Does the flow progress?** `product-dna.json → user_flows[0]`. The workflow scenes should read
   entry → action → result, not three variations of the same page.

## Copy

4. **Is every line verified?** Each scene's `verifiedCopy` in `storyboard.json` must include its
   `text`. Anything in `claim-verification.json → unsupported` must not appear.
5. **Is the hook short and specific?** ≤ 8 words, the product's own tagline or a real feature
   name. If it fell back to the product name, look for a verified feature to lead with instead.
6. **No generic SaaS language.** "streamline", "revolutionize", "next-generation", "seamless",
   "10x" and friends are banned by the connector; do not add them back.

## Visual

7. **Does it look like the product?** `ui-analysis.json → visualSystem`. The composition's
   background, accent, radius and type must be those values. Dark products stay dark.
8. **Is the UI readable?** Motion presets never exceed scale 1.14; labels sit on opaque panels.
   If a screenshot is dense (tables, code), prefer `pan-vertical` over `focus-zoom`.
9. **Does the poster frame stand alone?** `poster.png` is pulled from the settled hero moment. It
   should be postable as an image on its own.

## Audio

10. **Is the music appropriate for the tone?** `storyboard.json → music.title`. Minimal/deadpan
    tones want a quieter bed and fewer SFX.
11. **Are SFX restrained?** ≤ 5 cues, ≥ 1.2 s apart, one impact on the hero reveal.
12. **Beat locks helped, not hurt?** `composition-brief.md → Beat locks`. A lock that shortened a
    scene below its reading floor is undone by the connector; if a transition still feels early,
    move it later in `index.html`.

## Output

13. `launch.mp4` exists, duration matches `storyboard.json → duration` (±0.5 s), has an audio
    stream when music was enabled.
14. `share-copy/` has four variants; each names the product and links the repository.
15. `quality-gate.json → passed` is true; warnings are explained to the user.
