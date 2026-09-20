import path from "node:path";
import { parse as parseToml } from "smol-toml";
import type { AppCandidate, RunCommand, StaticRoute } from "../types.js";
import type { ScanResult, ScannedFile } from "./scanner.js";

export interface FrameworkDetection {
  frontend: string[];
  backend: string[];
  database: string[];
  tooling: string[];
  ai: string[];
  dependencies: string[];
  apps: AppCandidate[];
  primaryApp: AppCandidate | null;
  routes: StaticRoute[];
}

interface PackageJson {
  name?: string;
  private?: boolean;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  packageManager?: string;
  bin?: unknown;
  main?: string;
}

const FRONTEND_MARKERS: Array<[string, string]> = [
  ["next", "Next.js"],
  ["nuxt", "Nuxt"],
  ["@remix-run/react", "Remix"],
  ["@remix-run/dev", "Remix"],
  ["@sveltejs/kit", "SvelteKit"],
  ["svelte", "Svelte"],
  ["astro", "Astro"],
  ["gatsby", "Gatsby"],
  ["@angular/core", "Angular"],
  ["vue", "Vue"],
  ["react", "React"],
  ["preact", "Preact"],
  ["solid-js", "SolidJS"],
  ["qwik", "Qwik"],
  ["lit", "Lit"],
  ["vite", "Vite"],
  ["@tanstack/react-router", "TanStack Router"],
  ["react-router-dom", "React Router"],
  ["react-router", "React Router"],
  ["vue-router", "Vue Router"],
  ["expo", "Expo"],
  ["react-native", "React Native"],
  ["electron", "Electron"],
  ["@docusaurus/core", "Docusaurus"],
  ["vitepress", "VitePress"],
  ["@builder.io/qwik", "Qwik"],
];

const UI_MARKERS: Array<[string, string]> = [
  ["tailwindcss", "Tailwind CSS"],
  ["@mui/material", "MUI"],
  ["@chakra-ui/react", "Chakra UI"],
  ["antd", "Ant Design"],
  ["@radix-ui/react-dialog", "Radix UI"],
  ["@radix-ui/react-slot", "Radix UI"],
  ["@shadcn/ui", "shadcn/ui"],
  ["class-variance-authority", "shadcn/ui"],
  ["bootstrap", "Bootstrap"],
  ["@mantine/core", "Mantine"],
  ["framer-motion", "Framer Motion"],
  ["motion", "Motion"],
  ["recharts", "Recharts"],
  ["chart.js", "Chart.js"],
  ["d3", "D3"],
  ["@nivo/core", "Nivo"],
  ["echarts", "ECharts"],
  ["three", "Three.js"],
  ["@react-three/fiber", "React Three Fiber"],
  ["mapbox-gl", "Mapbox"],
  ["leaflet", "Leaflet"],
  ["@tanstack/react-table", "TanStack Table"],
  ["ag-grid-react", "AG Grid"],
  ["reactflow", "React Flow"],
  ["@xyflow/react", "React Flow"],
  ["monaco-editor", "Monaco Editor"],
  ["@monaco-editor/react", "Monaco Editor"],
  ["codemirror", "CodeMirror"],
  ["@tiptap/react", "Tiptap"],
  ["lexical", "Lexical"],
];

const BACKEND_MARKERS: Array<[string, string]> = [
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["koa", "Koa"],
  ["hono", "Hono"],
  ["@nestjs/core", "NestJS"],
  ["@trpc/server", "tRPC"],
  ["graphql", "GraphQL"],
  ["apollo-server", "Apollo Server"],
  ["@apollo/server", "Apollo Server"],
  ["socket.io", "Socket.IO"],
  ["ws", "WebSockets"],
  ["next-auth", "NextAuth"],
  ["@auth/core", "Auth.js"],
  ["@clerk/nextjs", "Clerk"],
  ["@clerk/clerk-react", "Clerk"],
  ["passport", "Passport"],
  ["stripe", "Stripe"],
  ["bullmq", "BullMQ"],
  ["@aws-sdk/client-s3", "AWS S3"],
  ["firebase-admin", "Firebase Admin"],
  ["puppeteer", "Puppeteer"],
  ["playwright", "Playwright"],
];

const DATABASE_MARKERS: Array<[string, string]> = [
  ["pg", "PostgreSQL"],
  ["postgres", "PostgreSQL"],
  ["@neondatabase/serverless", "PostgreSQL (Neon)"],
  ["@vercel/postgres", "PostgreSQL (Vercel)"],
  ["mysql2", "MySQL"],
  ["mysql", "MySQL"],
  ["mongoose", "MongoDB"],
  ["mongodb", "MongoDB"],
  ["@supabase/supabase-js", "Supabase"],
  ["firebase", "Firebase"],
  ["@prisma/client", "Prisma"],
  ["prisma", "Prisma"],
  ["drizzle-orm", "Drizzle ORM"],
  ["typeorm", "TypeORM"],
  ["sequelize", "Sequelize"],
  ["knex", "Knex"],
  ["better-sqlite3", "SQLite"],
  ["sqlite3", "SQLite"],
  ["sqlite", "SQLite"],
  ["redis", "Redis"],
  ["ioredis", "Redis"],
  ["@upstash/redis", "Redis (Upstash)"],
  ["convex", "Convex"],
  ["@planetscale/database", "PlanetScale"],
  ["dexie", "IndexedDB (Dexie)"],
  ["@libsql/client", "Turso / libSQL"],
];

