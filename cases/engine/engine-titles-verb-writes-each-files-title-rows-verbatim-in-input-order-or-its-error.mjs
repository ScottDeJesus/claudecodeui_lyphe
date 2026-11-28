// The engine's titles verb (rust-transcript-engine, interfaces 2 and 5): stdin {"files":[...]}, the header line first,
// then one record per file in input order, {"i":n,"rows":[...]} holding every row whose type is custom-title, ai-title or
// last-prompt, verbatim and in file order (whatever its session or its fields), or {"i":n,"error":"<reason>"}; exit 0.
// A job that cannot be read exits 2. Runs the built binary (TRANSCRIPT_ENGINE_BIN when set, as the door reads it) over
// transcripts the case writes.
//
// protects: rust/transcript-engine/src/titles.rs, rust/transcript-engine/src/main.rs, rust/transcript-engine/src/lines.rs, rust/Cargo.toml, rust/Cargo.lock
// writes: none

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENGINE = process.env.TRANSCRIPT_ENGINE_BIN || path.join(REPO, "rust/target/release/transcript-engine");
const RUN_MS = 60000;
const MANY = 200;

/** Keys sorted at every depth: two rows compare by content, never by key order. */
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

const lastLine = (text) => String(text || "").trim().split("\n").pop();

const titles = (args, stdin) => spawnSync(ENGINE, [...args, "titles"], { input: stdin, encoding: "utf8", timeout: RUN_MS, maxBuffer: 256 * 1024 * 1024 });

/** A transcript holding every line shape the verb must keep or skip, and the rows it must hand back. */
function edges() {
  const lines = [];
  const want = [];
  const keep = (value) => { lines.push(Buffer.from(JSON.stringify(value))); want.push(value); };
  const skip = (value) => lines.push(Buffer.from(typeof value === "string" ? value : JSON.stringify(value)));
  skip({ type: "user", sessionId: "s1", cwd: "/x", message: { role: "user", content: "hi" } });
  keep({ type: "custom-title", sessionId: "s1", customTitle: "Mine" });
  keep({ type: "ai-title", sessionId: "s1", aiTitle: "Generated", somethingNew: { deep: [1, 2, { x: null }] } });
  skip(""); skip("   \t  "); skip("{not json at all");
  const prompt = { type: "last-prompt", sessionId: "s1", lastPrompt: "go" };
  lines.push(Buffer.from("  " + JSON.stringify(prompt) + "  \r")); want.push(prompt);
  keep({ type: "custom-title", sessionId: "someone-else", customTitle: "Foreign" });
  keep({ type: "custom-title", sessionId: "s1", customTitle: 12345 });
  keep({ type: "ai-title", aiTitle: "no session at all" });
  const [head, tail] = JSON.stringify({ type: "ai-title", sessionId: "s1", aiTitle: "@@BAD@@" }).split("@@BAD@@");
  lines.push(Buffer.concat([Buffer.from(head), Buffer.from([0xff, 0xfe, 0x80]), Buffer.from(tail)]));
  want.push({ type: "ai-title", sessionId: "s1", aiTitle: "���" });
  lines.push(Buffer.from('{"type":"custom\\u002dtitle","sessionId":"s1","customTitle":"escaped type"}'));
  want.push({ type: "custom-title", sessionId: "s1", customTitle: "escaped type" });
  skip({ type: "summary", summary: "custom-title", leafUuid: "x" });
  skip({ type: "assistant", message: { content: [{ type: "text", text: "{\"type\":\"custom-title\"}" }] } });
  skip("[1,2,3]"); skip("\"custom-title\""); skip("42"); skip({ type: null }); skip({ type: ["custom-title"] });
  skip({ type: "Custom-Title", customTitle: "case" }); skip({ kind: "ai-title" });
  keep({ type: "last-prompt", sessionId: "s1", lastPrompt: "x".repeat(1 << 20) });
  keep({ type: "ai-title", sessionId: "s1", aiTitle: "Last, with no newline after it" });
  const bytes = Buffer.concat(lines.flatMap((line, i) => (i < lines.length - 1 ? [line, Buffer.from("\n")] : [line])));
  return { bytes, want, lineCount: lines.length };
}

