import type { Feature, Screen, UserFlow } from "../types.js";
import { slugify } from "../shared/text.js";

/**
 * User-flow analysis. Flows are ordered sequences of captured screens that
 * form a meaningful journey (entry → action → result). Ranking uses visual
 * quality, product importance, storytelling value (does it progress?), and
 * interaction richness — never opinions about the product itself.
 */

const STEP_ORDER: Array<[RegExp, number, string]> = [
  [/^\/$/, 0, "Landing"],
  [/(login|signin|sign-in|auth)/, 1, "Sign in"],
  [/(signup|sign-up|register|onboard)/, 1, "Sign up"],
  [/(dashboard|overview|home|app|workspace|feed|inbox)/, 2, "Dashboard"],
  [/(projects?|cases?|documents?|files?|items?|list|library|catalog|jobs?|tasks?|orders?|customers?|users?)$/, 3, "Browse"],
  [/(new|create|add|upload|import|compose|scan|analy[sz]e|generate|run|submit)/, 4, "Create / run"],
  [/(config|settings?|setup|options|preferences|rules?|policies|policy)/, 5, "Configure"],
  [/(results?|report|insights?|analytics|analysis|metrics|summary|review|graph|visuali|chart|explore|detail|view|output|history|logs?|alerts?|monitor)/, 6, "Results"],
  [/(chat|assistant|ask|copilot|agent)/, 4, "Chat"],
  [/(editor|studio|canvas|design|builder|compose)/, 4, "Edit"],
  [/(share|export|publish|deploy|download)/, 7, "Share"],
];

function stepFor(route: string): { order: number; label: string } {
  const r = route.toLowerCase();
  for (const [re, order, label] of STEP_ORDER) if (re.test(r)) return { order, label };
  return { order: 3.5, label: humanRoute(route) };
}

function humanRoute(route: string): string {
  const seg = (route.split("/").filter(Boolean).pop() ?? "Home").replace(/\.(html?|php)$/i, "");
  return seg.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function analyzeFlows(screens: Screen[], features: Feature[]): UserFlow[] {
  if (!screens.length) return [];
  const flows: UserFlow[] = [];
  const byRoute = new Map(screens.map((s) => [s.route, s]));

  // 1. The canonical product journey: entry → dashboard → action → result
  const ordered = screens
    .filter((s) => !s.dom.authWall || screens.length <= 2)
    .map((s) => ({ s, step: stepFor(s.route) }))
    .sort((a, b) => a.step.order - b.step.order || b.s.score - a.s.score);
  const journey: typeof ordered = [];
  const usedOrders = new Set<number>();
  for (const item of ordered) {
    if (usedOrders.has(item.step.order) && journey.length >= 2) continue;
    usedOrders.add(item.step.order);
    journey.push(item);
    if (journey.length >= 5) break;
  }
  if (journey.length >= 2) {
    flows.push(makeFlow("core-journey", "Core product journey", journey.map((j) => ({ screenId: j.s.id, label: j.step.label, action: j.s.interaction ? `click "${j.s.interaction.target}"` : undefined })), screens, ["Follows the product's natural entry → action → result order"]));
  }

  // 2. Feature-driven flows: features with a route → screen pair
  for (const f of features.filter((f) => f.route && byRoute.has(f.route!)).slice(0, 4)) {
    const screen = byRoute.get(f.route!)!;
    const entry = byRoute.get("/") ?? screens[0];
    if (entry.id === screen.id) continue;
    flows.push(makeFlow(`feature-${slugify(f.name)}`, `${f.name} flow`, [
      { screenId: entry.id, label: "Entry" },
      { screenId: screen.id, label: f.name, action: screen.interaction ? `click "${screen.interaction.target}"` : undefined },
    ], screens, [`Backed by ${f.evidence.length} source file(s): ${f.evidence.slice(0, 2).join(", ")}`]));
  }

  // 3. Navigation flow: sidebar/nav items in order (when there is a sidebar)
  const withSidebar = screens.filter((s) => s.dom.hasSidebar);
  if (withSidebar.length >= 3) {
    flows.push(makeFlow("navigation", "Navigating the workspace", withSidebar.slice(0, 4).map((s) => ({ screenId: s.id, label: humanRoute(s.route), action: "navigate" })), screens, ["Sidebar navigation across app sections"]));
  }

  // 4. Interaction flow: screens with captured interactions
  const interactive = screens.filter((s) => s.interaction);
  if (interactive.length) {
    const s = interactive[0];
    flows.push(makeFlow("interaction", `Interacting with ${humanRoute(s.route)}`, [
      { screenId: s.id, label: humanRoute(s.route) },
      { screenId: s.id, label: `After "${s.interaction!.target}"`, action: `click "${s.interaction!.target}"` },
    ], screens, ["Captured a real interaction state"]));
  }

  const seen = new Set<string>();
  return flows
    .filter((f) => {
      const key = f.steps.map((s) => s.screenId + (s.action ?? "")).join(">");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

function makeFlow(id: string, name: string, steps: UserFlow["steps"], screens: Screen[], rationale: string[]): UserFlow {
  const byId = new Map(screens.map((s) => [s.id, s]));
  const flowScreens = steps.map((s) => byId.get(s.screenId)!).filter(Boolean);
  const visual = flowScreens.reduce((a, s) => a + s.richness, 0) / Math.max(1, flowScreens.length);
  const importance = flowScreens.reduce((a, s) => a + s.importance, 0) / Math.max(1, flowScreens.length);
  const distinct = new Set(flowScreens.map((s) => s.id)).size;
  const story = Math.min(1, distinct / 3) * 0.7 + (steps.some((s) => s.action) ? 0.3 : 0);
  const interaction = Math.min(1, flowScreens.reduce((a, s) => a + s.dom.buttons.length + s.dom.inputs, 0) / 20);
  const score = Math.round((visual * 0.35 + importance * 0.3 + story * 0.2 + interaction * 0.15) * 100) / 100;
  return { id, name, steps, score, rationale: [...rationale, `visual ${visual.toFixed(2)} · importance ${importance.toFixed(2)} · story ${story.toFixed(2)} · interaction ${interaction.toFixed(2)}`] };
}
