// Token totals through the engine (rust-transcript-engine, interface 4): getSessionTokenUsage with
// includeSessionTotal reads a Claude transcript through its default readClaudeUsageRows (the engine's door), never
// through readTextFile, and answers what the old whole-file reader (parseClaudeUsageEntries of the file's text)
// answered, key for key: on a scratch transcript of edge rows and on up to three of this box's largest idle
// top-level transcripts, read and never written.
//
// protects: server/modules/providers/services/provider-token-usage.service.ts, server/modules/transcript-engine/, rust/transcript-engine/src/usage.rs, rust/transcript-engine/src/lines.rs
// writes: none

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, CannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SERVICE = path.join(REPO, "server/modules/providers/services/provider-token-usage.service.ts");
const IDLE_MS = 10 * 60 * 1000;
const MAX_BYTES = 40 * 1024 * 1024;
const REAL_FILES = 3;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + canonical(record[key])).join(",") + "}";
  }
  return String(JSON.stringify(value));
}

/** The reader the switch replaced: the whole file's text, one JSON.parse per line, a bad line skipped. */
function oldReader(file: string): unknown[] {
  const out: unknown[] = [];
  for (const line of fs.readFileSync(file, "utf8").trim().split("\n")) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // skipped, as the old reader skipped it
    }
  }
  return out;
}

/** This box's largest top-level transcripts that nothing has written for ten minutes. */
function idleTranscripts(): string[] {
  const root = path.join(os.homedir(), ".claude", "projects");
  const found: Array<{ file: string; size: number }> = [];
  let buckets: fs.Dirent[] = [];
  try {
    buckets = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
  for (const bucket of buckets) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(path.join(root, bucket.name));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const file = path.join(root, bucket.name, name);
      try {
        const stat = fs.statSync(file);
        if (stat.isFile() && stat.size <= MAX_BYTES && Date.now() - stat.mtimeMs > IDLE_MS) found.push({ file, size: stat.size });
      } catch {
        // gone between the listing and the stat
      }
    }
  }
  return found.sort((a, b) => b.size - a.size).slice(0, REAL_FILES).map((entry) => entry.file);
}

function writeFixture(dir: string): string {
  const u = (input: number, output: number) => ({ input_tokens: input, cache_read_input_tokens: input * 100, cache_creation_input_tokens: input * 10, output_tokens: output });
  const lines: Buffer[] = [];
  const row = (value: unknown) => lines.push(Buffer.from(JSON.stringify(value)));
  row({ type: "user", sessionId: "s", message: { role: "user", content: "go" } });
  row({ type: "assistant", isSidechain: false, message: { id: "msg_1", model: "m", usage: u(3, 50) } });
  row({ type: "assistant", isSidechain: false, message: { id: "msg_1", model: "m", usage: u(3, 120) } });
  lines.push(Buffer.from(JSON.stringify({ type: "assistant", message: { id: "msg_2", usage: u(4, 60) } }) + "\r"));
  lines.push(Buffer.from("{broken"), Buffer.from(""));
  const [head, tail] = JSON.stringify({ type: "assistant", isSidechain: false, message: { id: "msg_3", content: [{ type: "text", text: "@@" }], usage: u(5, 70) } }).split("@@");
  lines.push(Buffer.concat([Buffer.from(head), Buffer.from([0xc3, 0x28, 0xff]), Buffer.from(tail)]));
  row({ type: "assistant", isSidechain: true, message: { id: "msg_s", usage: u(90, 900) } });
  row({ type: "assistant", isSidechain: false, message: { id: "msg_z", model: "<synthetic>", usage: u(0, 0) } });
  const file = path.join(dir, "edges.jsonl");
  fs.writeFileSync(file, Buffer.concat(lines.flatMap((line) => [line, Buffer.from("\n")])));
  return file;
}

runCase(async (t: any) => {
  const dir = await scratchDir(t, "token-totals");
  process.env.DATABASE_PATH = path.join(dir, "auth.db");
  delete process.env.TRANSCRIPT_ENGINE_BIN;
  delete process.env.TRANSCRIPT_ENGINE_THREADS;
  let service: any;
  try {
    service = await import(pathToFileURL(SERVICE).href);
  } catch (error: any) {
    throw new CannotRun("the token service would not load: " + String(error?.message ?? error).split("\n")[0]);
  }
  const files = [writeFixture(dir), ...idleTranscripts()];
  const wrong: string[] = [];
  const seen: string[] = [];
  for (const file of files) {
    const label = file.startsWith(dir) ? "the scratch transcript" : path.basename(file).slice(0, 8) + " (" + (fs.statSync(file).size / 1048576).toFixed(1) + " MB)";
    const textReads: string[] = [];
    const deps = (extra: Record<string, unknown>) => ({
      getSessionById: () => ({ session_id: "case-session", provider: "claude", provider_session_id: "case-provider-session", jsonl_path: file, project_path: null }),
      isProviderSessionSuperseded: () => false,
      getClaudeContextWindow: () => undefined,
      getReportedClaudeContextWindow: () => undefined,
      readLatestCompactionPostTokens: () => null,
      ...extra,
    });
    const engineSide = service.createProviderTokenUsageService(deps({
      readTextFile: async (p: string) => {
        textReads.push(p);
        return fs.promises.readFile(p, "utf8");
      },
    }));
    const oldSide = service.createProviderTokenUsageService(deps({ readClaudeUsageRows: async (p: string) => oldReader(p) }));
    const started = Date.now();
    let fromEngine: any;
    try {
      fromEngine = await engineSide.getSessionTokenUsage("case-session", { includeSessionTotal: true });
    } catch (error: any) {
      wrong.push(label + ": refused " + (error?.code ?? "") + " " + String(error?.message ?? error).slice(0, 160));
      continue;
    }
    const engineMs = Date.now() - started;
    const fromOld = await oldSide.getSessionTokenUsage("case-session", { includeSessionTotal: true });
    if (textReads.length) wrong.push(label + ": the whole read went through readTextFile, not readClaudeUsageRows");
    if (canonical(fromEngine) !== canonical(fromOld)) {
      wrong.push(label + ": through the engine " + canonical(fromEngine).slice(0, 220) + ", the old reader " + canonical(fromOld).slice(0, 220));
    }
    seen.push(label + " used " + fromEngine.used + ", session output " + fromEngine.sessionOutputTokens + " (" + engineMs + " ms)");
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held(files.length + " transcripts answer the same TokenUsageResult through the engine and the old reader: " + seen.join("; "));
});
