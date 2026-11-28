// The engine's door (rust-transcript-engine, interface 3), the one code that spawns the binary: it refuses with
// AppError 503 TRANSCRIPT_ENGINE_UNAVAILABLE (no binary) and TRANSCRIPT_ENGINE_STALE (a header of another protocol),
// both naming npm run build:engine, and TRANSCRIPT_ENGINE_FAILED (a non-zero exit, or a signal it did not send)
// carrying the last stderr line; it reads TRANSCRIPT_ENGINE_BIN and TRANSCRIPT_ENGINE_THREADS at each call; a change
// between ok and not ok logs one [transcript-engine] line and a repeated refusal logs none; and back on the built
// binary its status is ok with the version that binary's --version prints. The stand-ins are sh scripts in scratch.
//
// protects: server/modules/transcript-engine/, server/shared/utils.ts
// writes: none

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOOR = path.join(REPO, "server/modules/transcript-engine/index.ts");
const BUILT = path.join(REPO, "rust/target/release/transcript-engine");
const HEADER = '{"engine":"transcript-engine","protocol":1,"verb":"usage"}';
const LAST_STDERR = "case-last-stderr-line-7f3";
const WORDS = "npm run build:engine";
const SETTLE_MS = 800; // the door relearns the version with one --version run after a recovery; it is given this long

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A stand-in engine: answers --version as the built one does, and runs body for every verb. */
function standIn(dir: string, name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, "#!/bin/sh\ncase \"$1\" in --version) echo 'transcript-engine 0.1.0 protocol 1'; exit 0;; esac\n" + body + "\n");
  fs.chmodSync(file, 0o755);
  return file;
}

async function refusalOf(call: () => Promise<unknown>): Promise<any> {
  try {
    await call();
    return null;
  } catch (error) {
    return error;
  }
}

