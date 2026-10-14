// Demo board for a made-up product team building "Orbit", a trip-planning app. Every name, task and figure
// here is fictional. Writes <dir>/board.json with times relative to now, so the board looks like a real day.
//
//   node demo/seed.mjs <dir>      (play.mjs calls seed() for you)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();
const day = (daysFromNow) => { const d = new Date(Date.now() + daysFromNow * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export const TEAM = {
  claude: { name: "Claude", role: "Lead", lead: true, color: "#f2b44c", order: 0 },
  rio: { name: "Rio", role: "Mobile engineer", color: "#6cc6ff", order: 1 },
  kai: { name: "Kai", role: "API engineer", color: "#64e3aa", order: 2 },
  wren: { name: "Wren", role: "Product designer", color: "#e0679a", order: 3 },
  ezra: { name: "Ezra", role: "QA and release", color: "#c79bff", order: 4 },
  lumi: { name: "Lumi", role: "Docs and launch copy", color: "#ffd27a", order: 5 },
  pax: { name: "Pax", role: "Data and analytics", color: "#ff9a76", order: 6 },
};

const APP = "Orbit · App", API = "Orbit · API", LAUNCH = "Orbit · Launch";

// A task with a status history: [[status, minutesAgo], ...]; the last entry is the current status.
function task(workstream, title, agent, model, steps, extra = {}) {
  const history = steps.map(([status, m]) => ({ at: at(m), status }));
  const last = history.at(-1), started = history.find((h) => h.status === "running");
  const t = { workstream, title, agent, role: TEAM[agent.toLowerCase()].role, model, status: last.status, history, log: [], links: [], updatedAt: last.at, ...extra };
  if (started) t.startedAt = started.at;
  if (["done", "failed", "cancelled"].includes(last.status)) t.finishedAt = last.at;
  return t;
}
const log = (...entries) => entries.map(([m, text]) => ({ at: at(m), text }));

export function board() {
  return {
    team: TEAM,
    tasks: {
      "app-dark-mode": task(APP, "Dark mode polish", "Rio", "Sonnet", [["running", 1640], ["review", 1500], ["done", 1460]], { progress: 100, stage: "Shipped in 2.3", log: log([1520, "Contrast fixed on trip cards"]) }),
      "app-onboarding": task(APP, "Onboarding flow", "Wren", "Opus", [["running", 420], ["review", 260], ["done", 190]], { progress: 100, stage: "Approved", log: log([300, "Three screens, one skippable"]) }),
      "app-offline-sync": task(APP, "Offline sync for saved trips", "Rio", "Sonnet", [["queued", 120]], { progress: 0, stage: "Up next after dark mode" }),
      "api-webhooks": task(API, "Webhook retries with backoff", "Kai", "Sonnet", [["running", 380], ["done", 240]], { progress: 100, stage: "Merged", log: log([300, "Retries capped at 6 with jitter"]) }),
      "api-rate-limit": task(API, "Rate limits for the public API", "Kai", "Opus", [["running", 75]], { progress: 35, stage: "Token bucket per API key", log: log([40, "Buckets in Redis; 429 with Retry-After"]) }),
      "api-load-test": task(API, "Load test the trips endpoint", "Ezra", "Haiku", [["queued", 60]], { progress: 0, stage: "Waiting for rate limits" }),
      "launch-landing": task(LAUNCH, "Landing page copy", "Lumi", "Sonnet", [["running", 150], ["review", 22]], { progress: 100, stage: "Draft ready for review", links: [{ label: "Draft", url: "https://example.com/orbit/landing-draft" }] }),
      "launch-screenshots": task(LAUNCH, "App Store screenshots", "Wren", "Sonnet", [["running", 95]], { progress: 55, stage: "Six sizes, light and dark" }),
      "launch-metrics": task(LAUNCH, "Launch-day dashboard", "Pax", "Sonnet", [["running", 110], ["blocked", 30]], { progress: 40, stage: "Needs: which event counts as activation" }),
    },
    needs: {
      "app-icon": { title: "Choose the app icon", workstream: APP, status: "resolved", links: [], createdAt: at(1700), resolvedAt: at(1450), updatedAt: at(1450) },
      "activation-event": { title: "Pick the activation event", workstream: LAUNCH, due: day(1), question: "First saved trip, or first shared trip?", task: "launch-metrics", status: "open", links: [], createdAt: at(30), updatedAt: at(30) },
      "launch-price": { title: "Approve the launch price", workstream: LAUNCH, due: day(3), question: "Free plan with 3 saved trips or 5?", status: "open", links: [{ label: "Pricing note", url: "https://example.com/orbit/pricing" }], createdAt: at(200), updatedAt: at(200) },
    },
    messages: [
      { id: "m1", at: at(1490), from: "Rio", to: ["Claude"], text: "Dark mode done: 14 screens checked", task: "app-dark-mode", workstream: APP },
      { id: "m2", at: at(265), from: "Wren", to: ["Claude", "Rio"], text: "Onboarding ready for review", task: "app-onboarding", workstream: APP },
      { id: "m3", at: at(242), from: "Kai", to: ["Ezra"], text: "Webhooks merged; retry tests are in", task: "api-webhooks", workstream: API },
      { id: "m4", at: at(24), from: "Lumi", to: ["Claude"], text: "Landing copy draft is up", task: "launch-landing", workstream: LAUNCH },
    ],
    events: [
      { id: "e1", at: at(1462), kind: "pr", text: "PR 38 merged: dark mode polish", workstream: APP, link: { label: "PR 38", url: "https://example.com/orbit/pull/38" } },
      { id: "e2", at: at(238), kind: "pr", text: "PR 41 merged: webhook retries", workstream: API, link: { label: "PR 41", url: "https://example.com/orbit/pull/41" } },
      { id: "e3", at: at(190), kind: "approval", text: "Onboarding flow approved", workstream: APP },
    ],
  };
}

export function seed(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "board.json"), JSON.stringify(board(), null, 2));
}

if (process.argv[1] === import.meta.filename) {
  if (!process.argv[2]) { console.error("usage: node demo/seed.mjs <dir>"); process.exit(1); }
  seed(process.argv[2]);
  console.log(`seeded ${join(process.argv[2], "board.json")}`);
}
