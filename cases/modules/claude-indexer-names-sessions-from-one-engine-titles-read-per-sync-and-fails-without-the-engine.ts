// The Claude indexer's title read on the engine (rust-transcript-engine, interface 5): synchronize reads every head,
// collects the files whose title must be read and makes ONE readTitleRows call for them; synchronizeFile makes one with
// its own file; pickSessionTitle prefers custom-title over ai-title over last-prompt, the last non-blank string of each
// for the session itself, and history.jsonl's display comes after them; a file whose record is an error has no title;
// a rejected readTitleRows fails the sync. Runs over a scratch HOME (the projects root) and a scratch DATABASE_PATH,
// with the engine behind a wrapper that logs each titles job.
//
// protects: server/modules/providers/list/claude/claude-session-synchronizer.provider.ts, server/modules/transcript-engine/, rust/transcript-engine/src/titles.rs, rust/transcript-engine/src/main.rs
// writes: none

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REAL_ENGINE = process.env.TRANSCRIPT_ENGINE_BIN || path.join(REPO, "rust/target/release/transcript-engine");
const SYNC_MODULE = path.join(REPO, "server/modules/providers/list/claude/claude-session-synchronizer.provider.ts");
const DB_MODULE = path.join(REPO, "server/modules/database/index.ts");

const firstLine = (error: any) => [error?.code, error?.errorCode, String(error?.message ?? error).split("\n")[0]].filter(Boolean).join(" ");
const sid = (n: number) => "a7e0a000-0000-4000-8000-00000000000" + n;
const head = (s: string) => ({ type: "user", sessionId: s, cwd: "/tmp/athena-indexer-project", uuid: "u-" + s, timestamp: "2026-11-28T00:00:00.000Z", message: { role: "user", content: "hello" } });
const ct = (n: number, v: unknown) => ({ type: "custom-title", sessionId: sid(n), customTitle: v });
const ai = (n: number, v: unknown) => ({ type: "ai-title", sessionId: sid(n), aiTitle: v });
const lp = (n: number, v: unknown) => ({ type: "last-prompt", sessionId: sid(n), lastPrompt: v });

