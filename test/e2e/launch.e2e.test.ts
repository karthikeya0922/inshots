import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { createLaunchVideo } from "../../src/connector/pipeline.js";
import { hyperframesVersion } from "../../src/hyperframes/renderer.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const enabled = process.env.HYPERFRAME_LAUNCH_E2E === "1";

test("end-to-end: static site → runtime capture → storyboard → Hyperframes render", { skip: !enabled }, async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "hfl-e2e-"));
  const hf = await hyperframesVersion();
  const result = await createLaunchVideo({ repositoryUrl: path.join(FIXTURES, "static-site"), outputDir: out, quality: "draft", render: !!hf, duration: 20 }, { report: (e) => process.stderr.write(`  ${e.status} ${e.message}\n`) });
  assert.equal(result.runtimeAnalysis.status, "ok");
  assert.ok(result.runtimeAnalysis.screens.length >= 3);
  assert.ok(result.storyboard.scenes.some((s) => s.sourceKind === "screenshot"));
  for (const f of ["product-dna.json", "repository-analysis.json", "runtime-analysis.json", "ui-analysis.json", "claim-verification.json", "launch-plan.md", "storyboard.md", "composition-brief.md", "share-copy/linkedin.md", "share-copy/x.md", "share-copy/product-hunt.md", "share-copy/short-caption.md", "composition/index.html"]) {
    assert.ok(await fs.stat(path.join(out, f)), f);
  }
  if (hf) {
    assert.equal(result.render.status, "rendered", result.render.reason);
    assert.ok(result.render.ffprobe?.hasAudio, "music is mixed in");
    assert.ok(Math.abs((result.render.ffprobe?.durationSec ?? 0) - result.storyboard.duration) < 0.6);
    assert.ok(await fs.stat(path.join(out, "launch.mp4")));
    assert.ok(await fs.stat(path.join(out, "poster.png")));
  }
  assert.ok(result.qualityGate.passed, JSON.stringify(result.qualityGate.checks.filter((c) => !c.ok)));
  await fs.rm(out, { recursive: true, force: true });
});

test("end-to-end: project with no runnable frontend falls back to source-derived visuals", { skip: !enabled }, async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "hfl-e2e-cli-"));
  const result = await createLaunchVideo({ repositoryUrl: path.join(FIXTURES, "no-frontend-cli"), outputDir: out, render: false });
  assert.equal(result.runtimeAnalysis.status, "runtime_unavailable");
  assert.ok(result.runtimeAnalysis.sourceDerived.length >= 1, "code cards rendered from real source");
  assert.ok(result.storyboard.scenes.some((s) => s.sourceKind === "source-card"));
  assert.ok(result.qualityGate.passed, JSON.stringify(result.qualityGate.checks.filter((c) => !c.ok)));
  await fs.rm(out, { recursive: true, force: true });
});
