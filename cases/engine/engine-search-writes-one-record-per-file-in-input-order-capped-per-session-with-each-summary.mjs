// The engine's search verb (rust-transcript-engine, interface 2): the header line, then one record per file in input
// order whatever order its threads finish in: {i} when the gate refused the file or no row is a hit, {i,error} for an
// unreadable file, else the hits in line order, at most maxPerSession per session id, rows of unlisted sessions skipped,
// a row without sessionId belonging to the last row's, and one summary per matched session (a summary row resolved by
// leafUuid and parentUuid, else the last user text, else the last assistant text). A closed stdout or a SIGTERM ends it
// quietly. Runs the built binary (TRANSCRIPT_ENGINE_BIN when set, as the door reads it) over transcripts the case writes.
//
// protects: rust/transcript-engine/src/search/, rust/transcript-engine/src/main.rs, rust/transcript-engine/src/lines.rs
// writes: none

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENGINE = process.env.TRANSCRIPT_ENGINE_BIN || path.join(REPO, "rust/target/release/transcript-engine");
const RUN_MS = 60000;

/** Keys sorted at every depth: two records compare by content, never by key order. */
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

const jsonl = (rows) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
const search = (job, args = []) => spawnSync(ENGINE, [...args, "search"], { input: JSON.stringify(job), encoding: "utf8", timeout: RUN_MS, maxBuffer: 256 * 1024 * 1024 });

/** The engine's protocol from --version, or a reason it would not answer. */
function engineProtocol() {
  const version = spawnSync(ENGINE, ["--version"], { encoding: "utf8", timeout: RUN_MS });
  if (version.error) return { why: "the engine " + ENGINE + " would not run (" + (version.error.code || version.error.message) + "): npm run build:engine builds it" };
  const said = (version.stdout || "").trim();
  const match = /^transcript-engine (\S+) protocol (\d+)$/.exec(said);
  if (version.status !== 0 || !match) return { why: "--version exited " + version.status + " printing " + JSON.stringify(said.slice(0, 120)) };
  return { protocol: Number(match[2]), said };
}

/** The records after the search header, or null with the reason pushed on wrong. */
function readRecords(label, out, protocol, wrong) {
  if (out.error || out.status !== 0) {
    wrong.push(label + ": exited " + (out.status ?? out.signal) + " " + String(out.stderr || "").trim().split("\n").pop());
    return null;
  }
  const lines = out.stdout.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  let head;
  try { head = canonical(JSON.parse(lines[0])); } catch { head = String(lines[0]); }
  if (head !== canonical({ engine: "transcript-engine", protocol, verb: "search" })) {
    wrong.push(label + ": the first line is " + String(lines[0]).slice(0, 120) + ", not the search header");
    return null;
  }
  const records = [];
  for (const line of lines.slice(1)) {
    try { records.push(JSON.parse(line)); } catch { wrong.push(label + ": an unparseable record " + line.slice(0, 80)); return null; }
  }
  return records;
}

const WORD = "zqalpha";
const T = "2026-11-28T01:00:00.000Z";
const SPREAD = 40;
const PAD_ROWS = 20000;

function buildJob(dir) {
  const files = [];
  const want = [];
  const add = (name, rows, sessions, expected) => {
    const file = path.join(dir, name);
    if (rows) fs.writeFileSync(file, jsonl(rows));
    files.push({ path: file, sessions });
    want.push({ i: want.length, ...expected });
  };
  add("gated.jsonl", [{ type: "user", sessionId: "S0", uuid: "z0", message: { role: "user", content: "zqbeta only here" } }], ["S0"], {});
  add("missing.jsonl", null, ["S0"], { error: true });
  add("rich.jsonl", [
    { type: "user", sessionId: "S1", uuid: "u0", timestamp: T, message: { role: "user", content: "hello there" } },
    { type: "summary", summary: "Summary of S1", leafUuid: "L1" },
    { type: "user", sessionId: "S1", uuid: "u1", parentUuid: "L1", timestamp: T, message: { role: "user", content: WORD + " one" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: WORD + " two" }] } },
    { type: "user", sessionId: "S1", uuid: "u3", timestamp: T, message: { role: "user", content: WORD + " three" } },
    { type: "user", sessionId: "S2", uuid: "u4", timestamp: T, message: { role: "user", content: WORD + " four" } },
    { type: "user", sessionId: "S3", uuid: "u5", timestamp: T, message: { role: "user", content: WORD + " five" } },
    { type: "assistant", sessionId: "S3", uuid: "u6", message: { role: "assistant", content: WORD + " six reply" } },
    { type: "user", sessionId: "S3", uuid: "u7", message: { role: "user", content: "later words" } },
    { type: "user", sessionId: "S4", uuid: "u8", message: { role: "user", content: "nothing to see" } },
    { type: "assistant", sessionId: "S5", uuid: "u9", message: { role: "assistant", content: [{ type: "text", text: WORD + " seven" }] } },
  ], ["S1", "S3", "S4", "S5"], {
    summaries: { S1: "Summary of S1", S3: "later words", S5: WORD + " seven" },
    matches: [
      { session: "S1", role: "user", text: WORD + " one", timestamp: T, uuid: "u1" },
      { session: "S1", role: "assistant", text: WORD + " two", timestamp: null, uuid: null },
      { session: "S3", role: "user", text: WORD + " five", timestamp: T, uuid: "u5" },
      { session: "S3", role: "assistant", text: WORD + " six reply", timestamp: null, uuid: "u6" },
      { session: "S5", role: "assistant", text: WORD + " seven", timestamp: null, uuid: "u9" },
    ],
  });
  add("tool-only.jsonl", [{ type: "assistant", sessionId: "S9", uuid: "t1", message: { role: "assistant", content: [{ type: "tool_use", id: "x", name: "Bash", input: { command: "echo " + WORD } }] } }], ["S9"], {});
  for (let k = 0; k < SPREAD; k += 1) {
    const rows = [];
    if (k % 7 === 0) for (let n = 0; n < PAD_ROWS; n += 1) rows.push({ type: "user", sessionId: "PAD", uuid: "pad" + n, message: { role: "user", content: WORD + " pad " + n } });
    rows.push({ type: "user", sessionId: "M" + k, uuid: "m" + k, message: { role: "user", content: WORD + " file " + k } });
    add("spread-" + k + ".jsonl", rows, ["M" + k], {
      summaries: { ["M" + k]: WORD + " file " + k },
      matches: [{ session: "M" + k, role: "user", text: WORD + " file " + k, timestamp: null, uuid: "m" + k }],
    });
  }
  return { job: { words: [WORD], maxPerSession: 2, transparentWrappers: ["/plain"], files }, want };
}

