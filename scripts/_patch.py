import io
def patch(p, pairs):
    s=io.open(p,encoding='utf8').read()
    for old,new in pairs:
        assert old in s, (p, old[:70])
        s=s.replace(old,new)
    io.open(p,'w',encoding='utf8').write(s)

# 1. shared metric detector
patch('src/shared/text.ts', [
 ('''/** Generic SaaS phrases that must never appear in generated copy. */''','''/**
 * Does this text assert a number about scale, speed, accuracy, traction or money?
 * Such claims can never be verified from source code, so they never reach the video.
 */
export function looksLikeMetric(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\d[\d,.]*\s?(%|percent|x\b|×|k\b|m\b|b\b|ms\b|mb\b|gb\b|tb\b)/.test(t) ||
    /\b\d{1,3}(,\d{3})+\b/.test(t) ||
    /\b\d+\+?\s+[a-z-]+\s+(per|a|an|every)\s+(second|minute|hour|day|week|month|year)\b/.test(t) ||
    /\b\d{2,}\+?\s+(users|customers|teams|companies|developers|downloads|stars|installs|clients|countries|invoices|requests|documents|files|events|transactions|messages|projects|repos|orgs|organizations|people|engineers|founders|startups|enterprises|brands|merchants|stores|sites|apps)\b/.test(t) ||
    /\b(millions?|thousands?|billions?|hundreds)\s+of\b/.test(t) ||
    /\b(trusted|used|loved)\s+by\b/.test(t) ||
    /\b\d+(\.\d+)?\s?(×|x)\s?(faster|cheaper|quicker|more|less|better)/.test(t) ||
    /\b(\d+(\.\d+)?\s?(nines|uptime|sla|accuracy|precision|recall|latency))\b/.test(t) ||
    /\$\s?\d/.test(t) ||
    /\b(series [a-d]|raised|funding|valuation|arr|mrr|revenue)\b/.test(t)
  );
}

/** Generic SaaS phrases that must never appear in generated copy. */'''),
])
# 2. feature analyzer: skip metric bullets
patch('src/repository/feature-analyzer.ts', [
 ('''import { humanize, slugify, uniq } from "../shared/text.js";''','''import { humanize, looksLikeMetric, slugify, uniq } from "../shared/text.js";'''),
 ('''  for (const bullet of scan.readme.featureBullets) {
    const name = bulletName(bullet);
    if (!name) continue;''','''  for (const bullet of scan.readme.featureBullets) {
    if (looksLikeMetric(bullet)) continue; // metrics are claims, never features (see claim-verifier)
    const name = bulletName(bullet);
    if (!name || looksLikeMetric(name)) continue;'''),
])
# claim verifier: use shared detector
patch('src/intelligence/claim-verifier.ts', [
 ('''import { slugify } from "../shared/text.js";''','''import { looksLikeMetric, slugify } from "../shared/text.js";'''),
 ('''const METRIC_RE = /(\d[\d,.]*\s?(%|x\b|k\+?|m\+?|ms\b|users|customers|downloads|stars|companies|teams|developers|requests|accuracy|faster|uptime|revenue|arr|mrr|funding|raised|installs)|\b(millions?|thousands?|billions?)\b|\$\s?\d)/i;
const FABRICATION_RE = /\b(users?|customers?|revenue|accuracy|performance|funding|downloads?|installs?|clients?|companies|teams|enterprises)\b/i;''','''const METRIC_RE = { test: (s: string) => looksLikeMetric(s) };'''),
 ('''export function isSafeCopy(text: string, claims: Claim[]): boolean {
  if (METRIC_RE.test(text) && FABRICATION_RE.test(text)) return false;
  if (/\b\d{2,}(,\d{3})*\+?\s*(users|customers|companies|teams|downloads)/i.test(text)) return false;
  if (/\b\d+(\.\d+)?%/.test(text)) return false;''','''export function isSafeCopy(text: string, claims: Claim[]): boolean {
  if (looksLikeMetric(text)) return false;'''),
])
# 3. ignore virtualenvs & our own venv anywhere
patch('src/shared/fs.ts', [
 ('''        if (ignore.has(entry.name) || entry.name.startsWith(".git")) continue;''','''        if (ignore.has(entry.name) || entry.name.startsWith(".git") || /(^\.?venv|-venv$|^site-packages$|^\.tox$|^\.nox$|^virtualenv$|^\.hyperframe-launch)/.test(entry.name)) continue;'''),
])
# 4. venv outside the repository
patch('src/runtime/launcher.ts', [
 ('''import path from "node:path";
import { exec, hasCommand, which } from "../shared/exec.js";''','''import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { exec, hasCommand, which } from "../shared/exec.js";'''),
 ('''  if (!opts.install) return { python: base };
  const venv = path.join(cwd, ".hyperframe-launch-venv");''','''  if (!opts.install) return { python: base };
  // Keep the virtualenv out of the repository (never pollute a local checkout, never get re-scanned).
  const venv = path.join(os.tmpdir(), "hyperframe-launch", "venvs", createHash("sha1").update(cwd).digest("hex").slice(0, 12));'''),
])
# 5. copy: API suffix handling
patch('src/copy/index.ts', [
 ('''  const features = dna.verified_features.filter((f) => ok(f.name)).slice(0, 4).map((f) => f.name.replace(/ API$/, ""));''','''  const features = dna.verified_features.filter((f) => ok(f.name) && !/^HTTP API$/.test(f.name)).slice(0, 4).map((f) => (f.name.length > 9 ? f.name.replace(/ API$/, " API") : f.name));'''),
])
print('ok')
