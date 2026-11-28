// The engine's visible text and role of a row (rust-transcript-engine, interface 2: extractClaudeSearchableMessage and
// the four shared rules ported) against what chat search's TypeScript gave on 2026-11-28, one row per branch: a turn
// lookalike (api-request-blob) and the resume placeholder are never a hit and never a session's summary text; API
// errors, meta rows, internal prefixes and other roles are refused; a compact summary is assistant text and the summary;
// slash-command tags read as the command line; local-command stdout loses its ANSI; a content array's text parts join
// with one space and a user array loses a leading transparent wrapper. The job is run twice, with transparentWrappers
// ["/plain"] and with [], so the wrapper list is the caller's and not the engine's own.
//
// protects: rust/transcript-engine/src/search/claude_row.rs, rust/transcript-engine/src/search/session_state.rs, server/shared/claude-transcript-rows.ts, server/shared/local-commands.ts
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

const ESC = String.fromCharCode(27);
const tags = (name, message, args) => "<command-name>" + name + "</command-name>\n<command-message>" + message + "</command-message>\n<command-args>" + args + "</command-args>";

/** One row per branch; hit is [text, role] or null, bare the same with no wrapper listed (when it differs). */
const ROWS = [
  { s: "VL", row: { type: "user", message: { role: "user", content: "zqk real prompt" } }, hit: ["zqk real prompt", "user"] },
  { s: "VL", row: { type: "api-request-blob", message: { role: "user", content: "zqk lookalike later" } }, hit: null },
  { s: "VL", row: { type: "api-request-blob", message: { role: "assistant", content: [{ type: "text", text: "zqk lookalike reply" }] } }, hit: null },
  { s: "VP", row: { type: "assistant", message: { role: "assistant", model: "claude-opus-4", content: [{ type: "text", text: "zqk answer" }] } }, hit: ["zqk answer", "assistant"] },
  { s: "VP", row: { type: "assistant", message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text: "No response requested." }] } }, hit: null },
  { s: "V1", row: { type: "assistant", isApiErrorMessage: true, message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text: "zqk api error" }] } }, hit: null },
  { s: "V2", row: { type: "user", isMeta: true, message: { role: "user", content: "zqk meta body" } }, hit: null },
  { s: "V3", row: { type: "user", isMeta: true, isCompactSummary: true, message: { role: "user", content: "zqk compact summary" } }, hit: ["zqk compact summary", "assistant"] },
  { s: "V4", row: { type: "user", message: { role: "user", content: tags("/zqkcmd", "zqkcmd", "alpha") } }, hit: ["/zqkcmd alpha", "user"] },
  { s: "V5", row: { type: "user", message: { role: "user", content: tags("/plain", "plain", "zqk wrapped words") } }, hit: ["zqk wrapped words", "user"], bare: ["/plain zqk wrapped words", "user"] },
  { s: "V6", row: { type: "user", message: { role: "user", content: "<local-command-stdout>" + ESC + "[1mzqk" + ESC + "[22m out </local-command-stdout>" } }, hit: ["zqk out", "assistant"] },
  { s: "V7", row: { type: "user", message: { role: "user", content: "<system-reminder>zqk internal</system-reminder>" } }, hit: null },
  { s: "V8", row: { type: "user", message: { role: "user", content: "Caveat: zqk the messages below" } }, hit: null },
  { s: "V9", row: { type: "user", message: { role: "user", content: [{ type: "text", text: "/plain zqk image words" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }] } }, hit: ["zqk image words", "user"], bare: ["/plain zqk image words", "user"] },
  { s: "V10", row: { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "zqk part one" }, { type: "tool_use", id: "x", name: "Bash", input: { command: "ls" } }, { type: "text", text: "part two" }] } }, hit: ["zqk part one part two", "assistant"] },
  { s: "V11", row: { type: "user", message: { role: "system", content: "zqk system" } }, hit: null },
  { s: "V12", row: { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "/plain zqk not stripped" }] } }, hit: ["/plain zqk not stripped", "assistant"] },
  { s: "V13", row: { type: "user", message: { role: "user", content: "/plain zqk typed" } }, hit: ["/plain zqk typed", "user"] },
  { s: "V14", row: { type: "user", message: { role: "user", content: "<command-name></command-name>zqk" } }, hit: null },
  { s: "V15", row: { type: "user", isCompactSummary: true, message: { role: "user", content: [{ type: "text", text: "zqk compact array" }] } }, hit: ["zqk compact array", "assistant"] },
  { s: "V16", row: { type: "user", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user] zqk" }] } }, hit: null },
  { s: "V17", row: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "zqk result" }] } }, hit: null },
  { s: "V18", row: { type: "user", message: { role: "user", content: "Invalid API key, zqk" } }, hit: null },
];

function expectRecord(wrapped) {
  const matches = [];
  const state = new Map();
  ROWS.forEach((entry, index) => {
    const hit = !wrapped && entry.bare ? entry.bare : entry.hit;
    if (!hit) return;
    const [text, role] = hit;
    const s = state.get(entry.s) || { resolved: null, user: null, assistant: null };
    if (entry.row.isCompactSummary === true) s.resolved = text;
    if (role === "user") s.user = text; else s.assistant = text;
    state.set(entry.s, s);
    matches.push({ session: entry.s, role, text, timestamp: null, uuid: "u" + index });
  });
  const summaries = {};
  for (const [id, s] of state) summaries[id] = s.resolved ?? s.user ?? s.assistant;
  return { i: 0, summaries, matches };
}

runCase(async (t) => {
  const engine = engineProtocol();
  if (engine.why) return broken(engine.why);
  const dir = await scratchDir(t, "engine-search-rows");
  const file = path.join(dir, "branches.jsonl");
  fs.writeFileSync(file, jsonl(ROWS.map((entry, index) => ({ ...entry.row, sessionId: entry.s, uuid: "u" + index }))));
  const sessions = [...new Set(ROWS.map((entry) => entry.s))];
  const wrong = [];
  for (const [label, wrappers] of [["transparentWrappers [\"/plain\"]", ["/plain"]], ["transparentWrappers []", []]]) {
    const records = readRecords(label, search({ words: ["zqk"], maxPerSession: 50, transparentWrappers: wrappers, files: [{ path: file, sessions }] }), engine.protocol, wrong);
    if (!records) continue;
    const want = expectRecord(wrappers.length > 0);
    if (records.length !== 1) { wrong.push(label + ": " + records.length + " records, not 1"); continue; }
    const got = records[0];
    const gotMatches = (got.matches || []).map((m) => canonical(m));
    const wantMatches = want.matches.map((m) => canonical(m));
    const missing = wantMatches.filter((m) => !gotMatches.includes(m));
    const extra = gotMatches.filter((m) => !wantMatches.includes(m));
    if (missing.length || extra.length) wrong.push(label + ": hits missing " + (missing.join(" ").slice(0, 400) || "none") + " | hits extra " + (extra.join(" ").slice(0, 400) || "none"));
    else if (canonical(got) !== canonical(want)) wrong.push(label + ": the record is " + canonical(got).slice(0, 400) + ", not " + canonical(want).slice(0, 400));
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held(ROWS.length + " rows, one per branch: the engine's hits, roles and summaries are chat search's of 2026-11-28 with the wrapper listed and with none (" + expectRecord(true).matches.length + " hits; lookalikes, the resume placeholder, errors, meta, internal and other-role rows refused)");
});
