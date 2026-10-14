// A scripted, fictional ~40 s day on the board, driven only through the `awb` CLI, the way real agents post.
// Seeds a scratch board and synthetic transcripts, starts server.mjs on a scratch port, then plays the script.
// Your real board (data/) and real transcripts are never touched.
//
//   node demo/play.mjs                 → open the printed URL and watch; Ctrl-C to stop
//   node demo/play.mjs --exit          → stop the server when the script ends (used by record.mjs)
//   options: --port 4790  --delay 3 (seconds before the script starts)  --dir <scratch folder>
//
// Prints "VIEW <name>" cues on stdout so a recorder can switch views in step with the script.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seed } from "./seed.mjs";
import { generate } from "./fake-transcripts.mjs";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const ROOT = join(import.meta.dirname, "..");
const PORT = Number(arg("port", 4790));
const DELAY = Number(arg("delay", 3));
const DIR = arg("dir", mkdtempSync(join(tmpdir(), "awb-demo-")));
const DATA = join(DIR, "data"), PROJECTS = join(DIR, "projects");
const env = { ...process.env, AWB_DATA: DATA, AWB_PORT: String(PORT), AWB_CLAUDE_PROJECTS: PROJECTS };
const URL_ = `http://127.0.0.1:${PORT}/`;

const awb = (...args) => execFileSync(process.execPath, [join(ROOT, "awb.mjs"), ...args, "--quiet"], { env, stdio: "inherit" });
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString("en-CA"); // YYYY-MM-DD
const API = "Orbit · API", LAUNCH = "Orbit · Launch";

// [seconds from start, what happens]
const SCRIPT = [
  [0, () => console.log("VIEW overview")],
  [1.5, () => awb("task", "app-offline-sync", "--status", "running", "--progress", "10", "--stage", "Local store for saved trips")],
  [3.5, () => awb("task", "api-rate-limit", "--progress", "60", "--stage", "429 responses with Retry-After")],
  [5.5, () => awb("need", "store-screenshots", "--title", "Approve App Store screenshots", "--workstream", LAUNCH, "--due", day(2), "--question", "Lead with the light set or the dark set?", "--task", "launch-screenshots")],
  [7.5, () => console.log("VIEW office")],
  [8.5, () => awb("msg", "--from", "Wren", "--to", "Rio", "--text", "Screenshot frames ready: 6 sizes", "--task", "launch-screenshots")],
  [10, () => awb("task", "api-rate-limit", "--status", "review", "--progress", "100", "--stage", "Ready for load tests", "--msg-to", "Ezra", "--msg", "Rate limits are in: please load test")],
  [11.5, () => awb("task", "api-load-test", "--status", "running", "--progress", "15", "--stage", "Ramping to 2k requests/s")],
  [13, () => awb("msg", "--from", "Lumi", "--to", "Wren,Claude", "--text", "Captions updated for the new screenshots", "--task", "launch-screenshots")],
  [15, () => awb("msg", "--from", "Claude", "--to", "Pax", "--text", "Activation = first saved trip. Go ahead", "--task", "launch-metrics")],
  [16, () => { awb("need", "activation-event", "--resolve"); awb("task", "launch-metrics", "--status", "running", "--progress", "50", "--stage", "Activation funnel by day"); }],
  [18, () => console.log("VIEW overview")],
  [19, () => awb("event", "--kind", "pr", "--text", "PR 44 opened: rate limits", "--workstream", API, "--link", "PR 44|https://example.com/orbit/pull/44")],
  [21, () => awb("task", "api-load-test", "--progress", "70", "--stage", "p95 120 ms at 2k requests/s")],
  [23, () => awb("task", "api-load-test", "--status", "done", "--progress", "100", "--stage", "Passed", "--msg-to", "Kai,Claude", "--msg", "Load test passed: p95 120 ms")],
  [25, () => awb("task", "launch-screenshots", "--progress", "85", "--stage", "Dark set exported")],
  [26.5, () => { awb("event", "--kind", "pr", "--text", "PR 44 merged: rate limits", "--workstream", API, "--link", "PR 44|https://example.com/orbit/pull/44"); awb("task", "api-rate-limit", "--status", "done", "--stage", "Merged"); }],
  [28.5, () => console.log("VIEW usage")],
  [34, () => console.log("VIEW office")],
  [35, () => awb("task", "app-offline-sync", "--progress", "45", "--stage", "Conflict rules: last edit wins")],
  [36, () => awb("msg", "--from", "Rio", "--to", "Kai", "--text", "Can the trips API filter by updated-since?", "--task", "app-offline-sync")],
  [37.5, () => awb("msg", "--from", "Kai", "--to", "Rio", "--text", "Yes: GET /trips?since= is live", "--task", "app-offline-sync")],
  [39, () => awb("task", "launch-screenshots", "--status", "review", "--progress", "100", "--stage", "Ready for review", "--msg-to", "Claude", "--msg", "Screenshots ready for review")],
  [41.5, () => console.log("END")],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForUsage() {
  for (let i = 0; i < 100; i++) {
    try { const usage = await (await fetch(URL_ + "api/usage")).json(); if (!usage.loading) return; } catch {}
    await sleep(100);
  }
  throw new Error("the demo server did not start");
}

seed(DATA);
generate(PROJECTS);
const server = spawn(process.execPath, [join(ROOT, "server.mjs")], { env, stdio: ["ignore", "ignore", "inherit"] });
const stop = () => { server.kill(); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
await waitForUsage();
console.log(`READY ${URL_}  (scratch data: ${DIR})`);
await sleep(DELAY * 1000);
const start = Date.now();
for (const [seconds, step] of SCRIPT) {
  await sleep(start + seconds * 1000 - Date.now());
  step();
}
if (process.argv.includes("--exit")) stop();
console.log("Script done; the board stays up until Ctrl-C.");
