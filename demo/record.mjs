// Records the scripted demo (play.mjs) in a headless Chrome at 1440×900, through the DevTools protocol
// (Node's built-in WebSocket; no packages). Needs Node 22+, ffmpeg, and a Chrome or chrome-headless-shell binary.
//
//   CHROME=/path/to/chrome-headless-shell node demo/record.mjs            → demo/out/agent-work-board-demo.mp4
//   CHROME=... node demo/record.mjs --stills                              → docs/media/overview.png, office.png, usage.png
//   then: demo/loop.sh (the README loop, cut from the recording)
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(import.meta.dirname, "out"), FRAMES = join(OUT, "frames");
const STILLS = process.argv.includes("--stills");
const W = 1440, H = 900, FPS = 30, PORT = 4790, DEBUG_PORT = 9339;
// Stills: [cue#occurrence, seconds after it, file]. The office still lands while an envelope is in flight.
const SHOTS = [["VIEW overview#2", 6.5, "overview.png"], ["VIEW office#1", 3, "office.png"], ["VIEW usage#1", 3, "usage.png"]];
const seen = new Map();
if (!process.env.CHROME) { console.error("Set CHROME to a Chrome or chrome-headless-shell binary."); process.exit(1); }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = mkdtempSync(join(tmpdir(), "awb-chrome-"));
const chrome = spawn(process.env.CHROME, [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`,
  "--hide-scrollbars", "--force-device-scale-factor=1", "--no-first-run", "--mute-audio", "about:blank"], { stdio: "ignore" });

let target;
for (let i = 0; i < 100 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch { await sleep(100); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
let nextId = 0;
const pending = new Map(), listeners = new Map();
ws.addEventListener("message", ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  else if (msg.method) listeners.get(msg.method)?.(msg.params);
});
const send = (method, params = {}) => new Promise((resolve) => { const id = ++nextId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const show = (view) => send("Runtime.evaluate", { expression: `document.querySelector('.nav-item[data-view="${view}"]').click(); scrollTo(0, 0)` });

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const frames = [];
if (!STILLS) {
  rmSync(FRAMES, { recursive: true, force: true }); mkdirSync(FRAMES, { recursive: true });
  listeners.set("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    send("Page.screencastFrameAck", { sessionId });
    if (!recording) return;
    const file = join(FRAMES, `f${String(frames.length).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, at: metadata.timestamp });
  });
}
let recording = false;

const play = spawn(process.execPath, [join(import.meta.dirname, "play.mjs"), "--exit", "--delay", "2", "--port", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
for await (const line of createInterface({ input: play.stdout })) {
  if (line.startsWith("READY")) {
    await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
    await sleep(1500); // first paint and the live stream
    if (!STILLS) { recording = true; await send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 }); }
  } else if (line.startsWith("VIEW ")) {
    await show(line.slice(5));
    seen.set(line, (seen.get(line) || 0) + 1);
    for (const [cue, after, file] of STILLS ? SHOTS : []) if (cue === `${line}#${seen.get(line)}`) setTimeout(async () => {
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      mkdirSync(join(ROOT, "docs", "media"), { recursive: true });
      writeFileSync(join(ROOT, "docs", "media", file), Buffer.from(data, "base64"));
      console.log(`still: docs/media/${file}`);
    }, after * 1000);
  } else if (line.startsWith("END")) {
    await sleep(800);
    break;
  }
}
if (!STILLS) await send("Page.stopScreencast");
recording = false;
ws.close(); chrome.kill(); play.kill();
rmSync(profile, { recursive: true, force: true });

if (!STILLS) {
  // Frames arrive only when the page repaints: hold each one until the next, then resample to a steady 30 fps.
  const list = frames.map((f, i) => `file '${f.file}'\nduration ${((frames[i + 1]?.at ?? f.at + 1 / FPS) - f.at).toFixed(4)}`).join("\n") + `\nfile '${frames.at(-1).file}'\n`;
  writeFileSync(join(FRAMES, "list.txt"), list);
  const mp4 = join(OUT, "agent-work-board-demo.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(FRAMES, "list.txt"),
    "-vf", `fps=${FPS},format=yuv420p`, "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", mp4], { stdio: "inherit" });
  console.log(`video: ${mp4} (${frames.length} captured frames)`);
}
