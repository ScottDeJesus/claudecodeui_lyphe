// code_mode_chat.mjs — a chat's Code Mode as the Claude runtime sees it: a scratch database, scratch flags, the context.
//
// Usage (cases/modules/<name>.ts):
//   import { openCodeModeGround, setChatsSwitch, verbAnswers, newChat, contextOf, codeModeRow } from "../lib/code_mode_chat.mjs";
//   const ground = await openCodeModeGround(t, "label");   // scratch folder, DATABASE_PATH, CODE_MODE_FLAG_DIR, initializeDatabase
//   setChatsSwitch(ground, true);                         // `code-mode set chats on --by cli` on the SCRATCH flags only
//   verbAnswers()                                         // { chatForm, ready, why } — what the house verb can do today
//   const id = newChat(ground);                           // a new Claude chat row, code_mode NULL
//   const context = await contextOf(ground);              // the context providerRuntimeService.run hands a runtime
//   codeModeRow(ground, id)                               // the raw sessions.code_mode cell (null, 0 or 1)
//   talkedChat(ground, 0)                                 // a chat that has talked, its code_mode the word given
//   compactChat(ground, id)                               // the chat swapped onto a new session, as a compaction does
//   chatConfigOf(t, launch, id)                           // an on launch's server.json; its chat folder removed at the end
//
// NOTHING REAL IS WRITTEN. DATABASE_PATH names a scratch file before any database module loads, and
// CODE_MODE_FLAG_DIR names a scratch folder before the verb is ever run, so no flag under ~/.claude/state/code_mode
// is read or written by a case. The verb inherits both through the module's userFacingEnv(), which is process.env.
//
// THE CONTEXT is captured, never built by hand: the case swaps the registry's `resolveProvider` for one call of
// providerRuntimeService.run, so the context it reads is exactly the object every Claude launch is handed.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { scratchDir } from "./scratch.mjs";

export const VERB = path.join(os.homedir(), ".claude", "scripts", "code-mode");
const VERB_TIMEOUT_MS = 30000;
const SERVER = "../../server/modules";

/** A scratch folder holding the database and the flags; both variables set before any module loads. */
export async function openCodeModeGround(t, label) {
  const folder = await scratchDir(t, label);
  const flags = path.join(folder, "flags");
  const repo = path.join(folder, "repo");
  await mkdir(flags);
  await mkdir(repo);
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  process.env.CODE_MODE_FLAG_DIR = flags;
  await writeFile(process.env.DATABASE_PATH, "");
  const database = await import(`${SERVER}/database/index.ts`);
  await database.initializeDatabase();
  return { folder, flags, repo, database };
}

/** Moves the scratch chats switch through the verb, its one writer. Throws when the verb refuses. */
export function setChatsSwitch(ground, on) {
  execFileSync(VERB, ["set", "chats", on ? "on" : "off", "--by", "cli"], {
    env: { ...process.env, CODE_MODE_FLAG_DIR: ground.flags },
    encoding: "utf8",
    timeout: VERB_TIMEOUT_MS,
  });
}

/**
 * What the house verb can answer today: whether `config --chat` exists (asked with `--born off`, which answers off
 * before any flag or readiness and writes nothing), and whether the box is ready.
 */