runCase(async (t) => {
  const version = spawnSync(ENGINE, ["--version"], { encoding: "utf8", timeout: RUN_MS });
  if (version.error) return broken("the engine " + ENGINE + " would not run (" + (version.error.code || version.error.message) + "): npm run build:engine builds it");
  const match = /^transcript-engine (\S+) protocol (\d+)$/.exec((version.stdout || "").trim());
  if (version.status !== 0 || !match) return broken("--version exited " + version.status + " printing " + JSON.stringify((version.stdout || "").slice(0, 120)));
  const header = canonical({ engine: "transcript-engine", protocol: Number(match[2]), verb: "titles" });

  const dir = await scratchDir(t, "engine-titles");
  const { bytes, want, lineCount } = edges();
  const a = path.join(dir, "edges.jsonl");
  fs.writeFileSync(a, bytes);
  const b = path.join(dir, "no-titles.jsonl");
  fs.writeFileSync(b, [{ type: "user", sessionId: "s2", message: { role: "user", content: "custom-title ai-title last-prompt" } },
    { type: "assistant", sessionId: "s2", message: { content: [] } }, { type: "summary", summary: "s", leafUuid: "u" }].map((r) => JSON.stringify(r)).join("\n") + "\n");
  const c = path.join(dir, "empty.jsonl");
  fs.writeFileSync(c, "");
  const missing = path.join(dir, "no-such.jsonl");
  const wrong = [];

  const judge = (label, run, files, wants) => {
    if (run.error || run.status !== 0) {
      wrong.push(label + ": exited " + (run.status ?? run.signal ?? run.error?.code) + " " + lastLine(run.stderr));
      return;
    }
    const lines = run.stdout.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    let first;
    try { first = canonical(JSON.parse(lines[0])); } catch { first = JSON.stringify(lines[0]); }
    if (first !== header) wrong.push(label + ": the first line is " + String(lines[0]).slice(0, 120) + ", not the titles header");
    const records = lines.slice(1);
    if (records.length !== files.length) wrong.push(label + ": " + records.length + " records for " + files.length + " files");
    for (let i = 0; i < Math.min(records.length, files.length); i += 1) {
      let record;
      try { record = JSON.parse(records[i]); } catch { wrong.push(label + ": record " + i + " does not parse"); return; }
      if (record.i !== i) { wrong.push(label + ": record " + i + " carries i=" + JSON.stringify(record.i)); return; }
      if (wants[i] === "error") {
        if (typeof record.error !== "string" || !record.error || "rows" in record) { wrong.push(label + ": file " + i + " (" + path.basename(files[i]) + ") is " + records[i].slice(0, 120) + ", not an error record"); return; }
        continue;
      }
      if ("error" in record || !Array.isArray(record.rows)) { wrong.push(label + ": file " + i + " (" + path.basename(files[i]) + ") is " + records[i].slice(0, 120) + ", not its rows"); return; }
      if (canonical(record.rows) !== canonical(wants[i])) {
        const at = record.rows.findIndex((row, k) => canonical(row) !== canonical(wants[i][k]));
        const k = at === -1 ? Math.min(record.rows.length, wants[i].length) : at;
        wrong.push(label + ": file " + i + " holds " + record.rows.length + " rows, not " + wants[i].length + "; row " + k + " is " +
          (canonical(record.rows[k]) || "absent").slice(0, 120) + ", not " + (canonical(wants[i][k]) || "absent").slice(0, 120));
        return;
      }
    }
  };

  const files = [a, missing, b, dir, c, a];
  const wants = [want, "error", [], "error", [], want];
  judge("titles", titles([], JSON.stringify({ files })), files, wants);
  judge("--threads 2 titles", titles(["--threads", "2"], JSON.stringify({ files })), files, wants);

  const many = [];
  const manyWants = [];
  for (let k = 0; k < MANY; k += 1) {
    const file = path.join(dir, "many-" + k + ".jsonl");
    const rows = [];
    const filler = k === 0 ? 30000 : k % 7;
    for (let r = 0; r < filler; r += 1) rows.push({ type: "user", sessionId: "m" + k, uuid: "u" + r, message: { role: "user", content: "filler row " + r + " of file " + k } });
    const own = [{ type: "custom-title", sessionId: "m" + k, customTitle: "t" + k }, { type: "last-prompt", sessionId: "m" + k, lastPrompt: "p" + k }];
    fs.writeFileSync(file, [...rows, ...own].map((row) => JSON.stringify(row)).join("\n") + "\n");
    many.push(file);
    manyWants.push(own);
  }
  judge("--threads 4 titles over " + MANY + " files", titles(["--threads", "4"], JSON.stringify({ files: many })), many, manyWants);

  const empty = titles([], JSON.stringify({ files: [] }));
  const emptyLines = String(empty.stdout || "").split("\n").filter(Boolean);
  if (empty.status !== 0 || emptyLines.length !== 1) wrong.push("an empty file list: exit " + empty.status + " with " + emptyLines.length + " lines, not exit 0 with the header alone");

  for (const [label, job] of [["a stdin that is not JSON", "not json"], ["files that is not a list", JSON.stringify({ files: a })]]) {
    const run = titles([], job);
    if (run.status !== 2 || !String(run.stderr || "").trim()) wrong.push(label + ": exit " + (run.status ?? run.signal) + " saying " + JSON.stringify(lastLine(run.stderr)) + ", not exit 2 with a reason");
  }

  if (wrong.length) return broken(wrong.join("; "));
  return held("titles over " + files.length + " paths wrote the header and one record each in input order: the " + lineCount + "-line transcript's " + want.length +
    " title rows verbatim (twice, the same with --threads 2), [] for two files with none, an error for a missing file and a directory; " + MANY +
    " files under --threads 4 in input order; an empty list is the header alone; two bad jobs exit 2");
});
