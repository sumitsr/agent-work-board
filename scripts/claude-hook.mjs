#!/usr/bin/env node
// Claude Code hook: posts to the board automatically, so it stays live even when an agent forgets to run awb.
// Registered in ~/.claude/settings.json for UserPromptSubmit, Stop, SubagentStart and SubagentStop. Acts only in team
// projects (those with .claude/team/handbook.md): one task for the lead and one per expert, e.g. ds-explainer-ada.
// Never blocks Claude: any failure is swallowed and the hook always exits 0.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

const AWB = join(import.meta.dirname, "..", "awb.mjs");
const oneLine = (text) => text.replace(/\s+/g, " ").trim().slice(0, 80) || "Working";
const expert = (type = "") => type.charAt(0).toUpperCase() + type.slice(1);

const posts = {
  UserPromptSubmit: (h) => ["lead", "Claude (lead)", "running", oneLine(h.prompt || "")],
  Stop: () => ["lead", "Claude (lead)", "review", "Waiting for Sumit"],
  SubagentStart: (h) => [h.agent_type, expert(h.agent_type), "running", "Working on the lead's brief"],
  SubagentStop: (h) => [h.agent_type, expert(h.agent_type), "review", "Handed back to the lead"],
};

try {
  const hook = JSON.parse(readFileSync(0, "utf8"));
  const cwd = hook.cwd || process.cwd();
  const post = posts[hook.hook_event_name];
  const project = basename(cwd.replace(/\/\.claude\/worktrees\/.*$/, "")); // a worktree posts under its main project
  const [who, agent, status, stage] = post ? post(hook) : [];
  if (who && existsSync(join(cwd, ".claude", "team", "handbook.md")))
    spawnSync(process.execPath, [AWB, "task", `${project}-${who}`, "--workstream", project, "--agent", agent,
      "--status", status, "--stage", stage, "--quiet"], { timeout: 5000 });
} catch {}
process.exit(0);
