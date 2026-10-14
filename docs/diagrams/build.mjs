// Builds the README diagrams in the board's own glass style: <name>.svg (static), <name>-animated.svg
// (flowing wires and a traveling pulse, still under prefers-reduced-motion) and <name>.png (2x).
// Node's standard library only. PNGs need a Chrome or chrome-headless-shell binary:
//
//   CHROME=/path/to/chrome-headless-shell node docs/diagrams/build.mjs
//
// Every diagram is drawn on an 880-unit-wide canvas (GitHub's README width), so a font size here is the
// size a reader sees. Colors, radii and type come from public/index.html.
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = import.meta.dirname;
const W = 880;
const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Inter, system-ui, sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const C = { ink: "#ffffff", ink2: "rgba(255,255,255,0.78)", ink3: "rgba(255,255,255,0.58)", cta: "#ffd84a", ctaInk: "#24173a", link: "#8fe0ff",
  run: "#6cc6ff", review: "#d4b4ff", blocked: "#ff8496", done: "#64e3aa", queued: "#ffd27a" };
// The backdrop of the view each diagram is about (body[data-view] in public/index.html).
const THEMES = {
  overview: { top: "#2f8a92", mid: "#2d5b88", bottom: "#232a5c", glow: "#6fe8cf", a: "#7ff0d8", b: "#2a8fb8" },
  office: { top: "#d9706f", mid: "#8a4f86", bottom: "#34386f", glow: "#ff9c7a", a: "#ff9a76", b: "#e2576f" },
  usage: { top: "#b8703f", mid: "#7b4672", bottom: "#2b2a5e", glow: "#ffc36b", a: "#ffd28a", b: "#e0803c" },
};
const ICONS = {
  terminal: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5"/>',
  send: '<path d="M4 11.5L20 4l-5.5 16-3-6.5z"/><path d="M11.5 13.5L20 4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  folder: '<path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  server: '<rect x="4" y="4" width="16" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="16" height="6.5" rx="1.6"/><path d="M8 7.25h.01M8 16.75h.01"/>',
  bars: '<path d="M3 20h18M6 17v-5M11 17V6M16 17v-8M20 17v-3"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  power: '<path d="M12 3v8"/><path d="M6.6 7a7.5 7.5 0 1 0 10.8 0"/>',
  scan: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
  read: '<path d="M4 6h16M4 11h11M4 16h6"/><path d="M15 15l3 3-3 3"/>',
  braces: '<path d="M9 4c-2.5 0-3 1.5-3 3.5S5 11 3.5 12C5 13 6 14.5 6 16.5S6.5 20 9 20M15 4c2.5 0 3 1.5 3 3.5s1 3.5 2.5 4.5c-1.5 1-2.5 2.5-2.5 4.5S17.5 20 15 20"/>',
  filter: '<path d="M4 5h16l-6 7.5V18l-4 2v-7.5z"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  sigma: '<path d="M18 5H6l6 7-6 7h12"/>',
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Rough text widths (SF Pro / SF Mono), used only to warn when a label would not fit its box.
const width = (s, size, mono) => String(s).length * size * (mono ? 0.602 : 0.52);
const warnings = [];
const fit = (s, size, mono, room, where) => { if (width(s, size, mono) > room) warnings.push(`${where}: "${s}" ~${Math.round(width(s, size, mono))} px > ${room}`); };

function text(x, y, s, { size = 12, weight = 400, color = C.ink2, mono = false, anchor = "start", room, where = "text" } = {}) {
  if (room) fit(s, size, mono, room, where);
  return `<text x="${x}" y="${y}" font-family="${mono ? MONO : FONT}" font-size="${size}" font-weight="${weight}" fill="${color}"${anchor !== "start" ? ` text-anchor="${anchor}"` : ""}>${esc(s)}</text>`;
}

function defs(t) {
  return `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.top}"/><stop offset="0.48" stop-color="${t.mid}"/><stop offset="1" stop-color="${t.bottom}"/></linearGradient>
  <radialGradient id="glow" cx="0.85" cy="-0.08" r="0.75" gradientTransform="translate(0.85 -0.08) scale(1 0.6) translate(-0.85 0.08)"><stop offset="0" stop-color="${t.glow}" stop-opacity="0.55"/><stop offset="0.65" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>
  <radialGradient id="pool" cx="0.1" cy="1.05" r="0.6"><stop offset="0" stop-color="${t.a}" stop-opacity="0.18"/><stop offset="1" stop-color="${t.a}" stop-opacity="0"/></radialGradient>
  <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.19"/><stop offset="1" stop-color="#fff" stop-opacity="0.07"/></linearGradient>
  <linearGradient id="glass-hero" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.26"/><stop offset="1" stop-color="#fff" stop-opacity="0.11"/></linearGradient>
  <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="0.35" stop-color="#fff" stop-opacity="0.16"/><stop offset="1" stop-color="#fff" stop-opacity="0.10"/></linearGradient>
  <linearGradient id="spec" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <linearGradient id="tile" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="${t.a}"/><stop offset="1" stop-color="${t.b}"/></linearGradient>
  <linearGradient id="tile-shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <linearGradient id="hero-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.a}"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0.5"/></linearGradient>
  <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="12" stdDeviation="13" flood-color="#0c0a28" flood-opacity="0.30"/></filter>
  <filter id="halo" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="soft" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3"/></filter>
  ${["main", "soft", "amber"].map((k) => `<marker id="arrow-${k}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M1 1.2L9 5 1 8.8 2.8 5z" fill="${k === "main" ? "rgba(255,255,255,0.9)" : k === "amber" ? C.queued : "rgba(255,255,255,0.6)"}"/></marker>`).join("")}
</defs>`;
}

function backdrop(h, t) {
  return `<rect width="${W}" height="${h}" rx="24" fill="url(#bg)"/><rect width="${W}" height="${h}" rx="24" fill="url(#glow)"/><rect width="${W}" height="${h}" rx="24" fill="url(#pool)"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="${h - 1}" rx="23.5" fill="none" stroke="#fff" stroke-opacity="0.14"/>`;
}

function header(title, sub, badges = []) {
  let out = text(32, 50, title, { size: 22, weight: 650, color: C.ink }) + text(32, 74, sub, { size: 13.5, color: C.ink2, room: 816, where: "subtitle" });
  let x = W - 32;
  for (const b of [...badges].reverse()) {
    const w = Math.round(width(b.text, 12.5, false) + 34);
    x -= w;
    out += `<g><rect x="${x}" y="32" width="${w}" height="28" rx="14" fill="rgba(40,20,60,0.32)" stroke="#fff" stroke-opacity="0.14"/><circle cx="${x + 15}" cy="46" r="4" fill="${b.color}"/><circle cx="${x + 15}" cy="46" r="7" fill="${b.color}" opacity="0.25"/>${text(x + 26, 50.5, b.text, { size: 12.5, weight: 600, color: C.ink })}</g>`;
    x -= 8;
  }
  return out;
}

function iconTile(x, y, size, icon, { color = C.ink, hero = false } = {}) {
  const r = Math.round(size * 0.28);
  const s = size * 0.6, o = (size - s) / 2;
  const bg = hero
    ? `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}" fill="url(#tile)"/><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}" fill="url(#tile-shine)"/><rect x="${x + 0.5}" y="${y + 0.5}" width="${size - 1}" height="${size - 1}" rx="${r - 0.5}" fill="none" stroke="#fff" stroke-opacity="0.35"/>`
    : `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}" fill="rgba(40,20,60,0.30)" stroke="#fff" stroke-opacity="0.12"/>`;
  return `${bg}<svg x="${x + o}" y="${y + o}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${hero ? "#fff" : color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</svg>`;
}

function glass(x, y, w, h, { hero = false, r = 16 } = {}) {
  const ring = hero
    ? `<rect x="${x - 6}" y="${y - 6}" width="${w + 12}" height="${h + 12}" rx="${r + 6}" fill="url(#hero-ring)" opacity="0.35" filter="url(#halo)"/>`
    : "";
  return `${ring}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${hero ? "url(#glass-hero)" : "url(#glass)"}" filter="url(#shadow)"/>
<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="${r - 0.5}" fill="none" stroke="${hero ? "url(#hero-ring)" : "url(#edge)"}" stroke-width="${hero ? 1.5 : 1}"/>
<rect x="${x + r}" y="${y}" width="${w - 2 * r}" height="1.2" fill="url(#spec)" opacity="${hero ? 1 : 0.8}"/>`;
}

// A glass node: icon tile, title, optional sub line, then lines ({ t, mono, color }) and chips (mono pills).
function node({ x, y, w, h, icon, color, title, sub, subMono, lines = [], chips = [], hero = false, id }) {
  const tile = hero ? 40 : 32;
  let out = glass(x, y, w, h, { hero }) + iconTile(x + 16, y + 16, tile, icon, { color, hero });
  const tx = x + 16 + tile + 12, room = x + w - 16 - tx;
  out += text(tx, y + (sub ? 31 : 37) + (hero ? 2 : 0), title, { size: hero ? 17 : 15, weight: 650, color: C.ink, room, where: id });
  if (sub) out += text(tx, y + 50 + (hero ? 4 : 0), sub, { size: 12, mono: subMono, color: C.ink3, room, where: id });
  let ly = y + 16 + tile + 26;
  for (const line of lines) {
    out += text(x + 16, ly, line.t, { size: line.mono ? 12 : 12.5, mono: line.mono, color: line.color || C.ink2, weight: line.weight || 400, room: w - 32, where: id });
    ly += 19;
  }
  if (chips.length) out += chipRows(x + 16, lines.length ? ly - 6 : y + 16 + tile + 14, w - 32, chips, id);
  return out;
}

function chipRows(x, y, room, chips, where, mono = true) {
  let cx = x, cy = y, out = "";
  for (const c of chips) {
    const label = typeof c === "string" ? c : c.t;
    const w = Math.round(width(label, 12, mono) + 18);
    if (cx + w > x + room + 0.5) { cx = x; cy += 28; }
    if (w > room) warnings.push(`${where}: chip "${label}" too wide`);
    const dot = typeof c === "object" && c.color;
    out += `<rect x="${cx}" y="${cy}" width="${w + (dot ? 12 : 0)}" height="22" rx="11" fill="rgba(40,20,60,0.30)" stroke="#fff" stroke-opacity="0.14"/>`;
    if (dot) out += `<circle cx="${cx + 11}" cy="${cy + 11}" r="3.5" fill="${c.color}"/>`;
    out += text(cx + 9 + (dot ? 12 : 0), cy + 15.5, label, { size: 12, mono, color: C.ink });
    cx += w + (dot ? 12 : 0) + 6;
  }
  return out;
}

const pathOf = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
// A connector. kind: main (the route a hand-off takes), soft, amber (token usage), dashed (supervision).
function wire(pts, kind = "main") {
  const d = pathOf(pts);
  const stroke = kind === "main" ? "rgba(255,255,255,0.85)" : kind === "amber" ? C.queued : "rgba(255,255,255,0.55)";
  const marker = kind === "main" ? "main" : kind === "amber" ? "amber" : "soft";
  return { d, kind, svg: `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${kind === "main" ? 2 : 1.6}" stroke-linecap="round" stroke-linejoin="round"${kind === "dashed" ? ' stroke-dasharray="5 6"' : ""} marker-end="url(#arrow-${marker})"/>` };
}

// Motion layer: dashes flowing along the active wires and a pulse traveling the main route.
function motion(wires, route, dur) {
  const flows = wires.filter((w) => w.kind === "main" || w.kind === "amber").map((w) =>
    `<path class="flow" d="${w.d}" fill="none" stroke="${w.kind === "amber" ? C.queued : C.cta}" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="2 14"/>`).join("");
  return `<g aria-hidden="true">${flows}
<g class="pulse"><circle r="12" fill="${C.cta}" opacity="0.28" filter="url(#soft)"><animateMotion dur="${dur}s" repeatCount="indefinite" path="${route}"/></circle><circle r="4.5" fill="${C.cta}"><animateMotion dur="${dur}s" repeatCount="indefinite" path="${route}"/></circle><circle r="2" fill="#fff"><animateMotion dur="${dur}s" repeatCount="indefinite" path="${route}"/></circle></g></g>`;
}
const MOTION_CSS = `<style>
.flow { animation: flow 1.1s linear infinite; opacity: 0.95; }
.arc { animation: flow 1.1s linear infinite; }
@keyframes flow { to { stroke-dashoffset: -16; } }
.ping { animation: ping 3.2s ease-in-out infinite; }
@keyframes ping { 0%, 52% { opacity: 0; } 62% { opacity: 1; } 100% { opacity: 0; } }
.rest { display: none; }
@media (prefers-reduced-motion: reduce) { .flow, .arc, .ping { animation: none; } .flow, .pulse, .flying { display: none; } .rest { display: inline; } .ping { opacity: 1; } }
</style>`;

function svgDoc(h, t, title, desc, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>
${defs(t)}${body}
</svg>
`;
}

function legend(y, items, animated) {
  let x = 32, out = "";
  for (const it of items.filter((i) => animated || i.kind !== "pulse")) {
    out += it.kind === "pulse"
      ? `<circle cx="${x + 10}" cy="${y - 4}" r="8" fill="${C.cta}" opacity="0.28"/><circle cx="${x + 10}" cy="${y - 4}" r="4" fill="${C.cta}"/>`
      : `<path d="M${x} ${y - 4}h20" stroke="${it.color}" stroke-width="2" stroke-linecap="round"${it.dash ? ' stroke-dasharray="4 4"' : ""}/>`;
    out += text(x + 28, y, it.t, { size: 12, color: C.ink2 });
    x += 28 + width(it.t, 12, false) + 28;
  }
  return out;
}

// ---------------------------------------------------------------- 1. architecture
function architecture(animated) {
  const t = THEMES.overview, H = 808;
  const c1 = 40, c2 = 312, c3 = 632, w1 = 208, w2 = 256;
  const wires = [
    wire([[248, 212], [312, 212]]),
    wire([[568, 212], [632, 212]]),
    wire([[736, 272], [736, 336]]),
    wire([[632, 396], [568, 396]]),
    wire([[440, 496], [440, 576]]),
    wire([[248, 396], [312, 396]], "amber"),
    wire([[144, 576], [144, 456]], "amber"),
    wire([[736, 576], [736, 488], [568, 488]], "dashed"),
  ];
  const route = pathOf([[144, 212], [736, 212], [736, 396], [440, 396], [440, 644]]);
  let body = backdrop(H, t) + header("How the board works", "Agents post with one command; a local server pushes every change to each open window.",
    [{ text: "No model calls", color: C.done }, { text: "Node stdlib only", color: C.link }]);
  // the machine boundary
  body += `<rect x="16" y="96" width="${W - 32}" height="652" rx="20" fill="rgba(20,16,50,0.14)" stroke="#fff" stroke-opacity="0.32" stroke-dasharray="6 6"/>`;
  body += `<rect x="40" y="108" width="196" height="26" rx="13" fill="rgba(40,20,60,0.36)"/>` + iconTileless(52, 114, "lock") + text(72, 125.5, "This Mac · 127.0.0.1 only", { size: 12.5, weight: 600, color: C.ink });
  body += wires.map((w) => w.svg).join("");
  body += text(452, 540, "SSE push", { size: 12, weight: 600, color: C.ink2 });
  body += text(156, 520, "appended bytes", { size: 12, color: C.queued });
  body += text(652, 479, "KeepAlive", { size: 12, color: C.ink2, anchor: "middle" });
  if (animated) body += motion(wires, route, 7);
  body += stack(c1, 152, w1);
  body += node({ id: "shells", x: c1, y: 152, w: w1, h: 120, icon: "terminal", color: C.run, title: "Agents' shells", sub: "lead and agent sessions", lines: [{ t: "awb task … --msg-to", mono: true, color: C.ink }] });
  body += node({ id: "awb", x: c2, y: 152, w: w2, h: 120, icon: "send", color: C.cta, title: "awb CLI", sub: "awb.mjs · one line per call", subMono: false, chips: ["task", "msg", "need", "event"] });
  body += node({ id: "lock", x: c3, y: 152, w: w1, h: 120, icon: "lock", color: C.review, title: "Lock + rename", sub: "withLock() · save()", subMono: true,
    lines: [{ t: "mkdirSync(.lock)", mono: true }, { t: "write .tmp → renameSync", mono: true }] });
  body += node({ id: "data", x: c3, y: 336, w: w1, h: 120, icon: "folder", color: C.queued, title: "data/", sub: "board.json", subMono: true,
    lines: [{ t: "tasks · team · messages" }, { t: "needs · events" }] });
  body += node({ id: "server", hero: true, x: c2, y: 336, w: w2, h: 160, icon: "server", title: "server.mjs", sub: "127.0.0.1:4747", subMono: true,
    lines: [{ t: "Watches data/, pushes each change" }], chips: ["fs.watch", "SSE /events", "/api/state", "/api/usage"] });
  body += node({ id: "usage", x: c1, y: 336, w: w1, h: 120, icon: "bars", color: C.queued, title: "usage.mjs", sub: "every 30 s", lines: [{ t: "Sends aggregates only", color: C.queued, weight: 600 }, { t: "never transcript text" }] });
  body += node({ id: "transcripts", x: c1, y: 576, w: w1, h: 112, icon: "doc", color: C.ink2, title: "Transcripts", sub: "written by Claude Code", lines: [{ t: "~/.claude/projects", mono: true }] });
  body += pageNode(c2, 576, w2, 136);
  body += node({ id: "launch", x: c3, y: 576, w: w1, h: 112, icon: "power", color: C.done, title: "LaunchAgent", sub: "install.sh loads it", lines: [{ t: "RunAtLoad · KeepAlive", mono: true }] });
  body += legend(784, [{ kind: "pulse", t: "a hand-off's route" }, { color: "rgba(255,255,255,0.85)", t: "write, watch, push" }, { color: C.queued, t: "token usage" }, { color: "rgba(255,255,255,0.55)", dash: true, t: "keeps the server up" }], animated);
  return svgDoc(H, t, "Agent Work Board architecture",
    "Agents' shells call the awb CLI, which takes a lock and atomically renames data/board.json. server.mjs watches data/ and pushes each change over server-sent events to the board page, shown in the Mac app's WKWebView or a browser. A LaunchAgent keeps the server running; usage.mjs reads Claude Code transcripts and sends aggregates only. Everything stays on this Mac on 127.0.0.1; no model calls.",
    (animated ? MOTION_CSS : "") + body);
}

function iconTileless(x, y, icon) {
  return `<svg x="${x}" y="${y}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${C.done}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</svg>`;
}
// Two cards peeking behind the shells node: several sessions at once.
function stack(x, y, w) {
  const strip = (inset, top, r, a) => `<path d="M${x + inset} ${y + 2}V${y - top + r}a${r} ${r} 0 0 1 ${r} ${-r}H${x + w - inset - r}a${r} ${r} 0 0 1 ${r} ${r}V${y + 2}" fill="#fff" fill-opacity="${a}" stroke="#fff" stroke-opacity="0.16"/>`;
  return strip(18, 12, 10, 0.07) + strip(9, 6, 12, 0.10);
}
function pageNode(x, y, w, h) {
  let out = glass(x, y, w, h);
  out += ["#ff5f57", "#febc2e", "#28c840"].map((c, i) => `<circle cx="${x + 22 + i * 15}" cy="${y + 21}" r="4.5" fill="${c}"/>`).join("");
  out += text(x + 78, y + 26, "Board page", { size: 15, weight: 650, color: C.ink });
  out += text(x + 16, y + 52, "Mac app (WKWebView) or a browser", { size: 12.5, color: C.ink2, room: w - 32, where: "page" });
  out += chipRows(x + 16, y + 66, w - 32, [{ t: "Overview", color: C.done }, { t: "Office", color: C.cta }, { t: "Board", color: C.review }, { t: "Activity", color: C.run }, { t: "Usage", color: C.queued }], "page", false);
  return out;
}

// ---------------------------------------------------------------- 2. update sequence
function sequence(animated) {
  const t = THEMES.office;
  const lanes = [
    { x: 92, title: "Agent shell", sub: "Claude Code", color: C.run },
    { x: 248, title: "awb", sub: "awb.mjs", color: C.cta },
    { x: 404, title: "data/", sub: "board.json", color: C.queued },
    { x: 560, title: "server.mjs", sub: ":4747", color: C.done },
    { x: 716, title: "Board page", sub: "index.html", color: C.review },
  ];
  const L = Object.fromEntries(["shell", "awb", "data", "server", "page"].map((k, i) => [k, lanes[i].x]));
  // [from, to, label (mono), note]; from === to is a step inside one process
  const steps = [
    ["shell", "awb", "awb task --msg-to", "a hand-back to Claude"],
    ["awb", "data", "mkdirSync(.lock)", "one writer at a time"],
    ["awb", "awb", "addMessage()", "task + message"],
    ["awb", "data", "write <pid>.tmp", "the whole new board"],
    ["awb", "data", "renameSync()", "atomic swap"],
    ["awb", "data", "rmdirSync(.lock)", "lock released"],
    ["awb", "shell", "awb: id → review", "silent with --quiet"],
    ["data", "server", "fs.watch(data/)", "the rename fires"],
    ["server", "server", "60 ms debounce", "one read per burst"],
    ["server", "server", "readState()", "skips a bad read"],
    ["server", "page", "SSE data: {…}", "every open window"],
    ["page", "page", "onmessage", "new ids only"],
    ["page", "page", "render()", "all five views"],
    ["page", "page", "deliver(m)", "envelope flies"],
  ];
  const top = 208, dy = 48, last = top + (steps.length - 1) * dy, heroY = last + 48, heroH = 168, H = heroY + heroH + 56;
  let body = backdrop(H, t) + header("One hand-back, end to end", "From an agent's awb call to the envelope landing on Claude's desk in the Office view.",
    [{ text: "Pushed, not polled", color: C.cta }]);
  // lane heads and lifelines
  for (const l of lanes) {
    body += `<path d="M${l.x} 160V${heroY - 8}" stroke="#fff" stroke-opacity="0.26" stroke-width="1.2" stroke-dasharray="3 5"/>`;
    body += glass(l.x - 66, 104, 132, 56, { r: 14 });
    body += `<circle cx="${l.x - 50}" cy="${124}" r="4" fill="${l.color}"/><circle cx="${l.x - 50}" cy="${124}" r="7" fill="${l.color}" opacity="0.25"/>`;
    body += text(l.x - 40, 129, l.title, { size: 14, weight: 650, color: C.ink, room: 98, where: l.title });
    body += text(l.x - 40, 147, l.sub, { size: 12, mono: true, color: C.ink3, room: 98, where: l.title });
  }
  // activation bars: awb holds the work, then the server, then the page
  const bar = (x, a, b) => `<rect x="${x - 4}" y="${a}" width="8" height="${b - a}" rx="4" fill="#fff" fill-opacity="0.22" stroke="#fff" stroke-opacity="0.35"/>`;
  body += bar(L.awb, top - 10, top + 6 * dy + 10) + bar(L.server, top + 7 * dy - 10, top + 10 * dy + 10) + bar(L.page, top + 10 * dy - 10, last + 18);
  const wires = [], route = [];
  steps.forEach(([from, to, label, note], i) => {
    const y = top + i * dy, a = L[from], b = L[to], n = i + 1;
    if (from === to) {
      const x = a + 4, d = `M${x} ${y - 9}h18a6 6 0 0 1 6 6v6a6 6 0 0 1-6 6h-16`;
      body += `<path d="${d}" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="1.6" stroke-linecap="round" marker-end="url(#arrow-soft)"/>`;
      wires.push({ d, kind: "main" }); route.push(d);
      const lx = x + 30, next = lanes.find((l) => l.x > a);
      body += stepLabel(lx, y, n, label, note, next ? next.x - 12 - lx : W - 24 - lx, a);
      return;
    }
    const dir = Math.sign(b - a), x1 = a + dir * 6, x2 = b - dir * 6;
    const back = from === "awb" && to === "shell";
    const wr = wire([[x1, y], [x2, y]], back ? "dashed" : "main");
    body += wr.svg; wires.push(wr); route.push(`M${x1} ${y}L${x2} ${y}`);
    const left = Math.min(a, b) + 12;
    body += stepLabel(left, y, n, label, note, Math.abs(b - a) - 24, Math.min(a, b));
  });
  // into the hero
  route.push(`M${L.page} ${last + 18}L${L.page} ${heroY + 56}`);
  if (animated) body += motion(wires, route.join(" "), 9);
  body += office(32, heroY, W - 64, heroH, t, animated);
  body += legend(H - 24, [{ kind: "pulse", t: "the hand-back" }, { color: "rgba(255,255,255,0.85)", t: "call or event" }, { color: "rgba(255,255,255,0.55)", dash: true, t: "reply to the shell" }], animated);
  return svgDoc(H, t, "From one awb call to an envelope on screen",
    "An agent runs awb task with --msg-to. awb takes the lock (mkdir data/.lock), adds the task update and message, writes board.json.<pid>.tmp, renames it over board.json and releases the lock. server.mjs sees the rename through fs.watch, waits 60 ms for the burst to settle, reads the state and pushes it over server-sent events. The page keeps only new message ids, renders, and in the Office view an envelope flies from the sender's desk to the recipient's.",
    (animated ? MOTION_CSS : "") + body);
}

// The step number sits just left of the lifeline the step starts from, clear of the label and the bar.
function stepLabel(x, y, n, label, note, room, lifeline) {
  fit(label, 12, true, room, `step ${n}`);
  fit(note, 12, false, room, `step ${n} note`);
  const bx = lifeline - 18;
  return `<circle cx="${bx}" cy="${y - 12}" r="9.5" fill="rgba(40,20,60,0.5)" stroke="#fff" stroke-opacity="0.3"/>` +
    text(bx, y - 7.8, String(n), { size: 12, weight: 700, color: C.ink, anchor: "middle" }) +
    text(x, y - 8, label, { size: 12, mono: true, color: C.ink }) +
    text(x, y + 17, note, { size: 12, color: C.ink2 });
}

// The hero: the Office view, where the message lands.
function office(x, y, w, h, t, animated) {
  let out = glass(x, y, w, h, { hero: true, r: 22 });
  out += iconTile(x + 20, y + 20, 40, "send", { hero: true });
  out += text(x + 72, y + 38, "The envelope lands", { size: 17, weight: 650, color: C.ink });
  out += text(x + 72, y + 58, "deliver(m) in the Office view", { size: 12, mono: true, color: C.ink3 });
  const lines = ["The sender's desk says it in a speech bubble.", "An envelope arcs to each recipient's desk:", "1.3 s eased flight, 220 ms apart.", "The recipient's desk glows for 1.4 s."];
  lines.forEach((s, i) => { out += text(x + 20, y + 92 + i * 19, s, { size: 12.5, color: C.ink2, room: 330, where: "hero" }); });
  // mini office: two desks and the flight
  const dx = x + 392, dw = 132, dh = 72, dyy = y + 64, rx = x + w - 20 - dw;
  const desk = (cx, name, init, color, ping) => {
    let d = `<rect x="${cx}" y="${dyy}" width="${dw}" height="${dh}" rx="14" fill="rgba(40,20,60,0.32)" stroke="#fff" stroke-opacity="0.18"/>`;
    if (ping) d += `<rect class="${animated ? "ping" : ""}" x="${cx}" y="${dyy}" width="${dw}" height="${dh}" rx="14" fill="none" stroke="${C.cta}" stroke-width="2" opacity="${animated ? 0 : 1}"/>`;
    d += `<circle cx="${cx + 26}" cy="${dyy + 36}" r="13" fill="${color}"/><circle cx="${cx + 26}" cy="${dyy + 36}" r="13" fill="none" stroke="#fff" stroke-opacity="0.3" stroke-width="2"/>`;
    d += text(cx + 26, dyy + 40.5, init, { size: 12, weight: 700, color: "#fff", anchor: "middle" });
    d += text(cx + 48, dyy + 33, name, { size: 13, weight: 650, color: C.ink });
    d += text(cx + 48, dyy + 50, ping ? "receives" : "hands back", { size: 12, color: C.ink3 });
    return d;
  };
  const from = [dx + dw - 6, dyy + 20], to = [rx + 10, dyy + 20];
  const arc = `M${from[0]} ${from[1]} Q${(from[0] + to[0]) / 2} ${dyy - 56} ${to[0]} ${to[1]}`;
  out += `<path d="${arc}" fill="none" stroke="${C.cta}" stroke-width="2" stroke-dasharray="7 9" stroke-linecap="round" opacity="0.8"${animated ? ' class="arc"' : ""}/>`;
  out += desk(dx, "Theo", "T", "#e2576f", false) + desk(rx, "Claude", "C", "#7a52d8", true);
  // speech bubble above the sender
  out += `<rect x="${dx + 8}" y="${dyy - 34}" width="108" height="24" rx="12" fill="#fff" fill-opacity="0.96"/><path d="M${dx + 24} ${dyy - 11}l6 7 4-7z" fill="#fff" fill-opacity="0.96"/>`;
  out += text(dx + 62, dyy - 17.5, "Diagrams ready", { size: 12, weight: 600, color: C.ctaInk, anchor: "middle" });
  const envelope = `<circle r="11" fill="${C.cta}" opacity="0.35"/><rect x="-7" y="-5" width="14" height="10" rx="1.5" fill="#fff"/><path d="M-7 -5L0 1 7 -5" fill="none" stroke="#b98a00" stroke-width="1.2"/>`;
  const resting = `<g transform="translate(${(from[0] + to[0]) / 2} ${dyy - 18})">${envelope}</g>`;
  if (animated) {
    out += `<g class="flying"><g><animateMotion dur="3.2s" repeatCount="indefinite" path="${arc}" keyPoints="0;0;1;1" keyTimes="0;0.12;0.55;1" calcMode="spline" keySplines="0 0 1 1;0.45 0 0.55 1;0 0 1 1"/>${envelope}</g></g>`;
    out += `<g class="rest">${resting}</g>`; // reduced motion: the envelope rests mid-flight
  } else out += resting;
  return out;
}

// ---------------------------------------------------------------- 3. token usage
function tokens(animated) {
  const t = THEMES.usage, H = 896;
  const c1 = 40, c2 = 328, c3 = 616, cw = 224;
  const wires = [
    wire([[152, 216], [152, 296]], "amber"),
    wire([[264, 360], [328, 360]], "amber"),
    wire([[552, 360], [616, 360]], "amber"),
    wire([[728, 424], [728, 488]], "amber"),
    wire([[616, 552], [552, 552]], "amber"),
    wire([[328, 552], [264, 552]], "amber"),
    wire([[152, 632], [152, 728]], "main"),
  ];
  const route = pathOf([[152, 164], [152, 360], [728, 360], [728, 552], [152, 552], [152, 784]]);
  let body = backdrop(H, t) + header("Token usage, counted locally", "Read from Claude Code's own transcripts at zero token cost; only numbers reach the page.",
    [{ text: "Zero token cost", color: C.done }]);
  // source strip
  body += glass(40, 104, 800, 112) + iconTile(56, 120, 32, "doc", { color: C.ink2 });
  body += text(100, 141, "Claude Code transcripts", { size: 15, weight: 650, color: C.ink }) + text(296, 141, "~/.claude/projects", { size: 12, mono: true, color: C.ink3 });
  body += text(56, 178, "<project>/<session>.jsonl", { size: 12, mono: true, color: C.ink }) + text(56, 198, "a lead session → Claude (lead)", { size: 12.5, color: C.ink2 });
  body += text(400, 178, "<session>/subagents/agent-<id>.jsonl", { size: 12, mono: true, color: C.ink }) + text(400, 198, "an agent run → the member it was briefed as", { size: 12.5, color: C.ink2, room: 424, where: "strip" });
  // boundary: the server process
  body += `<rect x="16" y="248" width="${W - 32}" height="400" rx="20" fill="rgba(20,16,50,0.16)" stroke="#fff" stroke-opacity="0.32" stroke-dasharray="6 6"/>`;
  body += `<rect x="176" y="260" width="284" height="26" rx="13" fill="rgba(40,20,60,0.40)"/>` + iconTileless(188, 266, "lock") + text(208, 277.5, "Transcript text never leaves the server", { size: 12.5, weight: 600, color: C.ink, room: 244, where: "boundary" });
  body += text(W - 40, 277.5, "server.mjs + usage.mjs", { size: 12, mono: true, color: C.ink3, anchor: "end" });
  body += wires.map((w) => w.svg).join("");
  body += text(164, 692, "numbers only: SSE and /api/usage", { size: 12, weight: 600, color: C.ink2 });
  if (animated) body += motion(wires, route, 8);
  body += node({ id: "scan", x: c1, y: 296, w: cw, h: 128, icon: "scan", color: C.queued, title: "scan()", sub: "every 30 s", lines: [{ t: "stat: size vs offset", mono: true }, { t: "a shorter file is read again" }] });
  body += node({ id: "read", x: c2, y: 296, w: cw, h: 128, icon: "read", color: C.queued, title: "Read new bytes", sub: "readAppended()", subMono: true, lines: [{ t: "from file.offset", mono: true }, { t: "8 MB chunks; a half line waits" }] });
  body += node({ id: "parse", x: c3, y: 296, w: cw, h: 128, icon: "braces", color: C.queued, title: "Parse usage", sub: "handleLine()", subMono: true, lines: [{ t: '"type":"assistant"', mono: true }, { t: "tokens, model family, time" }] });
  body += node({ id: "dedupe", x: c3, y: 488, w: cw, h: 128, icon: "filter", color: C.review, title: "Dedupe", sub: "one record per response", lines: [{ t: "message.id|requestId", mono: true }, { t: "the last copy wins" }] });
  body += node({ id: "attribute", x: c2, y: 488, w: cw, h: 128, icon: "person", color: C.run, title: "Attribute", sub: "member and workstream", lines: [{ t: "act exactly as <Name>", mono: true }, { t: "awb task <id>", mono: true }] });
  body += node({ id: "summary", hero: true, x: c1, y: 480, w: cw, h: 152, icon: "sigma", title: "summary()", sub: "aggregates only", subMono: false,
    lines: [{ t: "day × workstream × model" }, { t: "× member, 62 days" }, { t: "+ the 300 latest runs" }] });
  body += usageView(40, 728, 800, 120);
  body += legend(H - 24, [{ kind: "pulse", t: "one usage line's path" }, { color: C.queued, t: "inside the server" }, { color: "rgba(255,255,255,0.85)", t: "to the page" }], animated);
  return svgDoc(H, t, "Token usage: transcripts in, totals out",
    "Every 30 seconds usage.mjs reads only the bytes appended to Claude Code transcripts in ~/.claude/projects, parses assistant usage lines, keeps one record per message id and request id, attributes each run to a team member and workstream, and builds daily aggregates. Only those numbers reach the Usage view over server-sent events and /api/usage; transcript text never leaves the server.",
    (animated ? MOTION_CSS : "") + body);
}

function usageView(x, y, w, h) {
  let out = glass(x, y, w, h) + iconTile(x + 16, y + 16, 32, "bars", { color: C.queued });
  out += text(x + 60, y + 31, "Usage view", { size: 15, weight: 650, color: C.ink }) + text(x + 60, y + 50, "in the board page", { size: 12, color: C.ink3 });
  out += text(x + 16, y + 82, "Tokens by day, member, workstream and model", { size: 12.5, color: C.ink2 });
  out += text(x + 16, y + 101, "Costs only if you add data/prices.json", { size: 12.5, color: C.ink2 });
  // a small stacked bar chart, like the view's daily chart
  const bx = x + 440, base = y + h - 24, vals = [[28, 10], [40, 14], [22, 8], [52, 18], [34, 12], [60, 22], [46, 16], [30, 12], [56, 20], [38, 14]];
  vals.forEach(([a, b], i) => {
    const cx = bx + i * 22;
    out += `<rect x="${cx}" y="${base - a}" width="14" height="${a - b}" rx="3" fill="${C.queued}" opacity="0.9"/><rect x="${cx}" y="${base - b}" width="14" height="${b}" rx="3" fill="${C.review}" opacity="0.9"/>`;
  });
  out += `<path d="M${bx - 6} ${base + 0.5}H${bx + 220}" stroke="#fff" stroke-opacity="0.25"/>`;
  out += `<circle cx="${x + w - 116}" cy="${y + 34}" r="4" fill="${C.queued}"/>` + text(x + w - 106, y + 38, "Opus", { size: 12, color: C.ink2 });
  out += `<circle cx="${x + w - 62}" cy="${y + 34}" r="4" fill="${C.review}"/>` + text(x + w - 52, y + 38, "Sonnet", { size: 12, color: C.ink2 });
  return out;
}

// ---------------------------------------------------------------- write files and PNGs
const diagrams = { architecture, "update-sequence": sequence, "token-usage": tokens };
for (const [name, draw] of Object.entries(diagrams)) {
  writeFileSync(join(OUT, `${name}.svg`), draw(false));
  writeFileSync(join(OUT, `${name}-animated.svg`), draw(true));
}
if (warnings.length) console.warn("Text that may not fit:\n  " + warnings.join("\n  "));

if (process.env.CHROME) {
  const tmp = mkdtempSync(join(tmpdir(), "awb-diagrams-"));
  try {
    for (const name of Object.keys(diagrams)) {
      const h = Number(/height="(\d+)"/.exec(diagrams[name](false))[1]);
      const page = join(tmp, `${name}.html`);
      writeFileSync(page, `<!doctype html><style>html,body{margin:0;background:transparent}</style><img src="file://${join(OUT, name + ".svg")}" width="${W}" height="${h}">`);
      execFileSync(process.env.CHROME, ["--headless", "--hide-scrollbars", "--force-device-scale-factor=2", "--default-background-color=00000000",
        `--window-size=${W},${h}`, "--allow-file-access-from-files", `--screenshot=${join(OUT, name + ".png")}`, `file://${page}`], { stdio: "ignore" });
      console.log(`${name}.png`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
