// protects: server/modules/analytics/sections/repeats.ts, server/modules/analytics/sections/verb.ts, server/modules/analytics/sections/code-mode.ts, server/modules/analytics/sections/index.ts, server/modules/analytics/analytics.module.ts
// writes: none
//
// The repeats reader on the shared verb runner: the reader table built with healRepeatsBin pointed at a scratch verb
// holds a repeats row that runs "<bin> reading --days 7" through sections/verb.ts's runVerbForJson, takes the LAST
// stdout line past any chatter and carries heal-repeats reading's own answer (fed from a live reading); a missing bin, a
// last line that is not JSON and an answer without totals each throw ONE line naming heal-repeats. code-mode.ts and
// repeats.ts both run their verb through verb.ts and neither starts a process itself, and the code-mode reader's
// missing-bin sentence still names its verb and path. analytics.module.ts reads HEAL_REPEATS_BIN with
// ~/.claude/scripts/heal-repeats as its default.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SECTIONS = path.join(REPO, "server/modules/analytics/sections");
const MODULE = path.join(REPO, "server/modules/analytics/analytics.module.ts");
const VERB = path.join(os.homedir(), ".claude", "scripts", "heal-repeats");
const SCRATCH_PREFIX = "case-repeats-reader-";

const first = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0];

function canon(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canon).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canon((value as any)[k])).join(",") + "}";
  return JSON.stringify(value === undefined ? null : value);
}

function text(file: string): string {
  try { return readFileSync(file, "utf8"); } catch { return ""; }
}

function lastLine(bin: string, args: string[]): string {
  const out = execFileSync(bin, args, { cwd: os.homedir(), encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  const line = out.trim().split("\n").pop() || "";
  JSON.parse(line);
  return line;
}

function stub(dir: string, name: string, body: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, "#!/bin/sh\n" + body + "\n");
  chmodSync(file, 0o755);
  return file;
}

runCase(async () => {
  const wrong: string[] = [];
  if (!/export\s+async\s+function\s+runVerbForJson\b/.test(text(path.join(SECTIONS, "verb.ts")))) return broken("sections/verb.ts exports no runVerbForJson");
  for (const name of ["code-mode.ts", "repeats.ts"]) {
    const t = text(path.join(SECTIONS, name));
    if (!t) { wrong.push("sections/" + name + " is not on disk"); continue; }
    if (!/from\s+['"]\.\/verb\.js['"]/.test(t) || !/runVerbForJson\s*\(/.test(t)) wrong.push("sections/" + name + " does not run its verb through verb.ts's runVerbForJson");
    if (/\bexecFile|child_process/.test(t)) wrong.push("sections/" + name + " starts a process itself");
  }
  const mod = text(MODULE);
  if (!/process\.env\.HEAL_REPEATS_BIN/.test(mod)) wrong.push("analytics.module.ts does not read HEAL_REPEATS_BIN");
  if (!/['"]scripts['"]\s*,\s*['"]heal-repeats['"]/.test(mod)) wrong.push("analytics.module.ts names no default ~/.claude/scripts/heal-repeats");

  let line: string;
  try { line = lastLine(VERB, ["reading", "--days", "7"]); } catch (e) { return cannotRun("heal-repeats reading --days 7 did not answer one JSON line: " + first(e)); }
  let index: any;
  try { index = await import(pathToFileURL(path.join(SECTIONS, "index.ts")).href); } catch (e) { return broken("sections/index.ts would not load: " + first(e)); }
  if (typeof index.createAnalyticsReaders !== "function") return broken("sections/index.ts exports no createAnalyticsReaders");

  const dir = mkdtempSync(path.join(os.tmpdir(), SCRATCH_PREFIX));
  try {
    const answer = JSON.parse(line);
    writeFileSync(path.join(dir, "answer.json"), line + "\n");
    const shorn = { ...answer };
    delete shorn.totals;
    writeFileSync(path.join(dir, "shorn.json"), JSON.stringify(shorn) + "\n");
    const args = path.join(dir, "args");
    const ok = stub(dir, "ok", "printf '%s\\n' \"$*\" > '" + args + "'\necho 'noting folders'\ncat '" + path.join(dir, "answer.json") + "'");
    const shornBin = stub(dir, "shorn", "cat '" + path.join(dir, "shorn.json") + "'");
    const chatter = stub(dir, "chatter", "echo 'not an answer'");
    const absent = path.join(dir, "not-here");
    const build = (healRepeatsBin: string) => index.createAnalyticsReaders({ codeModeBin: absent, webWalkBin: absent, healRepeatsBin });

    const table = build(ok);
    if (typeof table.repeats !== "function") return broken("the reader table holds no repeats row (it holds " + Object.keys(table).join(", ") + ")");
    if (typeof table["code-mode"] !== "function") wrong.push("the reader table lost its code-mode row");
    let got: any;
    try { got = await table.repeats(7); } catch (e) { return broken("the repeats reader threw on heal-repeats reading's own answer: " + first(e)); }
    const said = text(args).trim();
    if (said !== "reading --days 7") wrong.push("the reader ran the verb with " + JSON.stringify(said) + ", not reading --days 7");
    for (const key of ["days", "today", "first_day", "window_days", "thresholds", "totals", "steps", "series", "families"]) {
      if (canon(got && got[key]) !== canon(answer[key])) wrong.push("the reader's " + key + " is not the verb's");
    }

    const failure = async (bin: string, id: string): Promise<string | null> => {
      try { await build(bin)[id](7); return null; } catch (e) { return String((e as Error).message); }
    };
    const one = (s: string) => s.trim() !== "" && !/[\r\n]/.test(s);
    const checks: [string, string | null, (s: string) => boolean][] = [
      ["a missing bin", await failure(absent, "repeats"), (s) => /heal-repeats/.test(s) && s.includes(absent)],
      ["a last line that is not JSON", await failure(chatter, "repeats"), (s) => /heal-repeats reading/.test(s)],
      ["an answer without totals", await failure(shornBin, "repeats"), (s) => /heal-repeats/.test(s) && /totals/.test(s)],
      ["the code-mode reader's missing bin", await failure(absent, "code-mode"), (s) => /code-mode/.test(s) && s.includes(absent)],
    ];
    for (const [what, s, fits] of checks) {
      if (s === null) wrong.push(what + " did not throw");
      else if (!one(s) || !fits(s)) wrong.push(what + " threw " + JSON.stringify(s.slice(0, 160)));
    }
    if (wrong.length) return broken(wrong.join("; "));
    return held("the repeats row ran 'reading --days 7' through verb.ts, carried the verb's answer past a chatter line (" + (answer.families || []).length + " families, " + ((answer.totals || {}).launches) + " launches); a missing bin, a non-JSON line and a missing totals each threw one heal-repeats line; code-mode still answers through the same runner; HEAL_REPEATS_BIN read with its default");
  } finally {
    if (dir.startsWith(path.join(os.tmpdir(), SCRATCH_PREFIX))) rmSync(dir, { recursive: true, force: true });
  }
});
