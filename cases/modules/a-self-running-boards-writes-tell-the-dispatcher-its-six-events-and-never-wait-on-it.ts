// TELL: the board-dispatch module's one onKanbanWrite listener runs `dispatcher card told --event <e> --by <actor>`,
// the board, the card and the answers as one JSON object on stdin, for a board whose autonomy is on and an actor
// other than `dispatcher` — the six mappings and nothing else: card.created → created; card.moved to todo → queued;
// card.updated → updated; question.answered leaving no question of the card open → answered; card.moved to not_ready
// or done, or card.archived → stopped; board.updated turning autonomy off → board-off. The card's attachments travel as
// absolute paths. The write never waits on the tell and never hears it fail.
//
// The dispatcher is a stand-in written into this case's scratch folder (DISPATCHER_BIN), which records each call;
// every write lands in a database this case creates there. Nothing reaches the real dispatcher.
//
// protects: server/modules/kanban-dispatch/, server/modules/kanban/kanban-write.service.ts, server/modules/kanban/index.ts, server/modules/dispatcher/dispatcher-ask.transport.ts
// writes: none

import { execFileSync } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("0000000d49484452000000010000000108060000001f15c489", "hex"),
]);

// The stand-in: records argv (and stdin for `told`) as one JSON line, sleeps 3 s on a card titled "slow-tell …",
// exits 1 on one titled "fail-tell …", and answers `card notes --json` with no notes and `card config` with defaults.
const STAND_IN = `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const home = path.dirname(process.argv[1]); const argv = process.argv.slice(2);
const log = (o) => fs.appendFileSync(path.join(home, "calls.jsonl"), JSON.stringify(o) + "\\n");
if (argv[0] === "card" && argv[1] === "told") {
  let input = ""; process.stdin.on("data", (c) => (input += c)); process.stdin.on("end", () => {
    const slow = input.includes("slow-tell"); const fail = input.includes("fail-tell");
    setTimeout(() => { log({ argv, stdin: input, at: Date.now() }); if (fail) { console.log("REFUSED card told: the stand-in fails"); process.exit(2); } console.log("TOLD card x/y — queued"); }, slow ? 3000 : 0);
  });
} else {
  log({ argv, at: Date.now() });
  if (argv[0] === "card" && argv[1] === "notes") console.log("[]");
  else if (argv[0] === "card" && argv[1] === "config") console.log(JSON.stringify({ width: 1, threshold: 0.8, path: "/nowhere/cards.toml" }));
  else if (argv[0] === "cards") console.log("[]");
}
`;

type Call = { argv: string[]; stdin?: string; at: number };

const flag = (argv: string[], name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};

