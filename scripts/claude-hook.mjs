#!/usr/bin/env node
// Claude Code hook: posts to the board automatically, so it stays live even when an agent forgets to run awb.
// Registered in ~/.claude/settings.json for UserPromptSubmit, Stop, PreToolUse (Agent|Task), PostToolUse (Bash) and
// SubagentStop. Works for any team job in any project: one task for the lead and one per expert, e.g. orbit-mara.
// Experts run as general-purpose agents, so the name comes from "You are Mara" in the prompt (any name: a new one gets
// a guest desk) or from the dispatch description ("Mara: fact-check PR 160", known team members only). A session is a
// team job once it dispatches a named expert, or from the start if its project has .claude/team/handbook.md.
// Merged pull requests reach the timeline on their own: after a command that merges ("gh pr merge", "… finish …")
// and at the end of each lead turn, a detached background run asks GitHub for newly merged PRs and posts each once.
// Never blocks Claude: any failure is swallowed and the hook always exits 0.
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawn, spawnSync } from "node:child_process";

const ROOT = join(import.meta.dirname, "..");
const DATA = process.env.AWB_DATA || join(ROOT, "data");
const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; } };
const oneLine = (text = "", max = 80) => text.replace(/<([\w-]+)[^>]*>[\s\S]*?<\/\1>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const awb = (args) => spawnSync(process.execPath, [join(ROOT, "awb.mjs"), ...args], { timeout: 5000 });

const board = readJson(join(DATA, "board.json"), {});
const team = Object.values(board.team || {}).map((m) => m.name);
const member = (said) => team.find((name) => name.toLowerCase() === said?.toLowerCase());
// A persona in the prompt is a strong signal, so any capitalised name counts; "Name:" in a description could be "Fix:".
const expert = (description = "", prompt = "") => {
  const persona = prompt.match(/\b(?:You are|act exactly as) ([A-Z][a-z]+)\b/)?.[1];
  return persona && persona !== "Claude" ? member(persona) || persona : member(description.match(/^\s*(\w+)\s*:/)?.[1]);
};
const task = (description = "") => oneLine(description.replace(/^\s*\w+\s*:\s*/, "")) || "Working on the lead's brief";
// The SubagentStop input has no description; the run's .meta.json beside its transcript does.
const meta = (h) => readJson(str(h.agent_transcript_path).replace(/\.jsonl$/, ".meta.json"), {});
const str = (value) => (typeof value === "string" ? value : "");
// The hand-back itself, as one line for the conversation: the agent's last reply, which the hook input carries
// (last_assistant_message); older Claude Code versions don't, so fall back to the last text in the run's transcript.
const handback = (h) => oneLine((str(h.last_assistant_message) || lastReply(str(h.agent_transcript_path))).replace(/[*_`#>]/g, ""), 160);
function lastReply(file) {
  let last = "";
  for (const line of (() => { try { return readFileSync(file, "utf8").split("\n"); } catch { return []; } })()) {
    const record = (() => { try { return JSON.parse(line); } catch { return null; } })();
    if (record?.type !== "assistant") continue;
    for (const block of [].concat(record.message?.content || [])) if (str(block.text).trim()) last = block.text;
  }
  return last;
}
// The run's first prompt, for "You are Mara" at hand-back time.
function firstPrompt(file) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const record = JSON.parse(line);
      if (record.type === "user") return [].concat(record.message?.content || []).map((b) => (typeof b === "string" ? b : str(b.text))).join(" ");
    }
  } catch {}
  return "";
}

// The project this folder belongs to: the nearest folder with a handbook, else the folder itself (an agent's
// worktree counts as its project).
function projectOf(cwd) {
  const base = cwd.replace(/\/\.claude\/worktrees\/[^/]+/, "");
  for (let dir = base; dir !== dirname(dir); dir = dirname(dir))
    if (existsSync(join(dir, ".claude", "team", "handbook.md"))) return dir;
  return base;
}
// A team job: a handbook says so up front, or the lead card exists because a named expert was dispatched here.
const isTeam = (home) => existsSync(join(home, ".claude", "team", "handbook.md")) || Boolean(board.tasks?.[`${basename(home)}-lead`]);
const workstreamOf = (home) => readJson(join(DATA, "workstreams.json"), {})["~" + home.slice(homedir().length)] || basename(home);

const posts = {
  UserPromptSubmit: (h) => ["Claude (lead)", "lead", "running", oneLine(h.prompt)],
  Stop: () => ["Claude (lead)", "lead", "review", "Waiting for you"],
  PreToolUse: (h) => {
    const name = expert(h.tool_input?.description, h.tool_input?.prompt);
    return name && [name, name.toLowerCase(), "running", task(h.tool_input?.description)];
  },
  SubagentStop: (h) => {
    const { description } = meta(h);
    const name = expert(description, firstPrompt(str(h.agent_transcript_path)));
    // Done, not review: nothing else ever closes a hook-kept card, so "review" piled up; the lead's review shows on its own card.
    // The hand-back line goes to the lead as a message, so the conversation stays live without the agent running awb msg.
    return name && [name, name.toLowerCase(), "done", "Handed back: " + task(description), handback(h)];
  },
};

// Commands after which a PR may have been merged.
const MERGES = /\bpr\s+merge\b|\bfinish\b/;

// Background run: post every PR merged since the last sync as a timeline event, once. The first sync for a project
// only records where to start, so an old backlog never floods the timeline.
function syncMerged(home) {
  const gh = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"].find(existsSync) || "gh";
  const out = spawnSync(gh, ["pr", "list", "--state", "merged", "--limit", "20", "--json", "number,title,mergedAt,url"], { cwd: home, timeout: 15000, encoding: "utf8" });
  if (out.status !== 0) return;
  const prs = JSON.parse(out.stdout).filter((pr) => pr.mergedAt && /^https:\/\//.test(pr.url)).sort((a, b) => a.mergedAt.localeCompare(b.mergedAt));
  const file = join(DATA, "merged-prs.json");
  const synced = readJson(file, {});
  const since = synced[home];
  if (since) {
    const posted = new Set((readJson(join(DATA, "board.json"), {}).events || []).map((event) => event.link?.url).filter(Boolean));
    for (const pr of prs.filter((pr) => pr.mergedAt > since && !posted.has(pr.url)))
      awb(["event", "--kind", "pr", "--text", `PR ${pr.number} merged: ${oneLine(pr.title)}`, "--workstream", workstreamOf(home), "--link", `PR ${pr.number}|${pr.url}`, "--quiet"]);
  }
  synced[home] = [since, ...prs.map((pr) => pr.mergedAt)].filter(Boolean).sort().at(-1) || new Date().toISOString();
  writeFileSync(file + ".tmp", JSON.stringify(synced, null, 2));
  renameSync(file + ".tmp", file);
}
const syncLater = (home) => spawn(process.execPath, [import.meta.filename, "--sync-merged", home], { detached: true, stdio: "ignore" }).unref();

try {
  if (process.argv[2] === "--sync-merged") syncMerged(process.argv[3]);
  else {
    const hook = JSON.parse(readFileSync(0, "utf8"));
    const home = projectOf(hook.cwd || process.cwd());
    const event = hook.hook_event_name;
    const teamJob = isTeam(home);
    if (teamJob && (event === "Stop" || (event === "PostToolUse" && MERGES.test(str(hook.tool_input?.command))))) syncLater(home);
    const post = posts[event]?.(hook); // lead posts need a team job; expert posts make one
    if (post && (post[1] !== "lead" || teamJob)) {
      const [agent, who, status, stage, msg] = post;
      const args = ["task", `${basename(home)}-${who}`, "--workstream", workstreamOf(home), "--agent", agent, "--status", status, "--quiet"];
      if (stage) args.push("--stage", stage); // an empty stage (a prompt that was all injected tags) keeps the last one
      if (who !== "lead" && stage) args.push("--title", stage.replace(/^Handed back: /, ""));
      if (msg) args.push("--msg-to", "Claude", "--msg", msg);
      awb(args);
      // First named dispatch in a project without a handbook: open the lead card, so later turns post too.
      if (event === "PreToolUse" && !teamJob) awb(["task", `${basename(home)}-lead`, "--title", "Lead session", "--workstream", workstreamOf(home),
        "--agent", "Claude (lead)", "--status", "running", "--stage", `Dispatched ${agent}`, "--quiet"]);
    }
  }
} catch {}
process.exit(0);
