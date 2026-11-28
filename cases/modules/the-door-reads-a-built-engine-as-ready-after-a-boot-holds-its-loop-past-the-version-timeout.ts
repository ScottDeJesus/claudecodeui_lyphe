// The door's status after a held boot (rust-transcript-engine, phase 4: the join): a server whose event loop is held
// past the door's --version timeout while that run is in flight (a handover boot on a loaded box: 16 s on 2026-11-28
// 01:53) still reads the engine it can run as ready. transcriptEngineStatus() reads ok with a version and the door's
// protocol, never "--version did not answer (exited 0)" with an empty stdout, which is what Node's execFile answers
// when its timeout fires after the child already exited 0: kill() destroys the unread stdout and the callback gets no
// error.
//
// protects: server/modules/transcript-engine/
// writes: none

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, CannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOOR = path.join(REPO, "server/modules/transcript-engine/index.ts");
const PROCESS_FILE = path.join(REPO, "server/modules/transcript-engine/engine-process.ts");
const BINARY = path.join(REPO, "rust/target/release/transcript-engine");
const SETTLE_MS = 5000;

/** The door's --version timeout as its source states it; 10 s when the constant is gone. */
function versionTimeoutMs(): number {
  const match = /VERSION_TIMEOUT_MS\s*=\s*([\d_]+)/.exec(fs.readFileSync(PROCESS_FILE, "utf8"));
  return match ? Number(match[1].replace(/_/g, "")) : 10_000;
}

runCase(async () => {
  delete process.env.TRANSCRIPT_ENGINE_BIN;
  if (!fs.existsSync(BINARY)) throw new CannotRun("no engine is built at " + BINARY + " (npm run build:engine)");
  const hold = versionTimeoutMs() + 1000;
  let door: { transcriptEngineStatus: () => { ok: boolean; version: string | null; protocol: number | null; error: string | null }; TRANSCRIPT_ENGINE_PROTOCOL: number };
  try {
    door = await import(pathToFileURL(DOOR).href);
  } catch (error) {
    throw new CannotRun("the door would not load: " + String((error as Error)?.message ?? error).split("\n")[0]);
  }
  // The boot's held loop: the module-load --version run is in flight and nothing reads its answer meanwhile.
  const until = Date.now() + hold;
  while (Date.now() < until) {
    // held
  }
  const settleBy = Date.now() + SETTLE_MS;
  let status = door.transcriptEngineStatus();
  while (!status.ok && Date.now() < settleBy) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    status = door.transcriptEngineStatus();
  }
  if (status.ok && status.version && status.protocol === door.TRANSCRIPT_ENGINE_PROTOCOL) {
    return held("after the loop was held " + hold + " ms with the --version run in flight, the status reads ok: version " + status.version + ", protocol " + status.protocol);
  }
  return broken("after the loop was held " + hold + " ms with the --version run in flight, the status reads " + JSON.stringify(status) + " for an engine that answers --version");
});