async function mountDispatch(t: any, bin: string): Promise<string | null> {
  let mod: any;
  try {
    mod = await import("../../server/modules/kanban-dispatch/index.ts");
  } catch (error) {
    return `server/modules/kanban-dispatch/index.ts would not load: ${String((error as Error)?.message ?? error).split("\n")[0]}`;
  }
  const factory =
    mod.createKanbanDispatchModule ??
    Object.values(mod).find((value: any) => typeof value === "function" && /^create/.test(value.name));
  if (typeof factory !== "function") return "the kanban-dispatch barrel exports no create… function to mount the module with";
  // The server hands the factory its store watch (`createKanbanDispatchModule(dispatcherStoreWatch)`); a stand-in watch
  // that never pokes. The dispatcher it runs is DISPATCHER_BIN's, set before the import.
  const storeWatch = { attach: () => () => {}, followChains: () => {}, start: () => {}, stop: () => {} };
  const made: any = await factory(storeWatch);
  if (made && typeof made.start === "function") await made.start();
  t.defer(() => made?.stop?.());
  return null;
}

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "board-tell");
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  process.env.KANBAN_ATTACHMENTS_ROOT = path.join(folder, "attachments");
  const bin = path.join(folder, "dispatcher");
  await writeFile(bin, STAND_IN);
  await chmod(bin, 0o755);
  process.env.DISPATCHER_BIN = bin;
  const shot = path.join(folder, "before-desktop-board.png");
  await writeFile(shot, PNG);
  const callsFile = path.join(folder, "calls.jsonl");
  const calls = async (): Promise<Call[]> =>
    fs.existsSync(callsFile)
      ? (await readFile(callsFile, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Call)
      : [];
  const told = async (): Promise<Call[]> => (await calls()).filter((c) => c.argv[0] === "card" && c.argv[1] === "told");

  const { initializeDatabase } = await import("../../server/modules/database/index.ts");
  await initializeDatabase();
  const kanban: any = await import("../../server/modules/kanban/index.ts");
  const quiet = console.error;
  console.error = () => {};
  t.defer(() => {
    console.error = quiet;
  });
  const unmounted = await mountDispatch(t, bin);
  if (unmounted) return broken(unmounted);

  const { kanbanBoardsService: boards, kanbanCardsService: cards, kanbanQuestionsService: questions } = kanban;
  const on = boards.createBoard({ name: "Case board" });
  boards.updateBoard(on.id, { repos: [REPO], autonomy: true });
  const off = boards.createBoard({ name: "Quiet board" });
  if (!boards.getBoard(on.id)?.autonomy) return cannotRun("the scratch board's autonomy would not turn on");

  // Each write is its own turn of the event loop, as each HTTP request is: a tell is judged on the board as the write
  // left it, never on a board a later request has changed.
  const turn = () => new Promise((r) => setImmediate(r));
  const wrong: string[] = [];
  const one = cards.createCard(on.id, { title: "case card one", description: "the words" });
  await turn();
  cards.createCard(off.id, { title: "a card of a board with autonomy off" });
  await turn();
  cards.createCard(on.id, { title: "made by the dispatcher" }, { actor: "dispatcher" });
  await turn();
  cards.addTag(one.id, "bug");
  await turn();
  kanban.kanbanAttachmentsService.addAttachmentFromPath(one.id, shot);
  await turn();
  cards.moveCard(one.id, { status: "todo" });
  await turn();
  cards.updateCard(one.id, { title: "case card one, retitled" });
  await turn();
  const first = questions.addQuestion(one.id, { text: "First?", options: ["a", "b"] });
  await turn();
  const second = questions.addQuestion(one.id, { text: "Second?", options: ["c", "d"] });
  await turn();
  questions.answerQuestion(first.id, { selected: ["a"] });
  await turn();
  questions.answerQuestion(second.id, { selected: ["d"] });
  await turn();
  cards.moveCard(one.id, { status: "done" });
  await turn();
  const two = cards.createCard(on.id, { title: "case card two" });
  await turn();
  cards.moveCard(two.id, { status: "todo" });
  await turn();
  cards.moveCard(two.id, { status: "not_ready" });
  await turn();
  cards.archiveCard(two.id);
  await turn();
  let failing: any = null;
  try {
    failing = cards.createCard(on.id, { title: "fail-tell card" });
  } catch (error) {
    wrong.push(`a create whose tell fails threw: ${String((error as Error)?.message ?? error)}`);
  }
  await turn();
  if (failing) cards.moveCard(failing.id, { status: "todo" }, { actor: "dispatcher" });
  await turn();
  boards.updateBoard(on.id, { name: "Case board, renamed" });
  const owedFirst = 10;
  const settle = Date.now() + 20000;
  while ((await told()).length < owedFirst && Date.now() < settle) await new Promise((r) => setTimeout(r, 200));

  // A card's tells take turns, so one can wait behind a slow one (a create's sort). The slow create is told while the
  // board runs itself; the archive, written while it still does, waits behind it; then the board is turned off. The
  // archive is still owed its `stopped`: it was a person stopping a card of a self-running board.
  const started = Date.now();
  const slow = cards.createCard(on.id, { title: "slow-tell card" });
  const slowMs = Date.now() - started;
  if (slowMs > 1000) wrong.push(`a create whose tell takes 3 s returned after ${slowMs} ms: the write waited on the tell`);
  await new Promise((r) => setTimeout(r, 300));
  cards.archiveCard(slow.id);
  await turn();
  boards.updateBoard(on.id, { autonomy: false });

  const expected = [
    `created ${one.id}`, `queued ${one.id}`, `updated ${one.id}`, `answered ${one.id}`, `stopped ${one.id}`,
    `created ${two.id}`, `queued ${two.id}`, `stopped ${two.id}`, `stopped ${two.id}`,
    `created ${failing?.id}`, `created ${slow.id}`, `stopped ${slow.id}`, `board-off ${on.id}`,
  ].sort();
  const deadline = Date.now() + 20000;
  while ((await told()).length < expected.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 1500)); // a tell owed to nobody would land in this window

  const heard = await told();
  const said = (call: Call): { event: string; subject: string; body: any } => {
    let body: any = null;
    try {
      body = JSON.parse(call.stdin ?? "");
    } catch {
      wrong.push(`a card told call carried stdin that is not JSON: ${(call.stdin ?? "").slice(0, 80)}`);
    }
    const event = flag(call.argv, "--event") ?? "?";
    const by = flag(call.argv, "--by");
    if (by !== "operator") wrong.push(`card told --event ${event} was run with --by ${by}, not operator`);
    return { event, subject: event === "board-off" ? body?.board?.id : body?.card?.id, body };
  };
  const parsed = heard.map(said);
  const got = parsed.map((p) => `${p.event} ${p.subject}`).sort();
  if (got.join("|") !== expected.join("|")) {
    const missing = expected.filter((e) => !got.includes(e));
    const extra = got.filter((g) => !expected.includes(g));
    wrong.push(`told [${got.join(", ")}] — missing [${missing.join(", ")}], not owed [${extra.join(", ")}]`);
  }

  // Each stdin as the dispatcher itself reads it: `card_told.parse` is the parser `dispatcher card told` runs, and it
  // reads only text — no store is opened.
  const HOOKS = path.join(process.env.HOME ?? "", ".claude", "hooks");
  for (const call of heard) {
    const event = flag(call.argv, "--event") ?? "?";
    try {
      execFileSync("python3", ["-c", "import sys; from dispatcher import card_told; card_told.parse(sys.stdin.read(), sys.argv[1])", event], {
        input: call.stdin ?? "", env: { ...process.env, PYTHONPATH: HOOKS, PYTHONDONTWRITEBYTECODE: "1" }, stdio: ["pipe", "pipe", "pipe"], timeout: 30000,
      });
    } catch (error: any) {
      const said = String(error?.stderr ?? error?.message ?? error).trim().split("\n").pop();
      wrong.push(`the dispatcher's own parser refuses the ${event} tell's stdin: ${said}`);
    }
  }

  const created = parsed.find((p) => p.event === "created" && p.subject === one.id)?.body;
  if (created) {
    if (created.board?.id !== on.id || created.board?.name !== "Case board" || JSON.stringify(created.board?.repos) !== JSON.stringify([REPO])) {
      wrong.push(`the created tell's board is ${JSON.stringify(created.board)}, not { id, name "Case board", repos [${REPO}] }`);
    }
    const card = created.card ?? {};
    for (const key of ["id", "title", "description", "body", "tags", "priority", "attachments"]) {
      if (!(key in card)) wrong.push(`the created tell's card has no ${key}`);
    }
    if (card.title !== "case card one" || card.description !== "the words" || card.priority !== "medium") {
      wrong.push(`the created tell's card reads title ${card.title}, description ${card.description}, priority ${card.priority}`);
    }
  }
  const updated = parsed.find((p) => p.event === "updated")?.body?.card;
  if (updated) {
    if (updated.title !== "case card one, retitled") wrong.push(`the updated tell carries title ${updated.title}`);
    if (!Array.isArray(updated.tags) || !updated.tags.includes("bug")) wrong.push(`the updated tell carries tags ${JSON.stringify(updated.tags)}`);
    const shots = Array.isArray(updated.attachments) ? updated.attachments : [];
    if (shots.length !== 1 || !path.isAbsolute(String(shots[0])) || !fs.existsSync(String(shots[0]))) {
      wrong.push(`the updated tell carries attachments ${JSON.stringify(updated.attachments)}, not the one file's absolute path`);
    }
  }
  const answered = parsed.find((p) => p.event === "answered")?.body;
  if (answered) {
    const answers = Array.isArray(answered.answers) ? answered.answers : [];
    const last = answers.find((a: any) => a?.question === "Second?");
    if (!last || JSON.stringify(last.selected) !== JSON.stringify(["d"]) || !("other" in last)) {
      wrong.push(`the answered tell carries answers ${JSON.stringify(answered.answers)}, with no { question "Second?", selected ["d"], other }`);
    }
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`thirteen tells, each its own event, --by operator, board/card/answers on stdin that the dispatcher's parser reads (one absolute attachment path); none for the quiet board or actor dispatcher; an archive waiting behind a 3 s tell still told after the board went off; the create returned in ${slowMs} ms and a failing tell threw nothing`);
});
