// protects: server/modules/analytics/sections/verb.ts, server/modules/analytics/sections/web-walk.ts, server/modules/analytics/sections/code-mode.ts, server/modules/analytics/sections/index.ts
// writes: none
//
// The server half of the web-walk seam, run against scratch stand-ins for the two house verbs, each fed the real
// verb's own answer: the reader table holds a web-walk row beside code-mode; the web-walk reader runs
// <bin> reading --days N and answers the verb's LAST stdout line as printed; a missing key, a failing verb and an absent
// bin each throw one sentence naming what went wrong; and the run-a-verb code is one file (sections/verb.ts), which the
// code-mode reader takes its last line through too, no section spawning a child of its own.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SECTIONS = path.join(REPO, "server/modules/analytics/sections");
const SCRIPTS = path.join(os.homedir(), ".claude", "scripts");
const SCRATCH_PREFIX = "case-web-walk-reader-";

const first = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0];

function canon(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(canon).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canon(value[k])).join(",") + "}";
  return JSON.stringify(value === undefined ? null : value);
}

function firstDiff(a: any, b: any): string {
  for (const key of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    if (canon(a?.[key]) !== canon(b?.[key])) return key + ": reader " + canon(a?.[key]).slice(0, 120) + ", verb " + canon(b?.[key]).slice(0, 120);
  }
  return "none";
}