runCase(async (t: any) => {
  if (!fs.existsSync(REAL_ENGINE)) return broken("no engine at " + REAL_ENGINE + ": npm run build:engine builds it");
  const dir = await scratchDir(t, "indexer-titles");
  const home = path.join(dir, "home");
  const project = path.join(home, ".claude", "projects", "-tmp-athena-indexer-project");
  fs.mkdirSync(project, { recursive: true });
  const log = path.join(dir, "titles-jobs.log");
  const missing = path.join(dir, "gone", "victim.jsonl");
  const at = (n: number) => path.join(project, sid(n) + ".jsonl");
  const transcript = (file: string, rows: object[], eol = "\n") => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join(eol) + eol);
    return file;
  };

  transcript(at(1), [head(sid(1)), ct(1, "Renamed A"), ai(1, "AI A"), lp(1, "prompt A"), ct(1, 12345), ai(1, "AI A later")]);
  transcript(at(2), [head(sid(2)), ct(2, "   "), ai(2, "AI B first"), lp(2, "prompt B"), ai(2, "AI B last")], "\r\n");
  transcript(at(3), [head(sid(3)), lp(3, "prompt C first"), { type: "custom-title", sessionId: "someone-else", customTitle: "Foreign C" },
    { type: "ai-title", aiTitle: "no session" }, lp(3, "prompt C last")]);
  transcript(at(4), [head(sid(4)), { type: "assistant", sessionId: sid(4), message: { role: "assistant", content: [{ type: "text", text: "hi" }] } }]);
  transcript(at(5), [head(sid(5)), ct(5, "E custom")]);
  transcript(path.join(project, sid(1), "subagents", "agent-athena.jsonl"), [head(sid(1)), ct(1, "SUBAGENT")]);
  fs.writeFileSync(path.join(home, ".claude", "history.jsonl"),
    [[3, "display C"], [4, "display D"], [5, "display E"]].map(([n, display]) => JSON.stringify({ display, sessionId: sid(n as number), timestamp: 1 })).join("\n") + "\n");
  const want: Record<number, string> = { 1: "Renamed A", 2: "AI B last", 3: "prompt C last", 4: "display D", 5: "display E" };

  // The wrapper logs each titles job, and hands the engine a missing path in place of transcript 5: its record is an error.
  const wrapper = path.join(dir, "engine-wrapper.sh");
  fs.writeFileSync(wrapper, [
    "#!/bin/bash",
    "verb=; skip=0",
    "for a in \"$@\"; do",
    "  if [ \"$skip\" = 1 ]; then skip=0; continue; fi",
    "  case \"$a\" in --threads) skip=1 ;; --*) ;; *) verb=\"$a\"; break ;; esac",
    "done",
    "if [ \"$verb\" = titles ]; then",
    "  job=\"" + dir + "/job.$$.json\"",
    "  cat > \"$job\"",
    "  { cat \"$job\"; echo; } >> \"" + log + "\"",
    "  sed 's#" + at(5) + "#" + missing + "#g' \"$job\" | \"" + REAL_ENGINE + "\" \"$@\"",
    "  exit $?",
    "fi",
    "exec \"" + REAL_ENGINE + "\" \"$@\"",
  ].join("\n") + "\n", { mode: 0o755 });

  const saved = { HOME: process.env.HOME, DATABASE_PATH: process.env.DATABASE_PATH, TRANSCRIPT_ENGINE_BIN: process.env.TRANSCRIPT_ENGINE_BIN };
  const databasePath = path.join(dir, "auth.db");
  fs.writeFileSync(databasePath, "");
  process.env.HOME = home;
  process.env.DATABASE_PATH = databasePath;
  process.env.TRANSCRIPT_ENGINE_BIN = wrapper;
  try {
    const database: any = await import(DB_MODULE);
    await database.initializeDatabase();
    const connection = database.getConnection();
    if (path.resolve(String(connection.name)) !== path.resolve(databasePath)) return cannotRun("the database opened " + connection.name + ", not the scratch DATABASE_PATH");
    const indexer: any = await import(SYNC_MODULE);
    if (!String(indexer.CLAUDE_PROJECTS_ROOT).startsWith(home + path.sep)) return cannotRun("the projects root resolved to " + indexer.CLAUDE_PROJECTS_ROOT + ", not under the scratch HOME");

    const nameOf = (s: string) => {
      const row = connection.prepare("SELECT * FROM sessions").all().find((r: any) => Object.values(r).includes(s));
      return row ? row.custom_name : undefined;
    };
    const jobs = (): unknown[] => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter((l) => l.trim()) : []).map((l) => {
      try { return JSON.parse(l).files; } catch { return "an unreadable job " + l.slice(0, 60); }
    });
    const listed = (some: unknown[]) => some.reduce((n: number, files) => n + (Array.isArray(files) ? files.length : 1), 0);
    const short = (files: unknown) => (Array.isArray(files) ? JSON.stringify(files.map((f) => path.relative(project, String(f)))) : String(files));
    const wrong: string[] = [];
    const sync = new indexer.ClaudeSessionSynchronizer();

    try { await sync.synchronize(); } catch (error) { return broken("the first sync rejected: " + firstLine(error)); }
    const first = jobs();
    const expected = [1, 2, 3, 4, 5].map(at).sort();
    if (first.length !== 1) wrong.push("the first sync ran titles " + first.length + " times, not once");
    else if (!Array.isArray(first[0]) || JSON.stringify([...first[0]].sort()) !== JSON.stringify(expected)) wrong.push("the first sync's titles job listed " + short(first[0]) + ", not the five top-level transcripts");
    for (const [n, title] of Object.entries(want)) {
      const got = nameOf(sid(Number(n)));
      if (got !== title) wrong.push("session " + n + " is named " + JSON.stringify(got) + ", not " + JSON.stringify(title));
    }

    const afterFirst = jobs().length;
    try { await sync.synchronize(); } catch (error) { wrong.push("the second sync rejected: " + firstLine(error)); }
    const second = jobs().slice(afterFirst);
    if (listed(second) !== 0) wrong.push("the second sync, every session already named, handed titles " + listed(second) + " files");

    const fFile = transcript(at(6), [head(sid(6)), ai(6, "AI F"), ct(6, "F custom")]);
    const afterSecond = jobs().length;
    try { await sync.synchronizeFile(fFile); } catch (error) { wrong.push("synchronizeFile rejected: " + firstLine(error)); }
    const third = jobs().slice(afterSecond);
    if (third.length !== 1 || JSON.stringify(third[0]) !== JSON.stringify([fFile])) wrong.push("synchronizeFile ran titles " + third.length + " times with " + third.map(short).join(" "));
    if (nameOf(sid(6)) !== "F custom") wrong.push("synchronizeFile named session 6 " + JSON.stringify(nameOf(sid(6))) + ", not \"F custom\"");

    transcript(at(7), [head(sid(7)), ct(7, "G custom")]);
    process.env.TRANSCRIPT_ENGINE_BIN = path.join(dir, "no-such-engine");
    let gone: string;
    try { gone = "resolved " + (await sync.synchronize()); } catch (error) { gone = "rejected " + firstLine(error); }
    if (!/TRANSCRIPT_ENGINE_UNAVAILABLE/.test(gone)) wrong.push("with no engine binary the sync " + gone.slice(0, 160) + ", not a TRANSCRIPT_ENGINE_UNAVAILABLE rejection");

    if (wrong.length) return broken(wrong.join("; "));
    return held("one titles job of the 5 top-level transcripts (no subagents/ copy) named them custom-title > ai-title > last-prompt > display, the error record took the display; " +
      "a second sync handed titles no file; synchronizeFile one job of its file; with no binary the sync " + gone.slice(0, 80));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
