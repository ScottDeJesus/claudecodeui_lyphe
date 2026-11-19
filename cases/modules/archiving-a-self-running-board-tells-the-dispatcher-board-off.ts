// ARCHIVE: a person archiving a board that runs itself puts every card of it away, so the dispatcher must hear it the
// way it hears the switch turned off: `dispatcher card told --event board-off`, which withdraws the board's told and
// queued cards. The header's Archive press sends `PATCH /api/kanban/boards/:id {archived: true}` alone
// (`KanbanPanel.tsx`), which `updateBoard` writes as `board.archived`; a board archived without that tell keeps its
// queued cards walking on a board nobody can see.
//
// The dispatcher is a stand-in written into this case's scratch folder (DISPATCHER_BIN), which records each call;
// every write lands in a database this case creates there. Nothing reaches the real dispatcher.
//
// protects: server/modules/kanban-dispatch/, server/modules/kanban/kanban-boards.service.ts, src/modules/kanban/KanbanPanel.tsx
// writes: none

import { chmod, readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// The stand-in: records argv (and stdin for `told`) as one JSON line; answers `card notes --json` with no notes.
const STAND_IN = `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const home = path.dirname(process.argv[1]); const argv = process.argv.slice(2);
let input = ""; process.stdin.on("data", (c) => (input += c)); process.stdin.on("end", () => {
  fs.appendFileSync(path.join(home, "calls.jsonl"), JSON.stringify({ argv, stdin: input }) + "\\n");
  if (argv[0] === "card" && argv[1] === "notes") console.log("[]");
  else console.log("TOLD card x/y — queued");
});
`;

type Call = { argv: string[]; stdin?: string };

const flag = (argv: string[], name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "board-archive");
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  process.env.KANBAN_ATTACHMENTS_ROOT = path.join(folder, "attachments");
  const bin = path.join(folder, "dispatcher");
  await writeFile(bin, STAND_IN);
  await chmod(bin, 0o755);
  process.env.DISPATCHER_BIN = bin;
  const callsFile = path.join(folder, "calls.jsonl");
  const told = async (): Promise<Call[]> =>
    fs.existsSync(callsFile)
      ? (await readFile(callsFile, "utf8"))
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Call)
          .filter((c) => c.argv[0] === "card" && c.argv[1] === "told")
      : [];

  const { initializeDatabase } = await import("../../server/modules/database/index.ts");
  await initializeDatabase();
  const kanban: any = await import("../../server/modules/kanban/index.ts");
  let mod: any;
  try {
    mod = await import("../../server/modules/kanban-dispatch/index.ts");
  } catch (error) {
    return broken(`server/modules/kanban-dispatch/index.ts would not load: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  const quiet = { log: console.log, error: console.error };
  console.log = () => {};
  console.error = () => {};
  t.defer(() => {
    console.log = quiet.log;
    console.error = quiet.error;
  });
  const storeWatch = { attach: () => () => {}, followChains: () => {}, start: () => {}, stop: () => {} };
  const made: any = mod.createKanbanDispatchModule(storeWatch);
  made.start();
  t.defer(() => made.stop());

  const { kanbanBoardsService: boards, kanbanCardsService: cards } = kanban;
  const board = boards.createBoard({ name: "Archive case board" });
  boards.updateBoard(board.id, { repos: [REPO], autonomy: true });
  if (!boards.getBoard(board.id)?.autonomy) return cannotRun("the scratch board's autonomy would not turn on");
  const card = cards.createCard(board.id, { title: "a queued card", status: "todo" });
  const settle = Date.now() + 10000;
  while ((await told()).length < 1 && Date.now() < settle) await new Promise((r) => setTimeout(r, 100));
  if ((await told()).length < 1) return cannotRun(`the card ${card.id} created on the self-running board was never told: the tell is not reaching the stand-in`);

  // The header's Archive press: `{ archived: true }` and nothing else.
  boards.updateBoard(board.id, { archived: true });
  const deadline = Date.now() + 5000;
  const offFor = async () =>
    (await told()).filter((c) => flag(c.argv, "--event") === "board-off" && c.stdin?.includes(`"id":"${board.id}"`));
  while ((await offFor()).length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));

  const after = boards.getBoard(board.id);
  const events = (await told()).map((c) => flag(c.argv, "--event")).join(", ");
  if ((await offFor()).length === 0) {
    return broken(
      `archived the self-running board ${board.id} with a queued card: the dispatcher was told [${events}] and no board-off; ` +
        `the board reads archived=${after?.archived} autonomy=${after?.autonomy}, so its queued card still walks`,
    );
  }
  return held(`archiving the self-running board told board-off for ${board.id} (told: ${events})`);
});
