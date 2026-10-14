#!/usr/bin/env node
// awb: post and update work on the local Agent Work Board (data/board.json). Used by the lead and by every
// agent, from any project. Writes are serialized with a lock folder and replace the file atomically.
//
//   awb task <id> [--workstream W] [--title T] [--agent A] [--role R] [--model M] [--status S] [--progress N]
//                 [--stage TEXT] [--detail TEXT] [--link "Label|https://..."] [--log TEXT] [--msg-to Name[,Name] --msg TEXT]
//   awb member <id> [--name N] [--role R] [--color #hex] [--skin #hex] [--hair #hex] [--order N] [--lead]
//   awb msg --from Kai --to Rio[,Wren] --text "Review done: 7 fixes" [--task <task-id>] [--workstream W]
//   awb need <id> --title T --workstream W [--due YYYY-MM-DD] [--question Q] [--link "Label|https://..."] [--task <task-id>] [--resolve]
//   awb event --kind pr|approval|block|note --text T [--workstream W] [--task <task-id>] [--link "Label|https://..."]
//   awb remove <task-id>        awb list        awb show <task-id>
//
// Every command prints one short line, or nothing with --quiet. Status changes and messages reach the
// timeline on their own; post `event` only for what the board can't see (a PR merged, an approval).
// AWB_DATA=/some/dir points the command (and server.mjs) at another data folder, e.g. a scratch copy for testing.
//
// Status is one of queued, running, blocked, review, done, failed, cancelled. Times are set for you:
// updatedAt on every change, startedAt when a task first runs, finishedAt when it ends.
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = import.meta.dirname;
const DATA_DIR = process.env.AWB_DATA || join(ROOT, "data");
const STATE_FILE = join(DATA_DIR, "board.json");
const LOCK = join(DATA_DIR, ".lock");
const STATUSES = ["queued", "running", "blocked", "review", "done", "failed", "cancelled"];
const FINISHED = ["done", "failed", "cancelled"];
const LOG_LIMIT = 20;
const HISTORY_LIMIT = 20;
let quiet = false;
const say = (line) => { if (!quiet) console.log(line); };

let holdingLock = false;
function fail(message) {
  console.error(`awb: ${message}`);
  if (holdingLock) try { rmdirSync(LOCK); } catch {} // process.exit skips withLock's finally
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const options = { links: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === "lead" || key === "resolve" || key === "quiet") {
      options[key] = true;
      continue;
    }
    const value = argv[++index];
    if (value === undefined) fail(`--${key} needs a value`);
    if (key === "link") options.links.push(value);
    else options[key] = value;
  }
  return { positional, options };
}

function withLock(work) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      mkdirSync(LOCK);
      holdingLock = true;
      break;
    } catch {
      // A lock older than 10 s belongs to a writer that died; take it over.
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > 10000) rmdirSync(LOCK);
      } catch {}
      if (Date.now() > deadline) fail("the board is busy; try again");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return work();
  } finally {
    holdingLock = false;
    try {
      rmdirSync(LOCK);
    } catch {}
  }
}

const load = () => {
  if (!existsSync(STATE_FILE)) return { tasks: {}, team: {}, messages: [], needs: {}, events: [] };
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  return { tasks: state.tasks || {}, team: state.team || {}, messages: state.messages || [], needs: state.needs || {}, events: state.events || [] };
};