function lastLine(bin: string, args: string[]): string {
  const out = execFileSync(bin, args, { cwd: os.homedir(), timeout: 60000, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" });
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

function textOf(name: string): string | null {
  try { return readFileSync(path.join(SECTIONS, name), "utf8"); } catch { return null; }
}

async function judge(index: any, dir: string, webLine: string, codeLine: string) {
  const wrong: string[] = [];
  const webAnswer = JSON.parse(webLine);
  const codeAnswer = JSON.parse(codeLine);
  const lacking = JSON.parse(webLine);
  if (lacking.totals && typeof lacking.totals === "object") delete lacking.totals.faults;
  writeFileSync(path.join(dir, "web.json"), webLine + "\n");
  writeFileSync(path.join(dir, "lacking.json"), JSON.stringify(lacking) + "\n");
  writeFileSync(path.join(dir, "code.json"), codeLine + "\n");
  const args = path.join(dir, "args");
  const said = "echo 'a line said before the answer'\n";
  const webOk = stub(dir, "web-ok", "printf '%s\\n' \"$*\" > '" + args + "'\n" + said + "exec /bin/cat '" + path.join(dir, "web.json") + "'");
  const webLacking = stub(dir, "web-lacking", said + "exec /bin/cat '" + path.join(dir, "lacking.json") + "'");
  const webFails = stub(dir, "web-fails", "echo 'the stand-in fell over' >&2\nexit 3");
  const codeOk = stub(dir, "code-ok", said + "exec /bin/cat '" + path.join(dir, "code.json") + "'");
  const absent = path.join(dir, "not-here");

  const table = index.createAnalyticsReaders({ codeModeBin: codeOk, webWalkBin: webOk });
  if (typeof table["web-walk"] !== "function") return broken("the reader table holds no web-walk row (it holds " + Object.keys(table).join(", ") + ")");
  if (typeof table["code-mode"] !== "function") wrong.push("the reader table lost its code-mode row");
  let got: any;
  try { got = await table["web-walk"](7); } catch (e) { return broken("the web-walk reader threw on the command's own answer: " + first(e)); }
  if (canon(got) !== canon(webAnswer)) wrong.push("the web-walk reader did not answer the command's last line as printed: " + firstDiff(got, webAnswer));
  let asked = "";
  try { asked = readFileSync(args, "utf8").trim(); } catch { asked = "(nothing)"; }
  if (asked !== "reading --days 7") wrong.push("the web-walk reader ran <bin> " + JSON.stringify(asked) + ", not reading --days 7");
  if (typeof table["code-mode"] === "function") {
    try {
      const c = await table["code-mode"](7);
      if (canon(c) !== canon(codeAnswer)) wrong.push("the code-mode reader no longer answers its verb's last line as printed: " + firstDiff(c, codeAnswer));
    } catch (e) { wrong.push("the code-mode reader threw on its verb's own answer: " + first(e)); }
  }

  const sentence = async (codeModeBin: string, webWalkBin: string, id: string): Promise<string | null> => {
    try { await index.createAnalyticsReaders({ codeModeBin, webWalkBin })[id](7); return null; } catch (e) { return String((e as Error).message); }
  };
  const one = (s: string) => !/[\r\n]/.test(s);
  const lackingSaid = await sentence(codeOk, webLacking, "web-walk");
  if (lackingSaid === null) wrong.push("an answer without totals.faults was carried, not refused");
  else if (!/faults/.test(lackingSaid) || !one(lackingSaid)) wrong.push("an answer without totals.faults threw " + JSON.stringify(lackingSaid) + ", not one line naming faults");
  const failSaid = await sentence(codeOk, webFails, "web-walk");
  if (failSaid === null) wrong.push("a verb that exited 3 was answered, not refused");
  else if (!failSaid.includes("the stand-in fell over") || !/web-walk/.test(failSaid) || !one(failSaid)) wrong.push("a verb that exited 3 threw " + JSON.stringify(failSaid) + ", not one line naming web-walk with its stderr");
  const absentSaid = await sentence(codeOk, absent, "web-walk");
  if (absentSaid === null || !absentSaid.includes(absent)) wrong.push("an absent web-walk bin threw " + JSON.stringify(absentSaid) + ", not a sentence naming its path");
  const codeAbsent = await sentence(absent, webOk, "code-mode");
  if (codeAbsent === null || !codeAbsent.includes(absent) || !/code-mode/.test(codeAbsent)) wrong.push("an absent code-mode bin threw " + JSON.stringify(codeAbsent) + ", not a code-mode sentence naming its path");

  for (const name of ["code-mode.ts", "web-walk.ts"]) {
    const text = textOf(name);
    if (text === null) { wrong.push("sections/" + name + " is not on disk"); continue; }
    if (/child_process|execFile|spawn\(/.test(text)) wrong.push("sections/" + name + " runs a child of its own instead of going through verb.ts");
    if (!/from ['"]\.\/verb\.js['"]/.test(text)) wrong.push("sections/" + name + " does not import ./verb.js");
  }
  const runner = textOf("verb.ts");
  if (runner === null || !/execFile/.test(runner)) wrong.push("sections/verb.ts is not on disk or does not run the verb");

  if (wrong.length) return broken(wrong.slice(0, 5).join("; "));
  return held("web-walk ran reading --days 7 and carried the verb's last line as printed (" + Object.keys(webAnswer).length + " keys); a missing totals.faults, an exit 3 and an absent bin each threw one sentence (" + JSON.stringify(lackingSaid) + "); code-mode took its last line through the same runner; only verb.ts runs a child");
}

runCase(async () => {
  let index: any;
  try { index = await import(pathToFileURL(path.join(SECTIONS, "index.ts")).href); } catch (e) { return broken("sections/index.ts would not load: " + first(e)); }
  if (typeof index.createAnalyticsReaders !== "function") return broken("sections/index.ts exports no createAnalyticsReaders");
  let webLine: string;
  let codeLine: string;
  try { webLine = lastLine(path.join(SCRIPTS, "web-walk"), ["reading", "--days", "7"]); } catch (e) { return cannotRun("web-walk reading --days 7 did not answer one JSON line: " + first(e)); }
  try { codeLine = lastLine(path.join(SCRIPTS, "code-mode"), ["analytics", "--days", "7"]); } catch (e) { return cannotRun("code-mode analytics --days 7 did not answer one JSON line: " + first(e)); }
  const dir = mkdtempSync(path.join(os.tmpdir(), SCRATCH_PREFIX));
  try {
    return await judge(index, dir, webLine, codeLine);
  } finally {
    if (path.basename(dir).startsWith(SCRATCH_PREFIX)) rmSync(dir, { recursive: true, force: true });
  }
});
