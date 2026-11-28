// The engine's usage verb (rust-transcript-engine, interface 2): the header line first, then one record per
// assistant row whose message carries a usage object, in file order, isSidechain and id only as written, usage
// verbatim. An unreadable file is exit 3 with one stderr line; a closed stdout or a SIGTERM ends it quietly.
// Runs the built binary (TRANSCRIPT_ENGINE_BIN when set, as the door reads it) over transcripts the case writes.
//
// protects: rust/transcript-engine/, rust/Cargo.toml, rust/Cargo.lock, rust/rust-toolchain.toml
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
const BIG_ROWS = 20000;

/** Keys sorted at every depth: two records compare by content, never by key order. */
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

const usage = (n) => ({
  input_tokens: n,
  cache_creation_input_tokens: 10 * n,
  cache_read_input_tokens: 100 * n,
  output_tokens: n + 7,
  service_tier: "standard",
  cache_creation: { ephemeral_5m_input_tokens: 10 * n, ephemeral_1h_input_tokens: 0 },
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
});

/** A transcript holding every line shape the verb must read or skip, and the records it must write. */
function fixture() {
  const lines = [];
  const want = [];
  const row = (value) => lines.push(Buffer.from(JSON.stringify(value)));
  row({ type: "user", sessionId: "s1", uuid: "u1", message: { role: "user", content: "hello", usage: usage(1) } });
  row({ parentUuid: "u1", isSidechain: false, type: "assistant", uuid: "a1", timestamp: "2026-11-28T00:00:00.000Z",
    message: { id: "msg_A", model: "claude-x", role: "assistant", content: [{ type: "text", text: "hi" }], usage: usage(2) },
    somethingNew: { deep: [1, 2, { x: null }] } });
  want.push({ type: "assistant", isSidechain: false, message: { id: "msg_A", usage: usage(2) } });
  lines.push(Buffer.from(""), Buffer.from("   \t  "), Buffer.from("{not json at all"));
  lines.push(Buffer.from("  " + JSON.stringify({ type: "assistant", isSidechain: true, message: { role: "assistant", usage: usage(3) } }) + "  \r"));
  want.push({ type: "assistant", isSidechain: true, message: { usage: usage(3) } });
  row({ type: "assistant", isSidechain: false, message: { id: "msg_C", content: [] } });
  const [head, tail] = JSON.stringify({ type: "assistant", message: { id: "msg_D", content: [{ type: "text", text: "@@BAD@@" }], usage: usage(4) } }).split("@@BAD@@");
  lines.push(Buffer.concat([Buffer.from(head), Buffer.from([0xff, 0xfe, 0x80]), Buffer.from(tail)]));
  want.push({ type: "assistant", message: { id: "msg_D", usage: usage(4) } });
  // A message id that is a number: the typed shape refuses the row, the Value read takes it as written.
  row({ type: "assistant", isSidechain: false, message: { id: 12345, usage: usage(5) } });
  want.push({ type: "assistant", isSidechain: false, message: { id: 12345, usage: usage(5) } });
  row({ type: "assistant", message: { id: "msg_F", usage: 5 } });
  lines.push(Buffer.from("[1,2,3]"), Buffer.from("\"a string\""), Buffer.from("42"));
  row({ type: "summary", summary: "x", leafUuid: "a1" });
  row({ type: "assistant", isSidechain: false, message: { id: "msg_G", content: [{ type: "text", text: "x".repeat(1 << 20) }], usage: usage(6) } });
  want.push({ type: "assistant", isSidechain: false, message: { id: "msg_G", usage: usage(6) } });
  row({ type: "assistant", message: { id: "msg_H", usage: usage(7) } }); // the last line: no newline after it
  want.push({ type: "assistant", message: { id: "msg_H", usage: usage(7) } });
  const bytes = Buffer.concat(lines.flatMap((line, index) => (index < lines.length - 1 ? [line, Buffer.from("\n")] : [line])));
  return { bytes, want, lineCount: lines.length };
}