const save = (state) => {
  const temp = `${STATE_FILE}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(state, null, 2));
  renameSync(temp, STATE_FILE);
};

const validId = (id) => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/.test(id);
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const parseLink = (link) => {
  const [label, url] = link.split("|");
  if (!/^https:\/\//.test(url || "")) fail('--link must be "Label|https://..."');
  return { label: label || "Link", url };
};
const addLinks = (links, extra) => extra.map(parseLink).reduce((all, link) => [...all.filter((l) => l.url !== link.url), link], links || []);

function upsertTask(id, options) {
  if (!validId(id)) fail("task id: letters, digits and . _ : - only");
  if (options.status && !STATUSES.includes(options.status)) fail(`status must be one of ${STATUSES.join(", ")}`);
  if (Boolean(options.msg) !== Boolean(options["msg-to"])) fail('--msg and --msg-to go together: --msg-to Claude --msg "..."');
  const now = new Date().toISOString();
  withLock(() => {
    const state = load();
    const task = state.tasks[id] || { workstream: "General", title: id, status: "queued", log: [], links: [] };
    for (const key of ["workstream", "title", "agent", "role", "model", "stage", "detail"]) if (options[key] !== undefined) task[key] = options[key];
    if (options.progress !== undefined) {
      const progress = Number(options.progress);
      if (!Number.isFinite(progress)) fail("--progress must be a number from 0 to 100");
      task.progress = Math.min(100, Math.max(0, progress));
    }
    if (options.status) {
      if (options.status !== task.status) task.history = [...(task.history || []), { at: now, status: options.status }].slice(-HISTORY_LIMIT);
      task.status = options.status;
      if (options.status === "running" && !task.startedAt) task.startedAt = now;
      if (FINISHED.includes(options.status)) task.finishedAt = now;
      else delete task.finishedAt;
    }
    task.links = addLinks(task.links, options.links);
    if (options.log) task.log = [...(task.log || []), { at: now, text: options.log }].slice(-LOG_LIMIT);
    task.updatedAt = now;
    state.tasks[id] = task;
    if (options.msg) addMessage(state, { from: options.from || task.agent || "Agent", to: options["msg-to"], text: options.msg, task: id });
    save(state);
    say(`awb: ${id} → ${task.status}${options.msg ? " + message" : ""}`);
  });
}

function upsertMember(id, options) {
  if (!validId(id)) fail("member id: letters, digits and . _ : - only");
  withLock(() => {
    const state = load();
    const member = state.team[id] || { name: id };
    for (const key of ["name", "role", "color", "skin", "hair"]) if (options[key] !== undefined) member[key] = options[key];
    if (options.order !== undefined) member.order = Number(options.order);
    if (options.lead) member.lead = true;
    state.team[id] = member;
    save(state);
    say(`awb: member ${id} saved`);
  });
}

// A message between agents (a hand-off, a review, a question). Kept as the last MESSAGE_LIMIT messages.
const MESSAGE_LIMIT = 300;
function addMessage(state, { from, to, text, task, workstream }) {
  const message = { id: newId(), at: new Date().toISOString(), from: from.trim(), to: to.split(",").map((name) => name.trim()).filter(Boolean), text };
  if (task) message.task = task;
  const stream = workstream || state.tasks[task]?.workstream;
  if (stream) message.workstream = stream;
  state.messages = [...(state.messages || []), message].slice(-MESSAGE_LIMIT);
  return message;
}
function postMessage(options) {
  if (!options.from || !options.to || !options.text) fail('msg needs --from Name --to Name[,Name] --text "..." [--task id]');
  withLock(() => {
    const state = load();
    const message = addMessage(state, options);
    save(state);
    say(`awb: message ${message.from} → ${message.to.join(", ")}`);
  });
}

// A decision waiting on you. --resolve keeps it (for the timeline) but takes it off "Needs you".
function upsertNeed(id, options) {
  if (!validId(id)) fail("need id: letters, digits and . _ : - only");
  if (options.due !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(options.due)) fail("--due must be YYYY-MM-DD");
  const now = new Date().toISOString();
  withLock(() => {
    const state = load();
    if (!state.needs[id] && options.resolve && !options.title) fail(`no need called ${id}`);
    const need = state.needs[id] || { title: id, workstream: "General", status: "open", links: [], createdAt: now };
    for (const key of ["title", "workstream", "due", "question", "task"]) if (options[key] !== undefined) need[key] = options[key];
    if (options.workstream === undefined && !state.needs[id] && state.tasks[need.task]) need.workstream = state.tasks[need.task].workstream;
    need.links = addLinks(need.links, options.links);
    if (options.resolve && need.status !== "resolved") Object.assign(need, { status: "resolved", resolvedAt: now });
    need.updatedAt = now;
    state.needs[id] = need;
    save(state);
    say(`awb: need ${id} → ${need.status}`);
  });
}

// A timeline event (a PR opened or merged, an approval, a block, a note). Kept as the last EVENT_LIMIT.
const EVENT_KINDS = ["pr", "approval", "block", "note"];
const EVENT_LIMIT = 300;
function postEvent(options) {
  if (!EVENT_KINDS.includes(options.kind) || !options.text) fail(`event needs --kind ${EVENT_KINDS.join("|")} --text "..." [--workstream W] [--task id] [--link "Label|https://..."]`);
  withLock(() => {
    const state = load();
    const event = { id: newId(), at: new Date().toISOString(), kind: options.kind, text: options.text };
    if (options.task) event.task = options.task;
    const workstream = options.workstream || state.tasks[options.task]?.workstream;
    if (workstream) event.workstream = workstream;
    if (options.links.length) event.link = parseLink(options.links[0]);
    state.events = [...state.events, event].slice(-EVENT_LIMIT);
    save(state);
    say(`awb: event ${event.kind}`);
  });
}

const { positional, options } = parseArgs(process.argv.slice(2));
quiet = options.quiet === true;
const [command, id] = positional;
if (command === "msg") postMessage(options);
else if (command === "event") postEvent(options);
else if (command === "need" && id) upsertNeed(id, options);
else if (command === "task" && id) upsertTask(id, options);
else if (command === "member" && id) upsertMember(id, options);
else if (command === "remove" && id) withLock(() => {
  const state = load();
  delete state.tasks[id];
  save(state);
  say(`awb: removed ${id}`);
});
else if (command === "list") {
  const state = load();
  for (const [taskId, task] of Object.entries(state.tasks)) console.log(`${task.status.padEnd(9)} ${String(task.agent || "-").padEnd(10)} ${taskId}  ${task.stage || task.title}`);
  for (const [needId, need] of Object.entries(state.needs)) if (need.status === "open") console.log(`need      ${String(need.due || "-").padEnd(10)} ${needId}  ${need.title}`);
} else if (command === "show" && id) console.log(JSON.stringify(load().tasks[id] ?? null, null, 2));
else fail('usage: awb task <id> [--status S] [--stage T] ... | awb msg --from A --to B --text "..." | awb need <id> --title T ... [--resolve] | awb event --kind K --text "..." | awb member <id> ... | awb remove <id> | awb list | awb show <id>');
