// The engine's search gate and match test (rust-transcript-engine, interface 2) against their oracles: a file passes the
// gate exactly when ripgrep --ignore-case --fixed-strings finds every word in its bytes, and a row's text is a hit
// exactly when chat search's matchesQuery accepts it (createWordMatcher in session-conversations-search.service.ts as
// it stood on 2026-11-28: the words regex-escaped and joined by JavaScript's \s+, flags iu; for one word, then the word
// with no letter on either side in the lowercased text). The texts sit where Rust and JavaScript part: U+FEFF is a
// JavaScript \s and not a Rust one, U+0085 the reverse, the Kelvin sign and the long s fold case, a non-ASCII word is
// written raw or JSON-escaped. Each text is one row in a file of its own. The server's judge drops what the engine sends
// and matchesQuery refuses; this case holds the engine to sending exactly what the judge keeps.
//
// protects: rust/transcript-engine/src/search/gate.rs, rust/transcript-engine/src/search/matcher.rs, rust/transcript-engine/src/search/mod.rs
// writes: none

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
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

const RG = path.join(REPO, "node_modules/@vscode/ripgrep/bin/rg");
const U = (...codes) => String.fromCharCode(...codes);
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const asciiEscape = (text) => text.replace(/[^\x00-\x7f]/g, (c) => "\\" + "u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const shown = (text) => asciiEscape(JSON.stringify(text));

function chatSearchMatches(words, text) {
  if (typeof text !== "string" || text.length === 0) return false;
  const phrase = new RegExp(words.map(escapeRegex).join("\\s+"), "iu");
  if (words.length > 1) return phrase.test(text);
  if (phrase.test(text)) return true;
  const lower = text.toLowerCase();
  return words.every((word) => new RegExp("(?<!\\p{L})" + escapeRegex(word) + "(?!\\p{L})", "u").test(lower));
}

const QUERIES = [
  { words: ["zqv", "wpl"], texts: ["zqv" + U(0xfeff) + "wpl", "zqv" + U(0x85) + "wpl", "ZQV " + U(0xa0, 0x3000) + " wpl", "zqv\t\n" + U(0x0b) + "wpl",
    "Zqv" + U(0x2028) + "Wpl", "zqv" + U(0x1680, 0x202f, 0x205f) + "wpl", "zqv" + U(0x200b) + "wpl", "zqv" + U(0x1f) + "wpl", "zqvwpl", "wpl zqv"] },
  { words: ["c++zq"], texts: ["use C++ZQ now", "c+zq here"] },
  { words: ["kzqx"], texts: [U(0x212a) + "zqx kelvin", "KZQX plain"] },
  { words: ["szqx"], texts: [U(0x17f) + "zqx long s"] },
  { words: ["zq" + U(0xe9)], texts: ["say ZQ" + U(0xc9), { escaped: "say ZQ" + U(0xc9) }] },
  { words: ["zqx"], texts: ["xzqxx inside", "ZQX alone"] },
];

runCase(async (t) => {
  if (!fs.existsSync(RG)) return cannotRun("no ripgrep at " + RG + " to judge the gate by");
  const engine = engineProtocol();
  if (engine.why) return broken(engine.why);
  const dir = await scratchDir(t, "engine-search-matcher");
  const wrong = [];
  let judged = 0;
  let hits = 0;
  const notes = [];
  for (const [q, query] of QUERIES.entries()) {
    const files = [];
    const expected = [];
    for (const [k, entry] of query.texts.entries()) {
      const text = typeof entry === "string" ? entry : entry.escaped;
      const session = "G" + q + "_" + k;
      const row = { type: "user", sessionId: session, uuid: "g" + q + "_" + k, message: { role: "user", content: text } };
      const line = typeof entry === "string" ? JSON.stringify(row) : asciiEscape(JSON.stringify(row));
      const file = path.join(dir, "q" + q + "-" + k + ".jsonl");
      fs.writeFileSync(file, line + "\n");
      let gate = true;
      for (const word of query.words) {
        const found = spawnSync(RG, ["--no-config", "--ignore-case", "--fixed-strings", "--quiet", "--", word, file]);
        if (found.status !== 0 && found.status !== 1) return cannotRun("ripgrep exited " + found.status + " on " + file);
        if (found.status !== 0) gate = false;
      }
      const hit = gate && chatSearchMatches(query.words, text);
      files.push({ path: file, sessions: [session] });
      expected.push({ text, hit, gate, label: (typeof entry === "string" ? "" : "escaped ") + shown(text) });
    }
    const label = "words " + shown(query.words);
    const records = readRecords(label, search({ words: query.words, maxPerSession: 2, transparentWrappers: ["/plain"], files }), engine.protocol, wrong);
    if (!records) break;
    if (records.length !== files.length) { wrong.push(label + ": " + records.length + " records for " + files.length + " files"); continue; }
    for (const [k, want] of expected.entries()) {
      const record = records[k];
      const got = Array.isArray(record.matches) && record.matches.length > 0;
      judged += 1;
      if (want.hit) hits += 1;
      notes.push(want.label + (want.hit ? " hit" : want.gate ? " miss" : " gated"));
      if (got !== want.hit) {
        wrong.push(label + " on " + want.label + ": the engine " + (got ? "sent a hit" : "sent none") + ", rg's gate says " + want.gate + " and matchesQuery says " + chatSearchMatches(query.words, want.text));
      } else if (got && (record.matches.length !== 1 || record.matches[0].text !== want.text)) {
        wrong.push(label + " on " + want.label + ": the hit is " + asciiEscape(JSON.stringify(record.matches)).slice(0, 160));
      }
    }
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held(judged + " one-row files over " + QUERIES.length + " queries: the engine sent exactly the " + hits + " hits rg's gate and matchesQuery keep (" + notes.join(", ") + ")");
});
