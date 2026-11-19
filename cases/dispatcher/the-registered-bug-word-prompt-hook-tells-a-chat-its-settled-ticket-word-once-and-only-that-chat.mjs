// protects: /home/lyphe/.claude/hooks/bug_word_prompt.py, /home/lyphe/.claude/settings.json, /home/lyphe/.claude/hooks/HOOKS.toml, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py
// writes: none
//
// The word back to a chat. A ticket a chat filed ends (here by hand, through `store_tickets.end`, as the card line's
// settle ends it) and owes its word to the session that filed it. The command `settings.json` registers on
// UserPromptSubmit for `bug_word_prompt.py` is the one run here — found in the live settings, so a hook dropped from
// the wiring breaks this case as surely as a hook that prints wrong — against a scratch dispatcher home. A prompt
// of another session hears nothing; the chat's first prompt hears `The bug you filed is settled — <word>` and the
// ticket is stamped told; its second prompt hears nothing. Every run exits 0.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, rows, said } from "../lib/bug_house.mjs";

const SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const HOOKS = path.join(os.homedir(), ".claude", "hooks");
const PREFIX = "The bug you filed is settled — ";

function run(command, args, { env, cwd, input = "" }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { err += b; });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, out, err: `${err}${e.message}` }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** The context a UserPromptSubmit hook added: its JSON's additionalContext, or its plain stdout. */
function context(out) {
  const text = out.trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    return String(parsed?.hookSpecificOutput?.additionalContext ?? "");
  } catch {
    return text;
  }
}

runCase(async (t) => {
  const settings = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
  const commands = (settings?.hooks?.UserPromptSubmit ?? []).flatMap((g) => g?.hooks ?? []).map((h) => String(h?.command ?? ""));
  const command = commands.find((c) => /(^|\/)bug_word_prompt\.py(\s|$)/.test(c));
  if (!command) return broken(`settings.json registers no UserPromptSubmit command for bug_word_prompt.py (it registers ${commands.length})`);

  const house = await bugHouse(t, "bug-word");
  const chat = `case-chat-${path.basename(house.dir)}`;
  const other = `case-other-${path.basename(house.dir)}`;
  const filed = await bug(house, ["file", "--title", "A word-back case's bug"], { input: "ran x\nprinted y\n", env: { CLAUDE_CODE_SESSION_ID: chat } });
  const id = Number(filed.out.match(/^FILED ticket (\d+) — /)?.[1]);
  if (filed.code !== 0 || !id) return broken(`the chat's filing did not print FILED — ${said(filed)}`);

  const word = `Fixed: "A word-back case's bug" — it says the right thing now (${path.basename(house.dir)})`;
  const end = await run("python3", ["-I", "-c", [
    "import sys; sys.path.insert(0, sys.argv[1])",
    "from dispatcher import store, store_tickets",
    "conn = store.connect()",
    "with conn: print(store_tickets.end(conn, int(sys.argv[2]), 'fixed', sys.argv[3]))",
  ].join("\n"), HOOKS, String(id), word], { env: house.env, cwd: house.dir });
  if (end.code !== 0 || end.out.trim() !== "True") return broken(`store_tickets.end did not end ticket ${id} — ${said(end)}`);

  const prompt = (session) => run("sh", ["-c", command], {
    env: house.env, cwd: house.repo, input: JSON.stringify({ session_id: session, prompt: "x", hook_event_name: "UserPromptSubmit" }),
  });
  const wrong = [];
  const a = await prompt(other);
  if (a.code !== 0 || context(a.out).includes(word)) wrong.push(`another session's prompt ${a.code !== 0 ? "did not exit 0" : "carried the chat's word"} — ${said(a)}`);
  const b = await prompt(chat);
  if (b.code !== 0 || !context(b.out).split("\n").includes(PREFIX + word)) wrong.push(`the chat's first prompt did not add "${PREFIX}<word>" — ${said(b)}`);
  if (/"decision"\s*:\s*"block"/.test(b.out)) wrong.push("the chat's first prompt was blocked");
  const [stamp] = await rows(house, "SELECT word_told_at FROM tickets WHERE id = ?", [id]);
  if (!stamp?.word_told_at) wrong.push("the ticket was not stamped told after its word was printed");
  const c = await prompt(chat);
  if (c.code !== 0 || context(c.out) !== "") wrong.push(`the chat's second prompt added context again — ${said(c)}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`the registered command (${command}) told ticket ${id}'s word once to its own session, stamped it, and told the other session and the second prompt nothing`);
});
