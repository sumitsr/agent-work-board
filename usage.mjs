// Token usage from Claude Code's own transcripts (~/.claude/projects), read locally at zero token cost.
// Each file is read incrementally (byte offsets; only appended bytes are re-read). Only numbers leave this
// module: who, which model, which workstream, when, and token counts. Transcript text never does.
//
//   lead session:  <projects>/<project-dir>/<session>.jsonl                      → "Claude (lead)"
//   agent run:     <projects>/<project-dir>/<session>/subagents/agent-<id>.jsonl → the member named in
//                  "act exactly as <Name>" in its first prompt, else "Agent". Its workstream is that of the board task
//                  the prompt names ("awb task <id>"), because every agent run is stored under the lead's project.
//
// Self-check: `node usage.mjs <file.jsonl>` prints that file's deduplicated totals.
import { readFileSync } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const PROJECTS = process.env.AWB_CLAUDE_PROJECTS || join(homedir(), ".claude", "projects");
const CHUNK = 8 * 1024 * 1024;
const DAYS_KEPT = 62; // covers "this month" and the daily chart
const RUNS_KEPT = 300;
const HOME = homedir();
// Optional names for project folders: <data>/workstreams.json, e.g. { "~/Code/orbit": "Orbit" } (cwd prefix → workstream).
// Anything not listed is named after its folder. Read once at start; restart the server after editing it.
const DATA_DIR = process.env.AWB_DATA || join(import.meta.dirname, "data");
const WORKSTREAMS = (() => {
  try {
    return Object.entries(JSON.parse(readFileSync(join(DATA_DIR, "workstreams.json"), "utf8"))).map(([prefix, name]) => [prefix.replace(/^~(?=\/|$)/, HOME), String(name)]);
  } catch { return []; }
})();

const files = new Map(); // path → { offset, lead, member, label, cwd, dir, checkedPrompt }
const records = new Map(); // message.id + requestId → { file, at, model, input, output, cacheWrite, cacheRead }

export const family = (model) => {
  const m = String(model).toLowerCase();
  return m.includes("opus") ? "Opus" : m.includes("sonnet") ? "Sonnet" : m.includes("haiku") ? "Haiku" : m.includes("fable") ? "Fable" : String(model);
};
const localDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// Agent runs live under the lead session's project folder, so the board task they were briefed on says more.
function workstreamOf(file, tasks) {
  for (const id of file.taskIds || []) if (tasks[id]?.workstream) return String(tasks[id].workstream);
  const cwd = file.cwd;
  if (cwd) {
    const hit = WORKSTREAMS.find(([prefix]) => cwd === prefix || cwd.startsWith(prefix + "/"));
    if (hit) return hit[1];
    if (cwd === HOME) return "Home";
    const name = basename(cwd);
    return name.startsWith("GoogleDrive-") ? "Google Drive" : name;
  }
  const encoded = HOME.replace(/[^A-Za-z0-9]/g, "-");
  const hit = WORKSTREAMS.find(([prefix]) => { const p = prefix.replace(/[^A-Za-z0-9]/g, "-"); return file.dir === p || file.dir.startsWith(p + "-"); });
  return hit ? hit[1] : file.dir.slice(encoded.length).replace(/^-(Code-)?/, "") || "Home";
}

function promptText(content) {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map((block) => (block && typeof block.text === "string" ? block.text : "")).join(" ") : "";
}

function handleLine(path, file, line) {
  if (!file.cwd) { const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(line); if (m) try { file.cwd = JSON.parse(`"${m[1]}"`); } catch {} }
  if (!file.lead && !file.checkedPrompt && line.includes('"type":"user"')) {
    file.checkedPrompt = true;
    try {
      const prompt = promptText(JSON.parse(line).message?.content);
      file.member = /act exactly as ([A-Z][A-Za-z]+)/.exec(prompt)?.[1] || "Agent";
      file.taskIds = [...new Set([...prompt.matchAll(/\bawb(?:\.mjs)?\s+task\s+([A-Za-z0-9][\w-]*)/g)].map((m) => m[1]))].slice(0, 8); // first one on the board wins
    } catch {}
  }
  if (!line.includes('"type":"assistant"') || !line.includes('"usage"')) return;
  let entry;
  try { entry = JSON.parse(line); } catch { return; }
  const message = entry.message, usage = message?.usage;
  if (entry.type !== "assistant" || !usage || !message.model || message.model === "<synthetic>") return;
  const at = Date.parse(entry.timestamp);
  if (!Number.isFinite(at)) return;
  const n = (v) => (Number.isFinite(v) ? v : 0);
  // The same response is written once per content block; the last copy carries the final output count.
  records.set(`${message.id}|${entry.requestId}`, { file: path, at, model: family(message.model),
    input: n(usage.input_tokens), output: n(usage.output_tokens), cacheWrite: n(usage.cache_creation_input_tokens), cacheRead: n(usage.cache_read_input_tokens) });
}

