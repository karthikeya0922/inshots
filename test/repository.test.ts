import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepository } from "../src/repository/scanner.js";
import { detectFrameworks } from "../src/repository/framework-detector.js";
import { analyzeFeatures } from "../src/repository/feature-analyzer.js";
import { analyzeRepository } from "../src/repository/index.js";
import { redactSecrets, isSecretFile, looksLikeSecret } from "../src/repository/secrets.js";
import { looksLikeMetric, shortPhrase } from "../src/shared/text.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fx = (name: string) => path.join(FIXTURES, name);

async function detect(name: string) {
  const scan = await scanRepository(fx(name));
  return { scan, det: detectFrameworks(scan) };
}

test("static HTML project is detected as a static app with page routes", async () => {
  const { det } = await detect("static-site");
  assert.equal(det.primaryApp?.kind, "static");
  assert.equal(det.primaryApp?.runCommand?.cmd, "__static__");
  assert.ok(det.frontend.includes("HTML/CSS/JS"));
  const paths = det.routes.map((r) => r.path);
  assert.ok(paths.includes("/"), `routes: ${paths.join(",")}`);
  assert.ok(paths.includes("/app.html"));
});

test("Vite + React SaaS: framework, package manager, run command, router routes", async () => {
  const { det } = await detect("vite-react-saas");
  assert.ok(det.frontend.includes("React"));
  assert.ok(det.frontend.includes("Vite"));
  assert.ok(det.frontend.includes("React Router"));
  assert.ok(det.tooling.includes("Recharts"));
  const app = det.primaryApp!;
  assert.equal(app.kind, "frontend");
  assert.equal(app.runCommand?.cmd, "npm");
  assert.deepEqual(app.runCommand?.args.slice(0, 2), ["run", "dev"]);
  assert.ok(app.runCommand?.args.includes("--port"));
  assert.ok(app.runCommand?.install?.args.includes("--ignore-scripts"), "install must disable lifecycle scripts");
  const paths = det.routes.map((r) => r.path);
  for (const p of ["/dashboard", "/explorer", "/alerts", "/investigations", "/login"]) assert.ok(paths.includes(p), `missing ${p} in ${paths.join(",")}`);
  // `src/pages/*.jsx` must NOT be treated as file-based routes for a plain Vite app.
  assert.ok(!paths.some((p) => /^\/[A-Z]/.test(p)), `capitalised file routes leaked: ${paths.join(",")}`);
});

test("Next.js dashboard: app router routes, Prisma/Postgres, NextAuth, tailwind tokens", async () => {
  const { det, scan } = await detect("next-dashboard");
  assert.ok(det.frontend.includes("Next.js"));
  assert.equal(det.primaryApp?.kind, "fullstack");
  assert.ok(det.database.includes("PostgreSQL"));
  assert.ok(det.database.includes("Prisma"));
  assert.ok(det.backend.includes("NextAuth"));
  const pages = det.routes.filter((r) => r.kind === "page").map((r) => r.path);
  assert.deepEqual(pages.sort(), ["/", "/reports", "/settings"]);
  assert.ok(det.routes.some((r) => r.kind === "api" && r.path === "/api/metrics"));
  assert.equal(det.primaryApp?.runCommand?.port, 3000);
  assert.ok(det.primaryApp?.runCommand?.args.includes("-p"), "next dev should be pinned to a port");
  assert.equal(scan.designTokens.tailwind?.themeColors.primary, "#f59e0b");
  assert.equal(scan.designTokens.tailwind?.darkMode, "class");
});

test("FastAPI app: python backend, uvicorn command, template frontend, routes", async () => {
  const { det } = await detect("fastapi-app");
  assert.ok(det.backend.includes("FastAPI"));
  assert.ok(det.frontend.includes("Server-rendered HTML (Jinja)"));
  const app = det.primaryApp!;
  assert.equal(app.kind, "fullstack");
  assert.equal(app.runCommand?.cmd, "__python__");
  assert.ok(app.runCommand?.args.join(" ").includes("uvicorn main:app"));
  assert.equal(app.runCommand?.install?.cmd, "__pip__");
  const paths = det.routes.map((r) => r.path);
  assert.ok(paths.includes("/upload"));
  assert.ok(det.routes.some((r) => r.path === "/api/invoices" && r.kind === "api"));
});