const AI_MARKERS: Array<[string, string]> = [
  ["openai", "OpenAI"],
  ["@anthropic-ai/sdk", "Anthropic"],
  ["@ai-sdk/openai", "Vercel AI SDK"],
  ["ai", "Vercel AI SDK"],
  ["langchain", "LangChain"],
  ["@langchain/core", "LangChain"],
  ["@google/generative-ai", "Gemini"],
  ["@huggingface/inference", "Hugging Face"],
  ["ollama", "Ollama"],
  ["@pinecone-database/pinecone", "Pinecone"],
  ["@xenova/transformers", "Transformers.js"],
  ["@tensorflow/tfjs", "TensorFlow.js"],
  ["replicate", "Replicate"],
  ["cohere-ai", "Cohere"],
];

const PY_BACKEND: Array<[RegExp, string]> = [
  [/^fastapi/i, "FastAPI"],
  [/^flask/i, "Flask"],
  [/^django/i, "Django"],
  [/^starlette/i, "Starlette"],
  [/^streamlit/i, "Streamlit"],
  [/^gradio/i, "Gradio"],
  [/^dash$/i, "Dash"],
  [/^tornado/i, "Tornado"],
  [/^aiohttp/i, "aiohttp"],
  [/^sanic/i, "Sanic"],
  [/^litestar/i, "Litestar"],
  [/^uvicorn/i, "Uvicorn"],
  [/^gunicorn/i, "Gunicorn"],
];
const PY_DB: Array<[RegExp, string]> = [
  [/^sqlalchemy/i, "SQLAlchemy"],
  [/^psycopg/i, "PostgreSQL"],
  [/^asyncpg/i, "PostgreSQL"],
  [/^pymongo|^motor/i, "MongoDB"],
  [/^redis/i, "Redis"],
  [/^sqlmodel/i, "SQLModel"],
  [/^peewee/i, "Peewee"],
  [/^supabase/i, "Supabase"],
  [/^firebase/i, "Firebase"],
  [/^mysql|^pymysql/i, "MySQL"],
  [/^alembic/i, "Alembic"],
];
const PY_AI: Array<[RegExp, string]> = [
  [/^openai/i, "OpenAI"],
  [/^anthropic/i, "Anthropic"],
  [/^langchain/i, "LangChain"],
  [/^transformers/i, "Transformers"],
  [/^torch$/i, "PyTorch"],
  [/^tensorflow/i, "TensorFlow"],
  [/^scikit-learn|^sklearn/i, "scikit-learn"],
  [/^llama[-_]index/i, "LlamaIndex"],
  [/^google-generativeai/i, "Gemini"],
  [/^sentence-transformers/i, "Sentence Transformers"],
  [/^spacy/i, "spaCy"],
  [/^presidio/i, "Presidio"],
  [/^chromadb/i, "ChromaDB"],
];