const run = (args) => spawnSync(ENGINE, args, { encoding: "utf8", timeout: RUN_MS, maxBuffer: 256 * 1024 * 1024 });

/** Start the verb on a transcript whose records overflow the pipe, then stop it at its first output. */
function stopEarly(file, how) {
  return new Promise((resolve) => {
    const child = spawn(ENGINE, ["usage", file], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
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
  const version = run(["--version"]);
  if (version.error) return broken("the engine " + ENGINE + " would not run (" + (version.error.code || version.error.message) + "): npm run build:engine builds it");
  const said = (version.stdout || "").trim();
  const match = /^transcript-engine (\S+) protocol (\d+)$/.exec(said);
  if (version.status !== 0 || !match) return broken("--version exited " + version.status + " printing " + JSON.stringify(said.slice(0, 120)));
  const header = canonical({ engine: "transcript-engine", protocol: Number(match[2]), verb: "usage" });

  const dir = await scratchDir(t, "engine-usage");
  const file = path.join(dir, "edges.jsonl");
  const { bytes, want, lineCount } = fixture();
  fs.writeFileSync(file, bytes);
  const wrong = [];

  const judge = (label, out) => {
    if (out.error || out.status !== 0) {
      wrong.push(label + ": exited " + (out.status ?? out.signal) + " " + String(out.stderr || "").trim().split("\n").pop());
      return;
    }
    const lines = out.stdout.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    let first;
    try { first = canonical(JSON.parse(lines[0])); } catch { first = JSON.stringify(lines[0]); }
    if (first !== header) wrong.push(label + ": the first line is " + String(lines[0]).slice(0, 120) + ", not the header");
    const records = lines.slice(1);
    if (records.length !== want.length) wrong.push(label + ": " + records.length + " records, not " + want.length);
    for (let i = 0; i < Math.min(records.length, want.length); i += 1) {
      let got;
      try { got = canonical(JSON.parse(records[i])); } catch { got = "unparseable " + records[i].slice(0, 80); }
      if (got !== canonical(want[i])) {
        wrong.push(label + ": record " + i + " is " + got.slice(0, 160) + ", not " + canonical(want[i]).slice(0, 160));
        break;
      }
    }
  };
  judge("usage", run(["usage", file]));
  judge("--threads 2 usage", run(["--threads", "2", "usage", file]));

  for (const [label, target] of [["a missing file", path.join(dir, "no-such.jsonl")], ["a directory", dir]]) {
    const out = run(["usage", target]);
    const errLines = String(out.stderr || "").trim().split("\n").filter(Boolean);
    if (out.status !== 3 || errLines.length !== 1) {
      wrong.push("usage of " + label + ": exit " + (out.status ?? out.signal) + " with " + errLines.length + " stderr lines, not exit 3 with one");
    }
  }

  const big = path.join(dir, "big.jsonl");
  const bigRows = [];
  for (let i = 0; i < BIG_ROWS; i += 1) {
    bigRows.push(JSON.stringify({ type: "assistant", isSidechain: false, uuid: "b" + i, message: { id: "msg_" + i, usage: usage((i % 100) + 1) } }));
  }
  fs.writeFileSync(big, bigRows.join("\n") + "\n");
  const closed = await stopEarly(big, "close");
  if (closed.stderr || closed.signal === "SIGABRT" || closed.signal === "SIGSEGV") {
    wrong.push("a closed stdout ended it " + (closed.signal || "exit " + closed.code) + " saying " + JSON.stringify(closed.stderr.slice(0, 160)));
  }
  const termed = await stopEarly(big, "term");
  if (termed.stderr) wrong.push("SIGTERM mid-run ended it saying " + JSON.stringify(termed.stderr.slice(0, 160)));

  if (wrong.length) return broken(wrong.join("; "));
  return held("--version " + JSON.stringify(said) + "; usage of " + lineCount + " lines wrote the header and its " + want.length +
    " records in order (the same with --threads 2); a missing file and a directory exit 3 with one stderr line; a closed stdout (" +
    (closed.signal || "exit " + closed.code) + ") and a SIGTERM end it with nothing on stderr");
});