test("project with no runnable frontend is classified as a CLI and gets no run command", async () => {
  const { det } = await detect("no-frontend-cli");
  assert.equal(det.primaryApp?.kind, "cli");
  assert.equal(det.primaryApp?.runCommand, null);
  assert.equal(det.frontend.length, 0);
});

test("monorepo with multiple frontends picks the web app and records the others", async () => {
  const { det } = await detect("monorepo");
  const fes = det.apps.filter((a) => a.kind === "frontend" || a.kind === "fullstack");
  assert.ok(fes.length >= 1, "at least one frontend app");
  assert.equal(det.primaryApp?.dir, "apps/web");
  assert.equal(det.primaryApp?.packageManager, "pnpm");
  assert.ok(det.apps.some((a) => a.dir === "packages/api" && a.kind === "backend"));
  assert.ok(det.apps.some((a) => a.dir === "apps/docs"), "docs app recorded");
  assert.ok(det.backend.includes("Express"));
  assert.ok(det.database.includes("PostgreSQL"));
});

test("features carry evidence, come from routes + README + dependencies, and skip metric bullets", async () => {
  const { det, scan } = await detect("vite-react-saas");
  const features = analyzeFeatures(scan, det);
  assert.ok(features.length >= 4);
  for (const f of features) assert.ok(f.evidence.length > 0, `${f.name} has evidence`);
  const names = features.map((f) => f.name);
  assert.ok(names.includes("Metric explorer"), names.join(","));
  assert.ok(names.includes("Alert rules"), names.join(","));
  assert.ok(names.includes("Charts & Visualizations"), names.join(","));
  assert.ok(!names.some((n) => /trusted by|accuracy|500\+/i.test(n)), "metric claims must never become features");
  const explorer = features.find((f) => f.name === "Metric explorer")!;
  assert.ok(explorer.sources.includes("readme") && explorer.sources.includes("route"));
  assert.ok(explorer.evidence.some((e) => e.includes("Explorer.jsx")));
});

test("repository analysis exposes name, description, license, and warnings", async () => {
  const repo = await analyzeRepository({ localPath: fx("vite-react-saas"), url: fx("vite-react-saas"), isLocal: true, workspaceDir: "" });
  assert.equal(repo.analysis.name, "SignalGrid");
  assert.match(repo.analysis.description, /Anomaly detection/);
  assert.equal(repo.analysis.license, "MIT");
  assert.ok(repo.analysis.readme.metricClaims.some((m) => /99\.99%/.test(m)));
});

test("secret files are skipped and secret-like values are redacted", async () => {
  assert.ok(isSecretFile(".env"));
  assert.ok(isSecretFile("config/.env.production"));
  assert.ok(isSecretFile("keys/server.pem"));
  assert.ok(!isSecretFile("src/env.ts"));
  const sample = ["OPENAI_KEY=sk-" + "abcdefghijklmnopqrstuvwxyz0123456789", "token: ghp_" + "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef012345", "postgres://user:" + "s3cretpass@db:5432/x", "const apiKey = '" + "AKIA" + "ABCDEFGHIJKLMNOP'"].join("\n");
  const red = redactSecrets(sample);
  assert.ok(red.count >= 4, `redacted ${red.count}`);
  assert.ok(!/sk-abcdef/.test(red.text));
  assert.ok(!/ghp_ABCDEF/.test(red.text));
  assert.ok(!/s3cretpass/.test(red.text));
  assert.ok(!looksLikeSecret(red.text));
});

test("metric detector catches traction/accuracy/scale claims and leaves feature names alone", () => {
  for (const t of ["Processes 10,000 invoices per hour", "Trusted by 500+ engineering teams", "99.99% detection accuracy", "Used by 2,000,000 writers", "10x faster than X", "$2M ARR"]) assert.ok(looksLikeMetric(t), t);
  for (const t of ["Invoice extraction", "Metric explorer", "Live anomaly feed", "Dark mode", "Export to PDF in 1 click", "Handles 3 file types"]) assert.ok(!looksLikeMetric(t), t);
});

test("shortPhrase never cuts mid-word or ends with an ellipsis", () => {
  const out = shortPhrase("drop a PDF or photo and LedgerLens pulls out the vendor, total and invoice number");
  assert.equal(out, "drop a PDF or photo");
  assert.equal(shortPhrase("see who you pay and how much, updated as invoices arrive"), "see who you pay");
  assert.equal(shortPhrase("Upload an invoice"), "Upload an invoice");
});
