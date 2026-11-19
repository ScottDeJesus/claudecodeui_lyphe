// A chat created after the relabel cutoff whose label cannot be said aloud (Untitled Session) gets a sayable
// two-to-four-word name at its first completed turn, as a chat with such a label did before the change.
//
// A chat made with no first message is labelled "Untitled Session" (`buildCloudCliSessionName`), which fails
// `isSayableName`; before the change the namer always asked Haiku to name such a chat. The case makes one in a
// scratch database — label "Untitled Session", created now, never named by a person — with a one-exchange
// transcript it writes itself,
// starts the real namer, and ends one run on the real run registry. The namer asks Haiku once (one short call on
// the chosen account, no Gemini); the case reads the row the namer leaves within 45 seconds.
//
// protects: server/modules/chat-names/chat-namer.service.ts, server/modules/chat-names/haiku-name.ts, server/modules/chat-names/exchanges.ts
// writes: none

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const OPENING_LABEL = "Untitled Session";
const FIRST_MESSAGE =
  "I have a series of questions about our feature tasks. Are they truly a task that requires a whole pipeline of agents, or could a single agent do most of them? Give me your honest read.";
const FIRST_REPLY =
  "Most of the feature tasks on the board are small enough for one agent: a single builder with a review pass covers them. Only the cross-repo ones need the full pipeline.";
const WAIT_MS = 45_000;

const line = (row: Record<string, unknown>) => `${JSON.stringify(row)}\n`;

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "chat-unsayable");
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  await writeFile(process.env.DATABASE_PATH, "");

  // Loaded in the body, after DATABASE_PATH names the scratch file: no module opens the real database.
  const { initializeDatabase, getConnection, sessionsDb } = await import("../../server/modules/database/index.ts");
  await initializeDatabase();
  const { chatRunRegistry } = await import("../../server/modules/websocket/index.ts");
  const { createChatNamer } = await import("../../server/modules/chat-names/chat-namer.service.ts");

  const appId = randomUUID();
  const providerId = randomUUID();
  const transcript = path.join(folder, `${providerId}.jsonl`);
  const askUuid = randomUUID();
  const now = new Date().toISOString();
  await writeFile(
    transcript,
    line({ type: "user", uuid: askUuid, parentUuid: null, sessionId: providerId, timestamp: now, cwd: folder, isSidechain: false, userType: "external",
      message: { role: "user", content: FIRST_MESSAGE } }) +
    line({ type: "assistant", uuid: randomUUID(), parentUuid: askUuid, sessionId: providerId, timestamp: now, cwd: folder, isSidechain: false, userType: "external",
      message: { id: "msg_case", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [{ type: "text", text: FIRST_REPLY }],
        stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } } }),
  );
  const db = getConnection();
  db.prepare("INSERT INTO projects (project_id, project_path) VALUES (?, ?)").run(randomUUID(), folder);
  db.prepare(
    `INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, project_path, jsonl_path, isArchived, created_at, updated_at)
     VALUES (?, 'claude', ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).run(appId, providerId, OPENING_LABEL, folder, transcript);

  const said: string[] = [];
  for (const level of ["log", "warn", "error"] as const) {
    const original = console[level];
    console[level] = (...parts: unknown[]) => {
      const text = parts.map(String).join(" ");
      if (text.includes("[Chat names]")) said.push(text.replace(appId, "<chat>"));
      else original(...parts);
    };
  }

  const namer = createChatNamer();
  namer.start();
  t.defer(() => namer.stop());
  if (!chatRunRegistry.startRun({ appSessionId: appId, provider: "claude", providerSessionId: providerId, connection: null, userId: 1 })) {
    return broken("the run registry would not start a run for the scratch chat");
  }
  chatRunRegistry.completeRun(appId, { exitCode: 0 });

  const deadline = Date.now() + WAIT_MS;
  while (said.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
  const facts = sessionsDb.nameFactsOf(appId);
  const name = facts?.customName ?? null;
  const heard = said.join(" | ") || "no [Chat names] line";
  if (name === null || name === OPENING_LABEL) return broken(`the chat still reads ${JSON.stringify(name)} after its first turn — ${heard}`);
  return held(`the chat labelled "Untitled Session" was named ${JSON.stringify(name)} at its first turn`);
});