runCase(async (t: any) => {
  if (!fs.existsSync(DOOR)) return broken("the door " + path.relative(REPO, DOOR) + " is not on disk");
  const builtVersion = spawnSync(BUILT, ["--version"], { encoding: "utf8", timeout: 30000 });
  const versionMatch = /^transcript-engine (\S+) protocol (\d+)$/.exec(String(builtVersion.stdout || "").trim());
  if (builtVersion.error || !versionMatch) return broken("no working engine at " + BUILT + ": " + WORDS + " builds it");
  const dir = await scratchDir(t, "engine-door");
  delete process.env.TRANSCRIPT_ENGINE_BIN;
  delete process.env.TRANSCRIPT_ENGINE_THREADS;

  const said: string[] = [];
  for (const level of ["log", "info", "warn", "error"] as const) {
    (console as any)[level] = (...parts: unknown[]) => {
      const line = parts.map(String).join(" ");
      if (line.includes("[transcript-engine]")) said.push(line);
      process.stderr.write(line + "\n");
    };
  }

  let door: any;
  try {
    door = await import(pathToFileURL(DOOR).href);
  } catch (error: any) {
    return broken("the door would not load: " + String(error?.message ?? error).split("\n")[0]);
  }
  const wrong: string[] = [];
  for (const name of ["readClaudeUsageRows", "readTitleRows", "openTranscriptSearch", "transcriptEngineStatus"]) {
    if (typeof door[name] !== "function") wrong.push("the door exports no function " + name);
  }
  if (door.TRANSCRIPT_ENGINE_PROTOCOL !== Number(versionMatch[2])) {
    wrong.push("TRANSCRIPT_ENGINE_PROTOCOL is " + door.TRANSCRIPT_ENGINE_PROTOCOL + " while the built engine prints protocol " + versionMatch[2]);
  }
  if (wrong.length) return broken(wrong.join("; "));

  const transcript = path.join(dir, "t.jsonl");
  const usage = { input_tokens: 5, output_tokens: 9, cache_read_input_tokens: 700 };
  fs.writeFileSync(transcript, [
    { type: "user", message: { role: "user", content: "q" } },
    { type: "assistant", isSidechain: false, message: { id: "m1", usage } },
    { type: "assistant", message: { id: "m2", usage: { ...usage, output_tokens: 3 } } },
  ].map((row) => JSON.stringify(row)).join("\n") + "\n");

  const readBuilt = async (label: string) => {
    delete process.env.TRANSCRIPT_ENGINE_BIN;
    const failed = await refusalOf(async () => {
      const rows = await door.readClaudeUsageRows(transcript);
      if (!Array.isArray(rows) || rows.length !== 2 || rows[0]?.message?.id !== "m1" || rows[1]?.message?.usage?.output_tokens !== 3) {
        throw new Error("the rows were " + JSON.stringify(rows).slice(0, 200));
      }
    });
    if (failed) wrong.push(label + ": the built engine's read " + (failed.code ? "was refused " + failed.code + ": " : "failed: ") + String(failed.message).slice(0, 200));
    await pause(SETTLE_MS);
  };
  const refuse = async (label: string, bin: string, code: string, needle: string) => {
    process.env.TRANSCRIPT_ENGINE_BIN = bin;
    const error = await refusalOf(() => door.readClaudeUsageRows(transcript));
    if (!error) {
      wrong.push(label + ": answered, not " + code);
      return;
    }
    if (error.statusCode !== 503 || error.code !== code) wrong.push(label + ": " + error.statusCode + " " + error.code + ", not 503 " + code);
    const carried = String(error.message) + " " + JSON.stringify(error.details ?? null);
    if (needle && !carried.includes(needle)) wrong.push(label + ": the refusal does not carry " + JSON.stringify(needle) + " (" + String(error.message).slice(0, 160) + ")");
  };
  const okStatus = (label: string) => {
    const status = door.transcriptEngineStatus();
    const want = { ok: true, version: versionMatch[1], protocol: Number(versionMatch[2]), error: null };
    if (JSON.stringify(status) !== JSON.stringify(want)) wrong.push(label + ": transcriptEngineStatus() is " + JSON.stringify(status) + ", not " + JSON.stringify(want));
  };

  await readBuilt("first call");
  okStatus("after the first call");
  const linesAt = () => said.length;
  let mark = linesAt();
  const missing = path.join(dir, "no-such-engine");
  await refuse("a missing binary", missing, "TRANSCRIPT_ENGINE_UNAVAILABLE", WORDS);
  await refuse("a missing binary again", missing, "TRANSCRIPT_ENGINE_UNAVAILABLE", WORDS);
  const downLines = linesAt() - mark;
  mark = linesAt();
  const stale = standIn(dir, "stale", "printf '%s\\n' '{\"engine\":\"transcript-engine\",\"protocol\":99,\"verb\":\"usage\"}'");
  await refuse("a header of protocol 99", stale, "TRANSCRIPT_ENGINE_STALE", WORDS);
  await refuse("a header of protocol 99 again", stale, "TRANSCRIPT_ENGINE_STALE", WORDS);
  const staleLines = linesAt() - mark;
  mark = linesAt();
  await readBuilt("back on the built engine");
  const upLines = linesAt() - mark;
  okStatus("back on the built engine");
  if (downLines !== 1) wrong.push("ok to unavailable over two refusals logged " + downLines + " [transcript-engine] lines, not one");
  if (staleLines !== 0) wrong.push("two stale refusals while already not ok logged " + staleLines + " [transcript-engine] lines, not none");
  if (upLines !== 1) wrong.push("not ok back to ok logged " + upLines + " [transcript-engine] lines, not one");

  await refuse("an exit 4", standIn(dir, "failing", "printf '%s\\n' '" + HEADER + "'\necho 'case first stderr line' >&2\necho '" + LAST_STDERR + "' >&2\nexit 4"), "TRANSCRIPT_ENGINE_FAILED", LAST_STDERR);
  await refuse("a SIGKILL it did not send", standIn(dir, "killed", "printf '%s\\n' '" + HEADER + "'\nkill -KILL $$"), "TRANSCRIPT_ENGINE_FAILED", "");

  const argsFile = path.join(dir, "args");
  process.env.TRANSCRIPT_ENGINE_BIN = standIn(dir, "recorder", "echo \"$*\" >> '" + argsFile + "'\nprintf '%s\\n' '" + HEADER + "'");
  process.env.TRANSCRIPT_ENGINE_THREADS = "3";
  const widened = await refusalOf(() => door.readClaudeUsageRows(transcript));
  delete process.env.TRANSCRIPT_ENGINE_THREADS;
  const narrowed = await refusalOf(() => door.readClaudeUsageRows(transcript));
  if (widened || narrowed) wrong.push("a stand-in writing the header and no records was refused: " + String((widened || narrowed).message).slice(0, 160));
  const calls = fs.existsSync(argsFile) ? fs.readFileSync(argsFile, "utf8").trim().split("\n") : [];
  if (calls.length !== 2) wrong.push("TRANSCRIPT_ENGINE_BIN set at the call ran the stand-in " + calls.length + " times for two calls");
  else {
    if (!/(^| )--threads 3( |$)/.test(calls[0])) wrong.push("with TRANSCRIPT_ENGINE_THREADS=3 the engine ran as: " + calls[0]);
    if (calls[1].includes("--threads")) wrong.push("with TRANSCRIPT_ENGINE_THREADS unset the engine ran as: " + calls[1]);
    if (!calls[0].includes("usage") || !calls[0].includes(transcript)) wrong.push("the usage call ran as: " + calls[0]);
  }
  await readBuilt("last call");
  okStatus("after the last call");
  if (wrong.length) return broken(wrong.join("; "));
  return held("built engine read 2 rows; missing binary UNAVAILABLE and protocol 99 STALE naming " + WORDS + ", exit 4 FAILED with its last stderr line, a SIGKILL FAILED, all 503; " +
    "one [transcript-engine] line down and one back, none for a repeated refusal; --threads 3 passed only while set; status ok at version " + versionMatch[1]);
});
