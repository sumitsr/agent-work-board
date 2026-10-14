// Synthetic Claude Code transcripts for the demo's Usage view: the same file layout and line shapes the
// real ones have, with made-up token counts and no real text. Deterministic (seeded), so stills repeat.
//
//   <dir>/-home-demo-Orbit/<session>.jsonl                         lead session, one per day
//   <dir>/-home-demo-Orbit/<session>/subagents/agent-<id>.jsonl    agent runs ("act exactly as <Name>")
//
//   node demo/fake-transcripts.mjs <dir>      then: AWB_CLAUDE_PROJECTS=<dir> node server.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CWD = "/home/demo/Orbit";
const MODELS = { Opus: "claude-opus-4-5", Sonnet: "claude-sonnet-4-5", Haiku: "claude-haiku-4-5" };
const AGENTS = [ // name, usual model, what their runs are about
  ["Rio", "Sonnet", ["Offline sync for saved trips", "Dark mode polish", "Trip card layout"]],
  ["Kai", "Opus", ["Rate limits for the public API", "Webhook retries", "Trips endpoint pagination"]],
  ["Wren", "Sonnet", ["App Store screenshots", "Onboarding flow", "Empty states"]],
  ["Ezra", "Haiku", ["Load test the trips endpoint", "Release checklist", "Regression pass"]],
  ["Lumi", "Sonnet", ["Landing page copy", "Help center articles", "Release notes"]],
  ["Pax", "Sonnet", ["Launch-day dashboard", "Funnel queries"]],
];

let seedValue = 20261014;
const rand = () => ((seedValue = (seedValue * 1103515245 + 12345) % 2147483648) / 2147483648);
const between = (lo, hi) => Math.round(lo + rand() * (hi - lo));
const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[between(0, 15)]).join("");

function lines(prompt, model, start, responses) {
  const out = [JSON.stringify({ type: "user", cwd: CWD, sessionId: hex(8), timestamp: new Date(start).toISOString(), message: { role: "user", content: prompt } })];
  let t = start;
  for (let i = 0; i < responses; i++) {
    t += between(20, 160) * 1000;
    const id = `msg_demo${hex(16)}`, requestId = `req_demo${hex(16)}`;
    const usage = { input_tokens: between(3, 40), cache_creation_input_tokens: between(400, 6000), cache_read_input_tokens: between(18000, 90000), output_tokens: between(80, 1400) };
    const line = { type: "assistant", cwd: CWD, timestamp: new Date(t).toISOString(), requestId, message: { id, type: "message", role: "assistant", model: MODELS[model], content: [{ type: "text", text: "(synthetic)" }], usage } };
    if (i % 3 === 0) out.push(JSON.stringify({ ...line, message: { ...line.message, usage: { ...usage, output_tokens: 1 } } })); // same response, earlier block
    out.push(JSON.stringify(line));
  }
  return out.join("\n") + "\n";
}

export function generate(dir, days = 14) {
  seedValue = 20261014;
  const project = join(dir, "-home-demo-Orbit");
  mkdirSync(project, { recursive: true });
  const now = Date.now();
  for (let d = days - 1; d >= 0; d--) {
    const midnight = new Date(now - d * 86400000); midnight.setHours(0, 0, 0, 0);
    // Today's work ends before now; earlier days run 08:30 to about 18:00.
    const dayStart = d === 0 ? Math.max(+midnight, now - 6 * 3600000) : +midnight + 8.5 * 3600000;
    const span = d === 0 ? now - dayStart - 10 * 60000 : 9 * 3600000;
    const quiet = [0, 6].includes(midnight.getDay()) ? 0.35 : 1; // weekends are lighter
    const session = `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
    writeFileSync(join(project, `${session}.jsonl`), lines("(synthetic lead session)", "Opus", dayStart, Math.round(between(28, 46) * quiet)));
    const runs = Math.max(1, Math.round(between(3, 6) * quiet));
    mkdirSync(join(project, session, "subagents"), { recursive: true });
    for (let r = 0; r < runs; r++) {
      const [name, model, topics] = AGENTS[between(0, AGENTS.length - 1)];
      const id = hex(16), start = dayStart + Math.round(rand() * span * 0.8);
      const base = join(project, session, "subagents", `agent-${id}`);
      writeFileSync(`${base}.jsonl`, lines(`You work on Orbit. Please act exactly as ${name}.`, rand() < 0.2 ? "Sonnet" : model, start, between(12, 48)));
      writeFileSync(`${base}.meta.json`, JSON.stringify({ description: topics[between(0, topics.length - 1)] }));
    }
  }
}

if (process.argv[1] === import.meta.filename) {
  if (!process.argv[2]) { console.error("usage: node demo/fake-transcripts.mjs <dir>"); process.exit(1); }
  generate(process.argv[2]);
  console.log(`wrote synthetic transcripts to ${process.argv[2]}`);
}
