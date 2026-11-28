// The engine's status (rust-transcript-engine, interface 3): a call whose engine writes the header and then dies on
// its own leaves transcriptEngineStatus() not ok, as /health reports it, and the change logs one [transcript-engine]
// line; repeats of the same failure log none and do not flip it back to ok. The stand-in is an sh script in scratch.
//
// protects: server/modules/transcript-engine/
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
const SETTLE_MS = 800; // a --version run the door starts lands well inside this

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t: any) => {
  if (!fs.existsSync(DOOR)) return broken("the door " + path.relative(REPO, DOOR) + " is not on disk");
  const builtVersion = spawnSync(BUILT, ["--version"], { encoding: "utf8", timeout: 30000 });
  if (builtVersion.error || !/^transcript-engine \S+ protocol \d+$/.test(String(builtVersion.stdout || "").trim())) {
    return broken("no working engine at " + BUILT + ": npm run build:engine builds it");
  }
  const dir = await scratchDir(t, "engine-flap");
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

  const transcript = path.join(dir, "t.jsonl");
  fs.writeFileSync(transcript, JSON.stringify({ type: "assistant", message: { id: "m1", usage: { input_tokens: 1, output_tokens: 1 } } }) + "\n");
  await door.readClaudeUsageRows(transcript);
  await pause(SETTLE_MS);
  if (!door.transcriptEngineStatus().ok) return broken("on the built engine the status is " + JSON.stringify(door.transcriptEngineStatus()));

  const dies = path.join(dir, "dies-after-header");
  fs.writeFileSync(dies, "#!/bin/sh\ncase \"$1\" in --version) echo 'transcript-engine 0.1.0 protocol 1'; exit 0;; esac\n" +
    "printf '%s\\n' '" + HEADER + "'\necho 'engine died mid-run' >&2\nexit 101\n");
  fs.chmodSync(dies, 0o755);
  process.env.TRANSCRIPT_ENGINE_BIN = dies;

  const wrong: string[] = [];
  const seen: string[] = [];
  const before = said.length;
  for (let call = 1; call <= 3; call += 1) {
    let code = "answered";
    try {
      await door.readClaudeUsageRows(transcript);
    } catch (error: any) {
      code = String(error?.code ?? error?.message);
    }
    await pause(SETTLE_MS);
    const ok = door.transcriptEngineStatus().ok;
    seen.push("call " + call + ": " + code + ", ok=" + ok);
    if (code !== "TRANSCRIPT_ENGINE_FAILED") wrong.push("failing call " + call + " gave " + code + ", not TRANSCRIPT_ENGINE_FAILED");
    if (ok) wrong.push(SETTLE_MS + " ms after failing call " + call + " the status reads ok");
  }
  const logged = said.length - before;
  if (logged !== 1) wrong.push("three failing calls logged " + logged + " [transcript-engine] lines, not 1");

  delete process.env.TRANSCRIPT_ENGINE_BIN;
  await door.readClaudeUsageRows(transcript);
  await pause(SETTLE_MS);
  if (!door.transcriptEngineStatus().ok) wrong.push("back on the built engine the status is " + JSON.stringify(door.transcriptEngineStatus()));

  if (wrong.length) return broken(wrong.join("; ") + " (" + seen.join(" | ") + ")");
  return held("three calls dying after the header each refused TRANSCRIPT_ENGINE_FAILED and left the status not ok, with one [transcript-engine] line in all; back on the built engine it is ok");
});