export function detectFrameworks(scan: ScanResult): FrameworkDetection {
  const frontend = new Set<string>();
  const backend = new Set<string>();
  const database = new Set<string>();
  const tooling = new Set<string>();
  const ai = new Set<string>();
  const deps = new Set<string>();
  const apps: AppCandidate[] = [];

  // ----- Node packages -------------------------------------------------------
  const packageFiles = scan.files.filter((f) => path.basename(f.rel) === "package.json" && f.content && !/(^|\/)(node_modules|\.next|dist|build)\//.test(f.rel));
  packageFiles.sort((a, b) => a.rel.split("/").length - b.rel.split("/").length);
  const rootPkg = packageFiles.find((f) => f.rel === "package.json");
  const rootPm = detectNodePackageManager(scan, "");

  for (const f of packageFiles.slice(0, 40)) {
    let pkg: PackageJson;
    try {
      pkg = JSON.parse(f.content!) as PackageJson;
    } catch {
      continue;
    }
    const dir = path.posix.dirname(f.rel) === "." ? "" : path.posix.dirname(f.rel);
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const d of Object.keys(all)) deps.add(d);
    const local = { frontend: new Set<string>(), backend: new Set<string>() };
    for (const [dep, label] of FRONTEND_MARKERS) if (dep in all) local.frontend.add(label), frontend.add(label);
    for (const [dep, label] of UI_MARKERS) if (dep in all) tooling.add(label);
    for (const [dep, label] of BACKEND_MARKERS) if (dep in all) local.backend.add(label), backend.add(label);
    for (const [dep, label] of DATABASE_MARKERS) if (dep in all) database.add(label);
    for (const [dep, label] of AI_MARKERS) if (dep in all) ai.add(label);
    if ("typescript" in all) tooling.add("TypeScript");
    if ("vitest" in all || "jest" in all) tooling.add(all.vitest ? "Vitest" : "Jest");
    if ("storybook" in all || "@storybook/react" in all) tooling.add("Storybook");

    const scripts = pkg.scripts ?? {};
    const isWorkspaceRoot = !!pkg.workspaces || scan.byRel.has(path.posix.join(dir, "pnpm-workspace.yaml")) || scan.byRel.has(path.posix.join(dir, "turbo.json")) || scan.byRel.has(path.posix.join(dir, "lerna.json"));
    const hasIndexHtml = scan.byRel.has(path.posix.join(dir, "index.html")) || scan.byRel.has(path.posix.join(dir, "public/index.html"));
    const fe = [...local.frontend].filter((x) => !["React Router", "Vue Router", "TanStack Router"].includes(x));
    let kind: AppCandidate["kind"] = "unknown";
    if (fe.some((x) => ["Next.js", "Nuxt", "Remix", "SvelteKit", "Astro", "Gatsby"].includes(x))) kind = "fullstack";
    else if (fe.length || hasIndexHtml) kind = "frontend";
    else if (local.backend.size) kind = "backend";
    else if (pkg.bin) kind = "cli";
    else if (pkg.main || /^lib|library|sdk/.test(pkg.name ?? "")) kind = "library";
    if (["React Native", "Expo"].some((x) => fe.includes(x)) && !fe.includes("Next.js")) kind = "unknown";
    if (isWorkspaceRoot && !fe.length && !local.backend.size) kind = "unknown";

    const pm = detectNodePackageManager(scan, dir) ?? rootPm ?? "npm";
    const runCommand = kind === "library" || kind === "cli" || kind === "unknown" ? null : nodeRunCommand(scan, dir, pm, scripts, fe, local.backend);
    const reasons: string[] = [];
    if (fe.length) reasons.push(`frameworks: ${fe.join(", ")}`);
    if (local.backend.size) reasons.push(`backend: ${[...local.backend].join(", ")}`);
    if (runCommand) reasons.push(`run: ${[runCommand.cmd, ...runCommand.args].join(" ")}`);
    if (isWorkspaceRoot) reasons.push("workspace root");
    let score = 0;
    if (kind === "frontend" || kind === "fullstack") score += 10;
    if (runCommand) score += 5;
    if (dir === "") score += 2;
    if (/(^|\/)(apps?\/)?(web|app|frontend|client|dashboard|ui|site|www|admin|console|studio)$/i.test(dir)) score += 3;
    if (/(^|\/)(docs|documentation|website|storybook|examples?|playground|e2e|tests?)(\/|$)/i.test(dir)) score -= 6;
    if (fe.includes("Electron") || fe.includes("React Native")) score -= 4;
    apps.push({
      id: dir || (pkg.name ?? "root"),
      dir,
      kind,
      frameworks: [...fe, ...local.backend],
      packageManager: pm,
      scripts,
      runCommand,
      score,
      reasons,
    });
  }

  // ----- Python ---------------------------------------------------------------
  const pyDeps = collectPythonDeps(scan);
  if (pyDeps.length) {
    const localBackend: string[] = [];
    for (const dep of pyDeps) {
      for (const [re, label] of PY_BACKEND) if (re.test(dep)) backend.add(label), localBackend.push(label);
      for (const [re, label] of PY_DB) if (re.test(dep)) database.add(label);
      for (const [re, label] of PY_AI) if (re.test(dep)) ai.add(label);
      deps.add(dep);
    }
    const pyApp = pythonApp(scan, localBackend);
    if (pyApp) apps.push(pyApp);
  }

  // ----- Java / Go / Rust / Ruby ------------------------------------------------
  const pom = scan.byRel.get("pom.xml");
  const gradle = scan.files.find((f) => /^build\.gradle(\.kts)?$/.test(f.rel));
  if (pom?.content || gradle?.content) {
    const c = (pom?.content ?? "") + (gradle?.content ?? "");
    if (/spring-boot/.test(c)) backend.add("Spring Boot");
    if (/quarkus/.test(c)) backend.add("Quarkus");
    if (/micronaut/.test(c)) backend.add("Micronaut");
    if (/postgresql/.test(c)) database.add("PostgreSQL");
    if (/mysql/.test(c)) database.add("MySQL");
    if (/mongodb/.test(c)) database.add("MongoDB");
    if (/h2database|com\.h2/.test(c)) database.add("H2");
    if (/spring-boot/.test(c)) {
      const isMaven = !!pom;
      const wrapper = isMaven ? (scan.byRel.has("mvnw") ? "./mvnw" : "mvn") : scan.byRel.has("gradlew") ? "./gradlew" : "gradle";
      apps.push({
        id: "spring-boot",
        dir: "",
        kind: "backend",
        frameworks: ["Spring Boot"],
        packageManager: isMaven ? "maven" : "gradle",
        scripts: {},
        runCommand: {
          cmd: wrapper,
          args: isMaven ? ["-q", "spring-boot:run"] : ["bootRun"],
          cwd: "",
          port: 8080,
          reason: "Spring Boot detected in build file",
          env: { SERVER_PORT: "8080" },
        },
        score: 4,
        reasons: ["Spring Boot build"],
      });
    }
  }
  const goMod = scan.byRel.get("go.mod");
  if (goMod?.content) {
    tooling.add("Go");
    if (/gin-gonic\/gin/.test(goMod.content)) backend.add("Gin");
    if (/labstack\/echo/.test(goMod.content)) backend.add("Echo");
    if (/gofiber\/fiber/.test(goMod.content)) backend.add("Fiber");
    if (/go-chi\/chi/.test(goMod.content)) backend.add("Chi");
    if (/gorm\.io/.test(goMod.content)) database.add("GORM");
    const mainGo = scan.files.find((f) => /(^|\/)main\.go$/.test(f.rel) && f.content && /net\/http|gin|echo|fiber|chi/.test(f.content));
    if (mainGo) {
      apps.push({
        id: "go",
        dir: "",
        kind: "backend",
        frameworks: [...backend].filter((b) => ["Gin", "Echo", "Fiber", "Chi"].includes(b)),
        packageManager: "go",
        scripts: {},
        runCommand: { cmd: "go", args: ["run", "./" + path.posix.dirname(mainGo.rel).replace(/^\.$/, "")], cwd: "", port: 8080, reason: "main.go with HTTP server" },
        score: 3,
        reasons: ["Go HTTP server"],
      });
    }
  }
  const cargo = scan.byRel.get("Cargo.toml");
  if (cargo?.content) {
    tooling.add("Rust");
    if (/axum/.test(cargo.content)) backend.add("Axum");
    if (/actix-web/.test(cargo.content)) backend.add("Actix");
    if (/rocket/.test(cargo.content)) backend.add("Rocket");
    if (/leptos|yew|dioxus/.test(cargo.content)) frontend.add("Rust WASM UI");
  }
  const gemfile = scan.byRel.get("Gemfile");
  if (gemfile?.content) {
    if (/rails/.test(gemfile.content)) backend.add("Ruby on Rails");
    if (/sinatra/.test(gemfile.content)) backend.add("Sinatra");
    if (/pg\b/.test(gemfile.content)) database.add("PostgreSQL");
    if (/sqlite3/.test(gemfile.content)) database.add("SQLite");
  }

  // ----- Plain static site ------------------------------------------------------
  const rootIndex = scan.byRel.get("index.html") ?? scan.byRel.get("public/index.html") ?? scan.byRel.get("docs/index.html") ?? scan.byRel.get("site/index.html") ?? scan.byRel.get("src/index.html");
  const hasNodeFrontend = apps.some((a) => a.kind === "frontend" || a.kind === "fullstack");
  if (rootIndex && !hasNodeFrontend) {
    const dir = path.posix.dirname(rootIndex.rel) === "." ? "" : path.posix.dirname(rootIndex.rel);
    const isViteEntry = rootIndex.content?.includes('type="module"') && /src="\/?src\//.test(rootIndex.content ?? "") && scan.files.some((f) => /vite\.config/.test(f.rel));
    if (!isViteEntry) {
      frontend.add("HTML/CSS/JS");
      apps.push({
        id: dir ? `static:${dir}` : "static",
        dir,
        kind: "static",
        frameworks: ["HTML/CSS/JS"],
        scripts: {},
        runCommand: { cmd: "__static__", args: [], cwd: dir, reason: "static index.html served by the built-in file server", openPath: "/" },
        score: 6 + (dir === "" ? 2 : 0),
        reasons: [`static entry ${rootIndex.rel}`],
      });
    }
  }

  // Docker compose hint
  const compose = scan.files.find((f) => /(^|\/)docker-compose\.ya?ml$/.test(f.rel) || /(^|\/)compose\.ya?ml$/.test(f.rel));
  if (compose?.content) {
    tooling.add("Docker Compose");
    if (/image:\s*postgres/.test(compose.content)) database.add("PostgreSQL");
    if (/image:\s*mysql|mariadb/.test(compose.content)) database.add("MySQL");
    if (/image:\s*mongo/.test(compose.content)) database.add("MongoDB");
    if (/image:\s*redis/.test(compose.content)) database.add("Redis");
  }
  if (scan.files.some((f) => /(^|\/)schema\.prisma$/.test(f.rel))) {
    const prisma = scan.files.find((f) => /(^|\/)schema\.prisma$/.test(f.rel));
    const provider = prisma?.content?.match(/provider\s*=\s*"(\w+)"/)?.[1];
    if (provider === "postgresql") database.add("PostgreSQL");
    if (provider === "mysql") database.add("MySQL");
    if (provider === "sqlite") database.add("SQLite");
    if (provider === "mongodb") database.add("MongoDB");
  }
  if (scan.files.some((f) => /(^|\/)supabase\/(config\.toml|migrations)/.test(f.rel))) database.add("Supabase");

  // Deduplicate ORMs vs engines: keep both, it's informative.
  apps.sort((a, b) => b.score - a.score);
  const primaryApp = apps.find((a) => a.runCommand && (a.kind === "frontend" || a.kind === "fullstack" || a.kind === "static")) ?? apps.find((a) => a.runCommand) ?? apps[0] ?? null;
  const routes = detectStaticRoutes(scan, primaryApp);
  return {
    frontend: [...frontend],
    backend: [...backend],
    database: [...database],
    tooling: [...tooling],
    ai: [...ai],
    dependencies: [...deps].sort(),
    apps,
    primaryApp,
    routes,
  };
}