export function verbAnswers() {
  let chatForm = false;
  try {
    const out = execFileSync(VERB, ["config", "--chat", randomUUID(), "--cwd", os.tmpdir(), "--born", "off"], {
      input: "{}",
      encoding: "utf8",
      timeout: VERB_TIMEOUT_MS,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const last = out.trim().split("\n").pop() ?? "";
    chatForm = JSON.parse(last)?.on === false;
  } catch {
    chatForm = false;
  }
  let ready = null;
  let why = "";
  try {
    const status = JSON.parse(execFileSync(VERB, ["--status"], { encoding: "utf8", timeout: VERB_TIMEOUT_MS }));
    ready = status.ready === true;
    why = String(status.why ?? "");
  } catch (error) {
    why = `code-mode --status did not answer: ${String(error?.message ?? error).split("\n")[0]}`;
  }
  return { chatForm, ready, why };
}

/** A new Claude chat in the scratch repo, its code_mode NULL. */
export function newChat(ground) {
  const id = randomUUID();
  ground.database.sessionsDb.createAppSession(id, "claude", ground.repo, "code mode case");
  return id;
}

/** A Claude chat that has talked (the CLI's session id and transcript path on its row), its code_mode the given word. */
export function talkedChat(ground, word) {
  const id = newChat(ground);
  const providerSession = randomUUID();
  ground.database.getConnection()
    .prepare("UPDATE sessions SET provider_session_id = ?, jsonl_path = ?, code_mode = ? WHERE session_id = ?")
    .run(providerSession, path.join(ground.folder, `${providerSession}.jsonl`), word, id);
  return id;
}

/** Moves a chat onto a new session through the one mover a custom compaction uses; returns the new provider id. */
export function compactChat(ground, id) {
  const row = ground.database.getConnection().prepare("SELECT provider_session_id, jsonl_path FROM sessions WHERE session_id = ?").get(id);
  const next = randomUUID();
  ground.database.sessionCompactionsDb.swapToCompactedSession({
    sessionId: id,
    oldProviderSessionId: row.provider_session_id,
    oldJsonlPath: row.jsonl_path,
    newProviderSessionId: next,
    facts: { trigger: "manual", summarizerModel: "haiku", summarizerServed: null, summarizerEffort: "low", preTokens: null, summarizerTokensIn: 0, summarizerTokensOut: 0, chunks: 1 },
    seed: ["a case's seed"],
  });
  return next;
}

/** The raw sessions.code_mode cell, read with SQL so the reading does not lean on getCodeMode. */
export function codeModeRow(ground, id) {
  const row = ground.database.getConnection().prepare("SELECT code_mode FROM sessions WHERE session_id = ?").get(id);
  return row ? row.code_mode : undefined;
}

/** The context providerRuntimeService.run hands the Claude runtime, captured from one run. */
export async function contextOf() {
  const { providerRuntimeService } = await import(`${SERVER}/providers/index.ts`);
  const { providerRegistry } = await import(`${SERVER}/providers/provider.registry.ts`);
  const real = providerRegistry.resolveProvider;
  let captured = null;
  providerRegistry.resolveProvider = () => ({
    id: "claude",
    sessions: { normalizeMessage: () => [] },
    auth: { getStatus: async () => ({ installed: true }) },
    runtime: { run: async (_command, _options, _writer, context) => { captured = context; } },
  });
  try {
    await providerRuntimeService.run("claude", "", {}, { send() {} });
  } finally {
    providerRegistry.resolveProvider = real;
  }
  return { context: captured, providerRuntimeService };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The server.json an on launch's server args name (`--config <file>`), or null. When `id` is given and the file's
 * folder is that chat's own (`…/code_mode/chats/<id>`, the id a fresh UUID this case made), the folder is removed when
 * the case ends: an on launch writes it in the house's state, and a case removes what it made. Any other folder is
 * left alone.
 */
export function chatConfigOf(t, launch, id) {
  const args = launch?.on === true && Array.isArray(launch.server?.args) ? launch.server.args : [];
  const at = args.indexOf("--config");
  const config = at >= 0 && typeof args[at + 1] === "string" ? args[at + 1] : null;
  const folder = config ? path.dirname(config) : null;
  if (folder && UUID.test(id ?? "") && path.basename(folder) === id
    && path.basename(path.dirname(folder)) === "chats" && path.basename(path.dirname(path.dirname(folder))) === "code_mode") {
    t.defer(() => rmSync(folder, { recursive: true, force: true }));
  }
  return config;
}

/** The input launchFor is asked with for one chat of the ground. */
export function launchInput(ground, appSessionId, onNode = false) {
  return { appSessionId, onNode, cwd: ground.repo, servers: {} };
}