async function readAppended(path, file, size) {
  const handle = await open(path, "r");
  try {
    let position = file.offset, carry = Buffer.alloc(0);
    while (position < size) {
      const buffer = Buffer.allocUnsafe(Math.min(CHUNK, size - position));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      const data = carry.length ? Buffer.concat([carry, buffer.subarray(0, bytesRead)]) : buffer.subarray(0, bytesRead);
      const last = data.lastIndexOf(10);
      if (last < 0) { carry = data; continue; }
      for (const line of data.subarray(0, last).toString("utf8").split("\n")) if (line) handleLine(path, file, line);
      carry = data.subarray(last + 1);
      file.offset = position - carry.length; // a half-written last line is read again next time
      await new Promise(setImmediate); // stay responsive while reading a large transcript
    }
  } finally {
    await handle.close();
  }
}

async function list(dir) { try { return await readdir(dir, { withFileTypes: true }); } catch { return []; } }

async function transcripts() {
  const found = [];
  for (const project of await list(PROJECTS)) {
    if (!project.isDirectory()) continue;
    const dir = join(PROJECTS, project.name);
    for (const entry of await list(dir)) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push({ path: join(dir, entry.name), dir: project.name, lead: true });
      else if (entry.isDirectory()) for (const agent of await list(join(dir, entry.name, "subagents")))
        if (agent.isFile() && /^agent-.*\.jsonl$/.test(agent.name)) found.push({ path: join(dir, entry.name, "subagents", agent.name), dir: project.name, lead: false });
    }
  }
  return found;
}

// One pass: read whatever was appended since last time. Returns true when anything changed.
export async function scan() {
  let changed = false;
  for (const { path, dir, lead } of await transcripts()) {
    let size;
    try { size = (await stat(path)).size; } catch { continue; }
    let file = files.get(path);
    if (file && size < file.offset) { // rewritten: forget it and read it again
      for (const [key, record] of records) if (record.file === path) records.delete(key);
      file = undefined;
    }
    if (!file) {
      file = { offset: 0, lead, dir, member: lead ? "Claude (lead)" : "Agent", label: "", cwd: "", checkedPrompt: false };
      if (!lead) try { file.label = String(JSON.parse(await readFile(path.replace(/\.jsonl$/, ".meta.json"), "utf8")).description || "").slice(0, 90); } catch {}
      files.set(path, file);
    }
    if (size > file.offset) { await readAppended(path, file, size); changed = true; }
  }
  return changed;
}

const ZERO = () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, calls: 0 });
const add = (into, r) => { into.input += r.input; into.output += r.output; into.cacheWrite += r.cacheWrite; into.cacheRead += r.cacheRead; into.calls += 1; return into; };

// Aggregates only: daily rows (day × workstream × model × member) and one row per run.
export function summary(tasks = {}) {
  const since = Date.now() - DAYS_KEPT * 86400000;
  const daily = new Map(), runs = new Map();
  for (const r of records.values()) {
    if (r.at < since) continue;
    const file = files.get(r.file), workstream = workstreamOf(file, tasks), day = localDay(r.at);
    const key = [day, workstream, r.model, file.member].join("|");
    if (!daily.has(key)) daily.set(key, { day, workstream, model: r.model, member: file.member, ...ZERO() });
    add(daily.get(key), r);
    if (!runs.has(r.file)) runs.set(r.file, { id: basename(r.file, ".jsonl"), member: file.member, lead: file.lead, label: file.label, workstream, start: r.at, end: r.at, models: {}, ...ZERO() });
    const run = add(runs.get(r.file), r);
    run.start = Math.min(run.start, r.at); run.end = Math.max(run.end, r.at);
    run.models[r.model] = (run.models[r.model] || 0) + r.output + r.input;
  }
  const runList = [...runs.values()].sort((a, b) => b.end - a.end).slice(0, RUNS_KEPT).map(({ models, start, end, ...run }) => ({
    ...run, model: Object.entries(models).sort((a, b) => b[1] - a[1])[0]?.[0] || "", start: new Date(start).toISOString(), end: new Date(end).toISOString() }));
  return { scannedAt: new Date().toISOString(), daily: [...daily.values()], runs: runList };
}

// Rates per million tokens, only if you added data/prices.json; never invented here.
export async function readPrices(dataDir) {
  try {
    const raw = JSON.parse(await readFile(join(dataDir, "prices.json"), "utf8"));
    const models = {};
    for (const [name, rate] of Object.entries(raw.models || {})) {
      const r = { input: rate?.input, output: rate?.output, cacheWrite: rate?.cacheWrite, cacheRead: rate?.cacheRead };
      if (Object.values(r).every(Number.isFinite)) models[name] = r;
    }
    const source = typeof raw.source === "string" && /^https:\/\//.test(raw.source) ? raw.source : null;
    return Object.keys(models).length ? { models, source, checked: String(raw.checked || ""), currency: String(raw.currency || "USD") } : null;
  } catch {
    return null;
  }
}

if (process.argv[1] === import.meta.filename && process.argv[2]) {
  const path = process.argv[2], file = { offset: 0, lead: true, dir: "", member: "", label: "", cwd: "", checkedPrompt: true };
  files.set(path, file);
  await readAppended(path, file, (await stat(path)).size);
  const total = ZERO(), byModel = {};
  for (const r of records.values()) { add(total, r); add((byModel[r.model] ||= ZERO()), r); }
  console.log(JSON.stringify({ total, byModel }));
}