function detectNodePackageManager(scan: ScanResult, dir: string): AppCandidate["packageManager"] | undefined {
  const j = (f: string) => (dir ? `${dir}/${f}` : f);
  if (scan.byRel.has(j("pnpm-lock.yaml"))) return "pnpm";
  if (scan.byRel.has(j("yarn.lock"))) return "yarn";
  if (scan.byRel.has(j("bun.lockb")) || scan.byRel.has(j("bun.lock"))) return "bun";
  if (scan.byRel.has(j("package-lock.json"))) return "npm";
  const pkg = scan.byRel.get(j("package.json"));
  const pm = pkg?.content?.match(/"packageManager"\s*:\s*"(pnpm|yarn|npm|bun)@/)?.[1];
  return pm as AppCandidate["packageManager"] | undefined;
}

function nodeRunCommand(scan: ScanResult, dir: string, pm: NonNullable<AppCandidate["packageManager"]>, scripts: Record<string, string>, frameworks: string[], backend: Set<string>): RunCommand | null {
  const runner = (script: string): { cmd: string; args: string[] } => {
    if (pm === "pnpm") return { cmd: "pnpm", args: ["run", script] };
    if (pm === "yarn") return { cmd: "yarn", args: [script] };
    if (pm === "bun") return { cmd: "bun", args: ["run", script] };
    return { cmd: "npm", args: ["run", script] };
  };
  const installArgs = (): { cmd: string; args: string[] } => {
    if (pm === "pnpm") return { cmd: "pnpm", args: ["install", "--ignore-scripts", "--prefer-offline", "--reporter=silent"] };
    if (pm === "yarn") return { cmd: "yarn", args: ["install", "--ignore-scripts", "--non-interactive", "--silent"] };
    if (pm === "bun") return { cmd: "bun", args: ["install", "--ignore-scripts"] };
    return { cmd: "npm", args: ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"] };
  };
  const hasNodeModules = scan.files.length > 0 && false; // node_modules is never walked; always install.
  void hasNodeModules;

  const has = (s: string) => typeof scripts[s] === "string";
  const bad = (s: string) => /\b(docker|ssh|rm -rf|sudo|curl .*\|\s*sh|wget .*\|\s*sh)\b/.test(scripts[s] ?? "");
  const port = inferPort(scan, dir, scripts, frameworks);
  const env: Record<string, string> = { PORT: String(port), HOST: "127.0.0.1" };
  const mk = (script: string, reason: string): RunCommand => {
    const r = runner(script);
    const args = [...r.args];
    // Force dev servers onto our port when the framework supports a flag.
    if (frameworks.includes("Next.js") && /next dev/.test(scripts[script])) args.push("--", "-p", String(port));
    else if (frameworks.includes("Vite") && /^vite(\s|$)/.test(scripts[script]) && !frameworks.includes("SvelteKit")) args.push("--", "--port", String(port), "--strictPort", "--host", "127.0.0.1");
    else if (frameworks.includes("Astro") && /astro dev/.test(scripts[script])) args.push("--", "--port", String(port));
    else if (frameworks.includes("SvelteKit") && /vite dev/.test(scripts[script])) args.push("--", "--port", String(port), "--strictPort");
    else if (frameworks.includes("Angular") && /ng serve/.test(scripts[script])) args.push("--", "--port", String(port));
    else if (frameworks.includes("Nuxt") && /nuxt dev/.test(scripts[script])) args.push("--", "--port", String(port));
    return { cmd: r.cmd, args, cwd: dir, port, reason, install: { ...installArgs(), cwd: dir, reason: `${pm} install (scripts disabled)` }, env, openPath: "/" };
  };
  for (const s of ["dev", "start:dev", "serve", "develop", "start"]) {
    if (has(s) && !bad(s)) {
      if (s === "start" && /^(next|nuxt|remix-serve|node (dist|build)|serve -s)/.test(scripts[s]) && (has("dev") || frameworks.includes("Next.js"))) continue; // production start needs a build
      if (s === "start" && frameworks.includes("Next.js")) continue;
      return mk(s, `package.json script "${s}"`);
    }
  }
  if (frameworks.includes("Vite") || scan.byRel.has(path.posix.join(dir, "vite.config.ts")) || scan.byRel.has(path.posix.join(dir, "vite.config.js"))) {
    const r = installArgs();
    return { cmd: "npx", args: ["vite", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], cwd: dir, port, reason: "vite config without dev script", install: { ...r, cwd: dir, reason: "install" }, env, openPath: "/" };
  }
  if (backend.size && scripts.start) return mk("start", "backend start script");
  return null;
}

function inferPort(scan: ScanResult, dir: string, scripts: Record<string, string>, frameworks: string[]): number {
  const all = Object.values(scripts).join(" ");
  const m = all.match(/(?:--port|-p|PORT=)\s*=?\s*(\d{4,5})/);
  if (m) return +m[1];
  if (frameworks.includes("Next.js") || frameworks.includes("Remix") || frameworks.includes("Nuxt")) return 3000;
  if (frameworks.includes("Vite") || frameworks.includes("SvelteKit")) return 5173;
  if (frameworks.includes("Astro")) return 4321;
  if (frameworks.includes("Angular")) return 4200;
  if (frameworks.includes("Gatsby")) return 8000;
  return 3000;
}

function collectPythonDeps(scan: ScanResult): string[] {
  const out = new Set<string>();
  for (const f of scan.files) {
    if (!f.content) continue;
    const base = path.basename(f.rel).toLowerCase();
    if (/^requirements.*\.txt$/.test(base)) {
      for (const line of f.content.split(/\r?\n/)) {
        const name = line.trim().split(/[<>=!~\[;#\s]/)[0];
        if (name && !name.startsWith("-")) out.add(name.toLowerCase());
      }
    } else if (base === "pyproject.toml") {
      try {
        const data = parseToml(f.content) as Record<string, unknown>;
        const project = data.project as { dependencies?: string[]; "optional-dependencies"?: Record<string, string[]> } | undefined;
        for (const d of project?.dependencies ?? []) out.add(d.split(/[<>=!~\[;\s]/)[0].toLowerCase());
        const poetry = ((data.tool as Record<string, unknown> | undefined)?.poetry as { dependencies?: Record<string, unknown> } | undefined)?.dependencies;
        for (const d of Object.keys(poetry ?? {})) if (d !== "python") out.add(d.toLowerCase());
      } catch {
        for (const m of f.content.matchAll(/["']([a-zA-Z0-9_.-]+)(?:[<>=!~\[][^"']*)?["']/g)) out.add(m[1].toLowerCase());
      }
    } else if (base === "pipfile") {
      for (const m of f.content.matchAll(/^([a-zA-Z0-9_.-]+)\s*=/gm)) out.add(m[1].toLowerCase());
    }
  }
  return [...out];
}

function pythonApp(scan: ScanResult, backend: string[]): AppCandidate | null {
  const pyFiles = scan.files.filter((f) => f.ext === ".py" && f.content && !/(^|\/)(tests?|test_|conftest)/.test(f.rel));
  const findApp = (re: RegExp) => pyFiles.find((f) => re.test(f.content!));
  const reqs = scan.files.find((f) => /^requirements.*\.txt$/i.test(path.basename(f.rel)) && !f.rel.includes("/"))
    ?? scan.files.find((f) => /^requirements.*\.txt$/i.test(path.basename(f.rel)));
  const pyproject = scan.byRel.get("pyproject.toml");
  const install = reqs
    ? { cmd: "__pip__", args: ["-r", reqs.rel], cwd: "", reason: `pip install -r ${reqs.rel}` }
    : pyproject
      ? { cmd: "__pip__", args: ["-e", "."], cwd: "", reason: "pip install -e ." }
      : undefined;
  const mkRun = (cmd: string, args: string[], port: number, reason: string, openPath = "/"): RunCommand => ({ cmd, args, cwd: "", port, reason, install, env: { PORT: String(port) }, openPath });

  let run: RunCommand | null = null;
  let frameworks: string[] = [];
  const streamlit = findApp(/import streamlit|from streamlit/);
  const gradio = findApp(/import gradio|from gradio/);
  const fastapi = findApp(/FastAPI\(/);
  const flask = findApp(/Flask\(__name__\)|Flask\(/);
  const manage = scan.files.find((f) => /(^|\/)manage\.py$/.test(f.rel));
  const dash = findApp(/dash\.Dash\(|Dash\(__name__\)/);
  if (streamlit) {
    frameworks = ["Streamlit"];
    run = mkRun("__python__", ["-m", "streamlit", "run", streamlit.rel, "--server.port", "8501", "--server.headless", "true", "--browser.gatherUsageStats", "false"], 8501, `streamlit app ${streamlit.rel}`);
  } else if (gradio) {
    frameworks = ["Gradio"];
    run = mkRun("__python__", [gradio.rel], 7860, `gradio app ${gradio.rel}`);
    run.env = { ...run.env, GRADIO_SERVER_PORT: "7860", GRADIO_SERVER_NAME: "127.0.0.1" };
  } else if (fastapi) {
    frameworks = ["FastAPI"];
    const varName = fastapi.content!.match(/(\w+)\s*=\s*FastAPI\(/)?.[1] ?? "app";
    const module = fastapi.rel.replace(/\.py$/, "").replace(/\//g, ".");
    const mounts = fastapi.content!.match(/StaticFiles\(directory=["']([^"']+)["']/);
    const hasHtml = /HTMLResponse|Jinja2Templates|StaticFiles/.test(fastapi.content!);
    run = mkRun("__python__", ["-m", "uvicorn", `${module}:${varName}`, "--host", "127.0.0.1", "--port", "8000"], 8000, `FastAPI app in ${fastapi.rel}`, hasHtml ? "/" : "/docs");
    void mounts;
  } else if (manage) {
    frameworks = ["Django"];
    run = mkRun("__python__", [manage.rel, "runserver", "127.0.0.1:8000", "--noreload"], 8000, "Django manage.py runserver");
  } else if (dash) {
    frameworks = ["Dash"];
    run = mkRun("__python__", [dash.rel], 8050, `dash app ${dash.rel}`);
  } else if (flask) {
    frameworks = ["Flask"];
    run = mkRun("__python__", ["-m", "flask", "--app", flask.rel.replace(/\.py$/, ""), "run", "--host", "127.0.0.1", "--port", "5000"], 5000, `Flask app ${flask.rel}`);
  } else if (backend.length) {
    frameworks = backend;
  }
  if (!frameworks.length && !pyFiles.length) return null;
  const hasTemplates = scan.files.some((f) => /(^|\/)templates\/.*\.html$/.test(f.rel)) || (fastapi?.content?.includes("HTMLResponse") ?? false);
  const kind: AppCandidate["kind"] = run ? (hasTemplates || streamlit || gradio || dash ? "fullstack" : "backend") : "library";
  return {
    id: "python",
    dir: "",
    kind,
    frameworks,
    packageManager: pyproject && !reqs ? "uv" : "pip",
    scripts: {},
    runCommand: run,
    score: run ? (kind === "fullstack" ? 7 : 4) : 1,
    reasons: run ? [run.reason] : ["python package"],
  };
}

// ---------------------------------------------------------------------------
// Static route discovery
// ---------------------------------------------------------------------------

export function detectStaticRoutes(scan: ScanResult, app: AppCandidate | null): StaticRoute[] {
  const routes: StaticRoute[] = [];
  const base = app?.dir ?? "";
  const under = (p: string) => (base ? p.startsWith(base + "/") : true);
  const files = scan.files.filter((f) => under(f.rel));
  const rel = (p: string) => (base ? p.slice(base.length + 1) : p);

  // Next.js app router / pages router
  for (const f of files) {
    const r = rel(f.rel);
    let m = r.match(/^(?:src\/)?app\/(.*?)(?:\/)?page\.(tsx|jsx|ts|js|mdx)$/);
    if (m) {
      routes.push({ path: normalizeNextPath(m[1]), file: f.rel, kind: "page", framework: "Next.js", dynamic: /\[/.test(m[1]) });
      continue;
    }
    m = r.match(/^(?:src\/)?app\/(.*?)(?:\/)?route\.(tsx|ts|js)$/);
    if (m) {
      routes.push({ path: normalizeNextPath(m[1]), file: f.rel, kind: "api", framework: "Next.js", dynamic: /\[/.test(m[1]) });
      continue;
    }
    m = r.match(/^(?:src\/)?pages\/(.+)\.(tsx|jsx|ts|js|mdx|vue|svelte|astro|md)$/);
    if (m && !/^_/.test(path.posix.basename(m[1]))) {
      const p = m[1].replace(/(^|\/)index$/, "");
      const isApi = /^api\//.test(m[1]);
      routes.push({ path: "/" + p.replace(/\[\.\.\.(\w+)\]/g, "*").replace(/\[(\w+)\]/g, ":$1"), file: f.rel, kind: isApi ? "api" : "page", framework: files.some((x) => /astro\.config/.test(x.rel)) ? "Astro" : files.some((x) => /nuxt\.config/.test(x.rel)) ? "Nuxt" : "Next.js", dynamic: /\[/.test(m[1]) });
      continue;
    }
    // SvelteKit
    m = r.match(/^src\/routes\/(.*?)(?:\/)?\+page\.(svelte|ts|js)$/);
    if (m) {
      routes.push({ path: "/" + m[1].replace(/\(.*?\)\/?/g, "").replace(/\[(\w+)\]/g, ":$1"), file: f.rel, kind: "page", framework: "SvelteKit", dynamic: /\[/.test(m[1]) });
      continue;
    }
    // Remix flat routes
    m = r.match(/^app\/routes\/(.+)\.(tsx|jsx|ts|js)$/);
    if (m) {
      const p = m[1] === "_index" ? "" : m[1].replace(/\._index$/, "").replace(/\./g, "/").replace(/\$(\w+)/g, ":$1").replace(/^_[^/]+\//, "");
      routes.push({ path: "/" + p, file: f.rel, kind: "page", framework: "Remix", dynamic: /\$/.test(m[1]) });
      continue;
    }
    // Angular: routes.ts / app-routing.module.ts
    if (/(app[-.]routes?|routing\.module|app\.routes)\.ts$/.test(r) && f.content) {
      for (const mm of f.content.matchAll(/path\s*:\s*['"]([^'"]*)['"]/g)) routes.push({ path: "/" + mm[1].replace(/^\//, ""), file: f.rel, kind: "page", framework: "Angular", dynamic: /:/.test(mm[1]) });
      continue;
    }
    // React Router / Vue Router / TanStack in source
    if (f.content && /\.(tsx|jsx|ts|js|vue)$/.test(r) && !/\.(test|spec)\./.test(r)) {
      const c = f.content;
      if (/<Route\s/.test(c) || /createBrowserRouter|createRoutesFromElements|createHashRouter|createRouter\(|useRoutes\(/.test(c)) {
        for (const mm of c.matchAll(/<Route\b[^>]*\bpath\s*=\s*["'{]\s*["']?([^"'}]+)["'}]/g)) routes.push({ path: routerPath(mm[1]), file: f.rel, kind: "page", framework: "React Router", dynamic: /:/.test(mm[1]) });
        for (const mm of c.matchAll(/\{\s*path\s*:\s*["']([^"']+)["']/g)) routes.push({ path: routerPath(mm[1]), file: f.rel, kind: "page", framework: /vue/.test(r) || /vue-router/.test(c) ? "Vue Router" : "React Router", dynamic: /:/.test(mm[1]) });
      }
    }
    // Python routes (Flask/FastAPI/Django) — informational (api/page)
    if (f.ext === ".py" && f.content) {
      for (const mm of f.content.matchAll(/@(?:app|router|bp|blueprint|api)\.(get|post|put|delete|route|patch)\(\s*["']([^"']+)["']/g)) {
        const isPage = mm[1] === "get" || mm[1] === "route";
        routes.push({ path: mm[2], file: f.rel, kind: isPage && !/^\/api/.test(mm[2]) ? "page" : "api", framework: "Python", dynamic: /[{<:]/.test(mm[2]) });
      }
      for (const mm of f.content.matchAll(/path\(\s*["']([^"']*)["']/g)) routes.push({ path: "/" + mm[1], file: f.rel, kind: "page", framework: "Django", dynamic: /</.test(mm[1]) });
    }
    // Static html pages
    if (app?.kind === "static" && f.ext === ".html" && !/(^|\/)(node_modules|dist|build)\//.test(f.rel)) {
      const p = "/" + rel(f.rel).replace(/index\.html$/, "");
      routes.push({ path: p, file: f.rel, kind: "page", framework: "HTML", dynamic: false });
    }
  }
  // Dedupe by path, prefer pages.
  const seen = new Map<string, StaticRoute>();
  for (const r of routes) {
    const p = r.path.replace(/\/+/g, "/").replace(/(.)\/$/, "$1") || "/";
    r.path = p;
    if (!seen.has(p) || (seen.get(p)!.kind !== "page" && r.kind === "page")) seen.set(p, r);
  }
  return [...seen.values()].sort((a, b) => a.path.length - b.path.length).slice(0, 80);
}

function normalizeNextPath(segment: string): string {
  const p = segment
    .split("/")
    .filter((s) => s && !/^\(.*\)$/.test(s) && !/^@/.test(s))
    .map((s) => s.replace(/\[\[\.\.\.(\w+)\]\]/, "*").replace(/\[\.\.\.(\w+)\]/, "*").replace(/\[(\w+)\]/, ":$1"))
    .join("/");
  return "/" + p;
}

function routerPath(p: string): string {
  const t = p.trim();
  if (!t || t === "*") return "/";
  return t.startsWith("/") ? t : "/" + t;
}

export function findFile(scan: ScanResult, re: RegExp): ScannedFile | undefined {
  return scan.files.find((f) => re.test(f.rel));
}
