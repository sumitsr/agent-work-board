#!/usr/bin/env node
// Claude Code hook: posts to the board automatically, so it stays live even when an agent forgets to run awb.
// Registered in ~/.claude/settings.json for UserPromptSubmit, Stop, PreToolUse (Agent|Task), PostToolUse (Bash) and
// SubagentStop. Acts only in team projects (a folder, or one of its parents, with .claude/team/handbook.md): one task
// for the lead and one per expert, e.g. orbit-mara. Experts run as general-purpose agents, so the name comes from the
// dispatch description ("Mara: fact-check PR 160") or "You are Mara" in the prompt, and must be a member of the team.
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
const oneLine = (text = "") => text.replace(/<([\w-]+)[^>]*>[\s\S]*?<\/\1>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
const awb = (args) => spawnSync(process.execPath, [join(ROOT, "awb.mjs"), ...args], { timeout: 5000 });

const team = Object.values(readJson(join(DATA, "board.json"), {}).team || {}).map((m) => m.name);
const expert = (description = "", prompt = "") => {
  const said = description.match(/^\s*(\w+)\s*:/)?.[1] || prompt.match(/\b(?:You are|act exactly as) (\w+)/)?.[1];
  return team.find((name) => name.toLowerCase() === said?.toLowerCase());
};
const task = (description = "") => oneLine(description.replace(/^\s*\w+\s*:\s*/, "")) || "Working on the lead's brief";
// The SubagentStop input has no description; the run's .meta.json beside its transcript does.
const meta = (h) => readJson(str(h.agent_transcript_path).replace(/\.jsonl$/, ".meta.json"), {});
const str = (value) => (typeof value === "string" ? value : "");

// The team project this folder belongs to: the nearest folder (an agent's worktree counts as its project) with a handbook.
function projectOf(cwd) {
  for (let dir = cwd.replace(/\/\.claude\/worktrees\/[^/]+/, ""); dir !== dirname(dir); dir = dirname(dir))
    if (existsSync(join(dir, ".claude", "team", "handbook.md"))) return dir;
  return null;
}
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
    const name = expert(description);
    // Done, not review: nothing else ever closes a hook-kept card, so "review" piled up; the lead's review shows on its own card.
    return name && [name, name.toLowerCase(), "done", "Handed back: " + task(description)];
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
    if (home && (event === "Stop" || (event === "PostToolUse" && MERGES.test(str(hook.tool_input?.command))))) syncLater(home);
    const post = home && posts[event]?.(hook);
    if (post) {
      const [agent, who, status, stage] = post;
      const args = ["task", `${basename(home)}-${who}`, "--workstream", workstreamOf(home), "--agent", agent, "--status", status, "--quiet"];
      if (stage) args.push("--stage", stage); // an empty stage (a prompt that was all injected tags) keeps the last one
      if (who !== "lead" && stage) args.push("--title", stage.replace(/^Handed back: /, ""));
      awb(args);
    }
  }
} catch {}
process.exit(0);
