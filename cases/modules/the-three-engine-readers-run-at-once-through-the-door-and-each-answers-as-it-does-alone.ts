// The three readers at once through the one door (rust-transcript-engine, phase 4: the join): readClaudeUsageRows,
// readTitleRows and openTranscriptSearch, started together in one Promise.all (four of each) over six scratch
// transcripts the case writes, answer key for key what each answered alone, every search record arriving at the index
// asked for and none refused; and the door's status reads ok after.
//
// protects: server/modules/transcript-engine/, rust/transcript-engine/src/main.rs, rust/transcript-engine/src/lines.rs, rust/transcript-engine/src/search/mod.rs
// writes: none

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOOR = path.join(REPO, "server/modules/transcript-engine/index.ts");
const ENGINE = process.env.TRANSCRIPT_ENGINE_BIN || path.join(REPO, "rust/target/release/transcript-engine");
const FILES = 6;
const ROWS = 40;
const ROUNDS = 4;
const WORD = "quokkaflute";
const SETTLE_MS = 800; // a --version run the door starts after a recovery lands well inside this

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const firstLine = (error: any) => String(error && error.code ? error.code + ": " + error.message : (error && error.message) || error).split("\n")[0];
const session = (n: number) => "case-join-session-" + n;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + canonical(record[key])).join(",") + "}";
  }
  return String(JSON.stringify(value));
}

function transcript(n: number): string {
  const lines: string[] = [];
  for (let k = 0; k < ROWS; k += 1) {
    const at = new Date(Date.UTC(2026, 10, 1, 0, n, k)).toISOString();
    lines.push(JSON.stringify({ type: "user", sessionId: session(n), uuid: "u-" + n + "-" + k, parentUuid: k ? "a-" + n + "-" + (k - 1) : null,
      isSidechain: false, timestamp: at, message: { role: "user", content: k % 7 === 3 ? "row " + k + " plays the " + WORD + " tune" : "plain row " + k + " of file " + n } }));
    lines.push(JSON.stringify({ type: "assistant", sessionId: session(n), uuid: "a-" + n + "-" + k, parentUuid: "u-" + n + "-" + k, isSidechain: false, timestamp: at,
      message: { id: "msg-" + n + "-" + k, role: "assistant", content: [{ type: "text", text: "answer " + k + " of file " + n }],
        usage: { input_tokens: 10 + k, output_tokens: 5 + n, cache_read_input_tokens: 3 * k, cache_creation_input_tokens: n } } }));
  }
  lines.push(JSON.stringify({ type: "custom-title", sessionId: session(n), customTitle: "Case join file " + n }));
  lines.push(JSON.stringify({ type: "ai-title", sessionId: session(n), aiTitle: "AI title of file " + n }));
  return lines.join("\n") + "\n";
}

async function searchAll(door: any, job: any): Promise<unknown[]> {
  const run = door.openTranscriptSearch(job, {});
  try {
    const records: unknown[] = [];
    for (let index = 0; index < job.files.length; index += 1) records.push(await run.forFile(index));
    return records;
  } finally {
    run.end();
  }
}

runCase(async (t: any) => {
  if (!fs.existsSync(ENGINE)) return broken("no engine at " + ENGINE + ": npm run build:engine builds it");
  const dir = await scratchDir(t, "engine-join");
  const files: string[] = [];
  for (let n = 0; n < FILES; n += 1) {
    const file = path.join(dir, "join-" + n + ".jsonl");
    fs.writeFileSync(file, transcript(n));
    files.push(file);
  }
  const job = { words: [WORD], maxPerSession: 2, transparentWrappers: ["/plain"], files: files.map((file, n) => ({ path: file, sessions: [session(n)] })) };
  const door: any = await import(pathToFileURL(DOOR).href);

  const sizes = { usage: 0, titles: 0, matches: 0 };
  let alone: { usage: string[]; titles: string; search: string };
  try {
    const usage: string[] = [];
    for (const file of files) {
      const rows = await door.readClaudeUsageRows(file);
      sizes.usage += rows.length;
      usage.push(canonical(rows));
    }
    const titles = await door.readTitleRows(files);
    sizes.titles = titles.reduce((sum: number, result: any) => sum + (result.rows ? result.rows.length : 0), 0);
    const search = await searchAll(door, job);
    sizes.matches = search.reduce((sum: number, record: any) => sum + (record.matches ? record.matches.length : 0), 0);
    alone = { usage, titles: canonical(titles), search: canonical(search) };
  } catch (error) {
    return broken("a reader alone was refused: " + firstLine(error));
  }
  const wrong: string[] = [];
  if (sizes.usage !== FILES * ROWS) wrong.push("alone, usage read " + sizes.usage + " rows of " + FILES * ROWS);
  if (sizes.titles !== FILES * 2) wrong.push("alone, titles read " + sizes.titles + " rows of " + FILES * 2);
  if (sizes.matches === 0) wrong.push("alone, search found the scratch word in no file");
  if (wrong.length) return broken(wrong.join("; "));

  const spans: Array<[number, number]> = [];
  const timed = async (label: string, want: string, work: () => Promise<string>) => {
    const start = Date.now();
    try {
      const answer = await work();
      spans.push([start, Date.now()]);
      return { label, want, answer, error: null as string | null };
    } catch (error) {
      spans.push([start, Date.now()]);
      return { label, want, answer: null as string | null, error: firstLine(error) };
    }
  };
  const together: Array<Promise<any>> = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    const file = round % FILES;
    together.push(timed("usage of file " + file + " (round " + round + ")", alone.usage[file], async () => canonical(await door.readClaudeUsageRows(files[file]))));
    together.push(timed("titles (round " + round + ")", alone.titles, async () => canonical(await door.readTitleRows(files))));
    together.push(timed("search (round " + round + ")", alone.search, async () => canonical(await searchAll(door, job))));
  }
  const answers = await Promise.all(together);
  for (const answer of answers) {
    if (answer.error) wrong.push(answer.label + " was refused beside the others: " + answer.error);
    else if (answer.answer !== answer.want) wrong.push(answer.label + " answered otherwise than alone");
  }
  const allInFlight = Math.max(...spans.map((span) => span[0])) < Math.min(...spans.map((span) => span[1]));
  await pause(SETTLE_MS);
  const status = door.transcriptEngineStatus();
  if (!status.ok) wrong.push("after the joined run the status reads " + JSON.stringify(status));
  if (wrong.length) return broken(wrong.join("; ").slice(0, 900));
  return held(answers.length + " calls (" + ROUNDS + " each of usage, titles and search) started together" + (allInFlight ? ", all in flight at once," : "") +
    " answered as each did alone (" + sizes.usage + " usage rows, " + sizes.titles + " title rows, " + sizes.matches + " search matches); the status reads ok");
});
