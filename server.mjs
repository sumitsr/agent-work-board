// Agent Work Board, local edition: serves the board at http://127.0.0.1:4747 and pushes every change to
// open windows as it happens. State lives in data/board.json, written only by the `awb` command (awb.mjs).
// Node's standard library only; listens on the loopback interface, so nothing outside this Mac can reach it.
import { createServer } from "node:http";
import { readFileSync, watch, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scan, summary, readPrices } from "./usage.mjs";

const ROOT = import.meta.dirname;
const DATA_DIR = process.env.AWB_DATA || join(ROOT, "data"); // AWB_DATA: a scratch copy for testing
const STATE_FILE = join(DATA_DIR, "board.json");
const PORT = Number(process.env.AWB_PORT || 4747);
const HOST = "127.0.0.1";

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(STATE_FILE)) writeFileSync(STATE_FILE, JSON.stringify({ tasks: {}, team: {}, messages: [], needs: {}, events: [] }, null, 2));

const readState = () => {
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    const list = (value) => (Array.isArray(value) ? value : []);
    return { tasks: state.tasks || {}, team: state.team || {}, messages: list(state.messages), needs: state.needs || {}, events: list(state.events) };
  } catch {
    return null; // mid-write or damaged: keep serving the last good state
  }
};

let state = readState() || { tasks: {}, team: {}, messages: [], needs: {}, events: [] };
let usage = { loading: true, daily: [], runs: [], prices: null };
let current = { ...state, usage };
const clients = new Set();

const send = () => {
  current = { ...state, usage };
  const message = `data: ${JSON.stringify(current)}\n\n`;
  for (const res of clients) res.write(message);
};
const broadcast = async () => {
  const next = readState();
  if (!next) return;
  state = next;
  // data/prices.json lives in the watched folder; a new task can also move an agent run's usage to its workstream
  usage = usage.loading ? { ...usage, prices: await readPrices(DATA_DIR) } : { ...summary(state.tasks), scannedAt: usage.scannedAt, prices: await readPrices(DATA_DIR) };
  send();
};

// Token usage: read the transcripts' appended bytes every 30 s; push only when something changed.
const USAGE_EVERY = 30000;
const refreshUsage = async () => {
  try {
    const changed = await scan();
    if (changed || usage.loading) { usage = { ...summary(state.tasks), prices: await readPrices(DATA_DIR) }; send(); }
  } catch (error) {
    console.error("usage scan failed:", error.message);
  }
  setTimeout(refreshUsage, USAGE_EVERY);
};
refreshUsage();

// Writers replace the file atomically (write a temp file, then rename), so watch the folder, not the file.
let timer;
watch(DATA_DIR, () => {
  clearTimeout(timer);
  timer = setTimeout(broadcast, 60);
});

const page = () => readFileSync(join(ROOT, "public", "index.html"));

createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  if (url.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`data: ${JSON.stringify(current)}\n\n`);
    clients.add(res);
    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 25000);
    req.on("close", () => {
      clearInterval(keepAlive);
      clients.delete(res);
    });
    return;
  }
  if (url.pathname === "/api/usage") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(usage));
    return;
  }
  if (url.pathname === "/api/state") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(current));
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(page());
    return;
  }
  if (url.pathname === "/manifest.webmanifest") {
    res.writeHead(200, { "Content-Type": "application/manifest+json" });
    res.end(readFileSync(join(ROOT, "public", "manifest.webmanifest")));
    return;
  }
  if (url.pathname === "/icon.svg") {
    res.writeHead(200, { "Content-Type": "image/svg+xml" });
    res.end(readFileSync(join(ROOT, "public", "icon.svg")));
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}).listen(PORT, HOST, () => console.log(`Agent Work Board on http://${HOST}:${PORT}`));
