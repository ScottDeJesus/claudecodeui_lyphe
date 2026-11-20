// protects: /home/lyphe/.claude/hooks/bug_word_prompt.py
// writes: none
//
// The word-back hook runs on EVERY prompt of every chat on this box, so a fault in it must never cost him a prompt.
// Each fault below is run against a scratch dispatcher home: a payload that is not JSON, one that is not an object,
// no session_id, a blank one, a session that is owed nothing, a home with no store at all, and a store file that is
// not a database. Each run exits 0, prints nothing on stdout (no context, no block), and the home that held no store
// still holds none afterwards — a prompt hook never creates the dispatcher's store.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, said } from "../lib/bug_house.mjs";

const HOOK = path.join(os.homedir(), ".claude", "hooks", "bug_word_prompt.py");

function run(file, { env, cwd, input }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, [], { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      resolve({ code: null, out: "", err: String(e?.message ?? e) });
      return;
    }
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

runCase(async (t) => {
  if (!fs.existsSync(HOOK)) return broken(`${HOOK} is not there`);
  const house = await bugHouse(t, "bug-word-faults");
  const owedNothing = `case-quiet-${path.basename(house.dir)}`;
  const filed = await bug(house, ["file", "--title", "An open ticket that owes no word"], { input: "words\n", env: { CLAUDE_CODE_SESSION_ID: owedNothing } });
  if (filed.code !== 0) return broken(`the setup filing failed — ${said(filed)}`);

  const empty = path.join(house.dir, "no-store-home");
  const garbage = path.join(house.dir, "garbage-home");
  fs.mkdirSync(garbage);
  const garbageDb = path.join(garbage, "dispatcher.db");
  const garbageBytes = "this is not a sqlite database\n".repeat(64);
  fs.writeFileSync(garbageDb, garbageBytes);

  const session = (id) => JSON.stringify({ session_id: id, prompt: "x", hook_event_name: "UserPromptSubmit" });
  const faults = [
    ["a payload that is not JSON", house.env, "not json {"],
    ["an empty payload", house.env, ""],
    ["a payload that is a list", house.env, "[1, 2]"],
    ["a payload with no session_id", house.env, JSON.stringify({ prompt: "x" })],
    ["a blank session_id", house.env, session("   ")],
    ["a session_id that is a number", house.env, JSON.stringify({ session_id: 7, prompt: "x" })],
    ["a session owed nothing", house.env, session(owedNothing)],
    ["a home with no store", { ...house.env, DISPATCHER_HOME: empty }, session(owedNothing)],
    ["a store file that is not a database", { ...house.env, DISPATCHER_HOME: garbage }, session(owedNothing)],
  ];
  const wrong = [];
  for (const [what, env, input] of faults) {
    const ran = await run(HOOK, { env, cwd: house.dir, input });
    if (ran.code !== 0 || ran.out.trim() !== "") wrong.push(`${what}: ${said(ran)}`);
  }
  if (fs.existsSync(path.join(empty, "dispatcher.db"))) wrong.push("the hook created a store in a home that held none");
  if (fs.readFileSync(garbageDb, "utf8") !== garbageBytes) wrong.push("the hook rewrote a store file that is not a database");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`all ${faults.length} faults exited 0 with nothing on stdout; no store was created and the garbage file was left as it was`);
});