function judgeRecords(label, records, want, wrong) {
  if (records.length !== want.length) wrong.push(label + ": " + records.length + " records, not " + want.length);
  for (let i = 0; i < Math.min(records.length, want.length); i += 1) {
    const got = records[i];
    if (want[i].error) {
      const keys = Object.keys(got || {}).sort().join(",");
      if (keys !== "error,i" || got.i !== i || typeof got.error !== "string" || !got.error) {
        wrong.push(label + ": record " + i + " (a missing file) is " + JSON.stringify(got).slice(0, 160) + ", not {i:" + i + ",error:<reason>}");
        return;
      }
      continue;
    }
    if (canonical(got) !== canonical(want[i])) {
      wrong.push(label + ": record " + i + " is " + canonical(got).slice(0, 260) + ", not " + canonical(want[i]).slice(0, 260));
      return;
    }
  }
}

/** Start a job whose records overflow the pipe, then stop it at its first output. */
function stopEarly(job, how) {
  return new Promise((resolve) => {
    const child = spawn(ENGINE, ["search"], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(job));
    const timer = setTimeout(() => child.kill("SIGKILL"), RUN_MS);
    child.stdout.once("data", () => {
      if (how === "close") child.stdout.destroy();
      else { child.stdout.pause(); setTimeout(() => child.kill("SIGTERM"), 200); }
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      setTimeout(() => resolve({ code, signal, stderr: stderr.trim() }), 200);
    });
  });
}

runCase(async (t) => {
  const engine = engineProtocol();
  if (engine.why) return broken(engine.why);
  const dir = await scratchDir(t, "engine-search-records");
  const { job, want } = buildJob(dir);
  const wrong = [];
  for (const [label, args] of [["search", []], ["--threads 3 search", ["--threads", "3"]]]) {
    const records = readRecords(label, search(job, args), engine.protocol, wrong);
    if (records) judgeRecords(label, records, want, wrong);
  }
  if (wrong.length) return broken(wrong.join("; "));

  const bigFiles = [];
  for (let k = 0; k < 300; k += 1) {
    const file = path.join(dir, "big-" + k + ".jsonl");
    fs.writeFileSync(file, jsonl([{ type: "user", sessionId: "Q" + k, uuid: "q" + k, message: { role: "user", content: WORD + " " + "x".repeat(8000) } }]));
    bigFiles.push({ path: file, sessions: ["Q" + k] });
  }
  const big = { words: [WORD], maxPerSession: 2, transparentWrappers: ["/plain"], files: bigFiles };
  const closed = await stopEarly(big, "close");
  if (closed.stderr || closed.signal === "SIGABRT" || closed.signal === "SIGSEGV") {
    wrong.push("a closed stdout ended it " + (closed.signal || "exit " + closed.code) + " saying " + JSON.stringify(closed.stderr.slice(0, 160)));
  }
  const termed = await stopEarly(big, "term");
  if (termed.stderr) wrong.push("SIGTERM mid-run ended it saying " + JSON.stringify(termed.stderr.slice(0, 160)));
  if (wrong.length) return broken(wrong.join("; "));
  return held("search over " + want.length + " files wrote the header and one record each in input order, by default and with --threads 3: " +
    "{i} for a gated and a tool-only file, {i,error} for a missing one, hits capped at 2 per session with unlisted sessions skipped and " +
    "summaries resolved, last-user and last-assistant; a closed stdout (" + (closed.signal || "exit " + closed.code) + ") and a SIGTERM end it with nothing on stderr");
});
