#!/usr/bin/env node
// Claude Code hook: posts to the board automatically, so it stays live even when an agent forgets to run awb.
// Registered in ~/.claude/settings.json for UserPromptSubmit, Stop, PreToolUse (Agent|Task) and SubagentStop. Acts
// only in team projects (those with .claude/team/handbook.md): one task for the lead and one per expert, e.g.
// orbit-mara. Experts run as general-purpose agents, so the name comes from the dispatch description
// ("Mara: fact-check PR 160") or "You are Mara" in the prompt, and must be a member of the board's team.
// Never blocks Claude: any failure is swallowed and the hook always exits 0.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dirname, "..");
const DATA = process.env.AWB_DATA || join(ROOT, "data");
const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; } };
const oneLine = (text = "") => text.replace(/<([\w-]+)[^>]*>[\s\S]*?<\/\1>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

const team = Object.values(readJson(join(DATA, "board.json"), {}).team || {}).map((m) => m.name);
const expert = (description = "", prompt = "") => {
  const said = description.match(/^\s*(\w+)\s*:/)?.[1] || prompt.match(/\b(?:You are|act exactly as) (\w+)/)?.[1];
  return team.find((name) => name.toLowerCase() === said?.toLowerCase());
};
const task = (description = "") => oneLine(description.replace(/^\s*\w+\s*:\s*/, "")) || "Working on the lead's brief";
// The SubagentStop input has no description; the run's .meta.json beside its transcript does.
const meta = (h) => readJson(str(h.agent_transcript_path).replace(/\.jsonl$/, ".meta.json"), {});
const str = (value) => (typeof value === "string" ? value : "");

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

try {
  const hook = JSON.parse(readFileSync(0, "utf8"));
  const cwd = hook.cwd || process.cwd();
  const home = cwd.replace(/\/\.claude\/worktrees\/.*$/, ""); // a worktree posts under its main project
  const post = existsSync(join(cwd, ".claude", "team", "handbook.md")) && posts[hook.hook_event_name]?.(hook);
  if (post) {
    const [agent, who, status, stage] = post;
    const named = readJson(join(DATA, "workstreams.json"), {})["~" + home.slice(homedir().length)];
    const args = ["task", `${basename(home)}-${who}`, "--workstream", named || basename(home), "--agent", agent, "--status", status, "--quiet"];
    if (stage) args.push("--stage", stage); // an empty stage (a prompt that was all injected tags) keeps the last one
    if (who !== "lead" && stage) args.push("--title", stage.replace(/^Handed back: /, ""));
    spawnSync(process.execPath, [join(ROOT, "awb.mjs"), ...args], { timeout: 5000 });
  }
} catch {}
process.exit(0);
