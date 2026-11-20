// protects: server/modules/kanban-dispatch/kanban-dispatch.tickets.ts, server/modules/kanban-dispatch/kanban-dispatch.tell.ts, server/modules/kanban-dispatch/kanban-dispatch.cards.ts, server/modules/kanban/kanban-questions.service.ts, /home/lyphe/.claude/hooks/dispatcher/bug_hunter.py, /home/lyphe/.claude/hooks/dispatcher/cmd/bug.py
// writes: none
//
// THE QUESTIONS LANE (bug-hunters seam 10). `bug pending --json` lists a security hunter's `--needs-you` ticket with
// `source: "hunter"`, `lane: "questions"` and `question: {text, options}`; the placing pass makes its card in To Do and
// asks the question through `kanbanQuestionsService.addQuestion`, which moves it to `questions` in the same write, then
// stamps it {board, card} as any ticket. A plain hunter ticket (lane todo) is placed as any ticket, its actor `hunter`.
// `hunter` is a ticket source, so the teller never tells `created` for either card (the stamp wrote its row).
// On a board that runs itself the house's `bug placed` ALSO owes the board a `question` note (and a `status questions`
// note) for the card (`bug_hunter.park`); the applier's `askOnce` takes it as the question already asked, so the card
// holds one open question, not two — which holds only while the pass asks with the house's own text verbatim.
//
// The question's words and the note's payload are the house's own (`bug_hunter.question`, `card_notes.question`),
// computed here by the house's Python, so a change of either side's words is read, never a copy of them.
// The dispatcher is the stand-in of lib/board_placing.mjs; the board lives in a database this case makes.

import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { gitFolder, mountBoardDispatch, placingRig, quietJournal } from "../lib/board_placing.mjs";

const HOOKS = path.join(os.homedir(), ".claude", "hooks");
const SENTENCE = "Staff sign in again tomorrow";

/** The house's question for a needs-you ticket and the house's note payload for the same card, as JSON. */
function houseWords(): { question: { text: string; options: string[] }; note: { text: string; options: string[]; free: boolean } } {
  const program = [
    "import json, sys",
    `sys.path[:0] = [${JSON.stringify(HOOKS)}]`,
    "from dispatcher import bug_hunter, card_notes",
    `row = {"needs_you": ${JSON.stringify(SENTENCE)}}`,
    "q = bug_hunter.question(row)",
    "n = card_notes.question(bug_hunter.question_text(row['needs_you']), list(bug_hunter.NEEDS_YOU_OPTIONS), False, key='needs-you:1')",
    "print(json.dumps({'question': q, 'note': n.payload}))",
  ].join("\n");
  return JSON.parse(execFileSync("python3", ["-I", "-c", program], { encoding: "utf8", cwd: HOOKS, timeout: 30000 }));
}

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  let words;
  try {
    words = houseWords();
  } catch (error) {
    return cannotRun(`the house's bug_hunter would not say its question: ${String((error as Error).message).split("\n")[0]}`);
  }
  if (!words?.question?.text || !Array.isArray(words.question.options)) return cannotRun(`the house's question reads ${JSON.stringify(words?.question)}`);

  const rig = await placingRig(t, "questions-lane", {});
  const R = await gitFolder(path.join(rig.folder, "repo"));
  const seeded = await rig.state();
  seeded.tickets = [
    { id: 1, source: "hunter", path: R, title: "the security hunter's needs-you ticket", description: "a key rotates", priority: "high", shots: [], tags: ["hunter:security", "needs-you"], lane: "questions", question: words.question, state: "filed" },
    { id: 2, source: "hunter", path: R, title: "the code hunter's ticket", description: "a swallowed error", priority: "medium", shots: [], tags: ["hunter:code"], lane: "todo", state: "filed" },
  ];
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(rig.folder, "state.json"), JSON.stringify(seeded));

  const journal = quietJournal(t);
  const { kanban } = await rig.open();
  const { kanbanBoardsService: boards, kanbanCardsService: cards } = kanban as any;
  const board = boards.createBoard({ name: "Self-running board", repos: [R] });
  boards.updateBoard(board.id, { autonomy: true });
  if (!boards.getBoard(board.id)?.autonomy) return cannotRun("the scratch board's autonomy would not turn on");

  const mounted: any = await mountBoardDispatch(t);
  if (mounted.unmounted) return broken(mounted.unmounted);
  await rig.settle();
  mounted.poke();
  await rig.settle();

  const wrong: string[] = [];
  const heard: any[] = await rig.calls();
  const verb = (c: any) => `${c.argv[0]} ${c.argv[1]}`;
  const stampOf = (id: number) => {
    const tries = heard.filter((c) => verb(c) === "bug placed" && c.argv[2] === String(id));
    if (tries.length === 0) return null;
    try {
      return JSON.parse(tries[tries.length - 1].stdin ?? "");
    } catch {
      return null;
    }
  };
  const unread = journal.filter((line) => /ticket [12]:/.test(line));

  const asked = stampOf(1);
  const plain = stampOf(2);
  if (!asked?.card?.id) wrong.push(`the needs-you ticket was not stamped with a card (${JSON.stringify(asked)})${unread.length ? `; the pass said: ${unread[0].slice(0, 140)}` : ""}`);
  if (!plain?.card?.id) wrong.push(`the plain hunter ticket was not stamped with a card (${JSON.stringify(plain)})${unread.length ? `; the pass said: ${unread[unread.length - 1].slice(0, 140)}` : ""}`);
  if (wrong.length > 0) return broken(wrong.join("; ").slice(0, 600));

  const openQuestions = (id: string) => (cards.getCard(id).questions ?? []).filter((q: any) => !q.answered);
  const first = cards.getCard(asked.card.id);
  if (first.status !== "questions") wrong.push(`the needs-you card stands in ${first.status}, not questions`);
  const open1 = openQuestions(first.id);
  if (open1.length !== 1) wrong.push(`the needs-you card holds ${open1.length} open questions at placing, not 1`);
  else {
    if (open1[0].text !== words.question.text) wrong.push(`its question reads ${JSON.stringify(open1[0].text).slice(0, 120)}, not the house's`);
    if (JSON.stringify(open1[0].options) !== JSON.stringify(words.question.options)) wrong.push(`its options are ${JSON.stringify(open1[0].options)}, not ${JSON.stringify(words.question.options)}`);
  }
  if (cards.createdBy(first.id) !== "hunter") wrong.push(`the needs-you card was created by ${cards.createdBy(first.id)}, not hunter`);
  const second = cards.getCard(plain.card.id);
  if (second.status !== "todo") wrong.push(`the plain hunter card stands in ${second.status}, not todo`);
  if (openQuestions(second.id).length !== 0) wrong.push("the plain hunter card was asked a question");
  if (cards.createdBy(second.id) !== "hunter") wrong.push(`the plain hunter card was created by ${cards.createdBy(second.id)}, not hunter`);
  for (const [id, stamp] of [[1, asked], [2, plain]] as const) {
    const keys = Object.keys(stamp).sort().join(",");
    if (keys !== "board,card" || stamp.board?.id !== board.id) wrong.push(`ticket ${id}'s stamp is ${JSON.stringify(stamp).slice(0, 120)}, not {board, card} on the board`);
  }
  const toldCreated = heard.filter((c) => verb(c) === "card told" && c.argv.includes("created"));
  if (toldCreated.length > 0) wrong.push(`the teller told ${toldCreated.length} created for the hunter's cards: ${JSON.stringify(toldCreated[0].argv)}`);

  // The house's own notes for the parked card arrive, as bug placed on a board that runs itself writes them.
  await rig.addNotes([
    { id: 1, board: board.id, card: first.id, title: "the security hunter's needs-you ticket", kind: "question", payload: words.note },
    { id: 2, board: board.id, card: first.id, title: "the security hunter's needs-you ticket", kind: "status", payload: { status: "questions" } },
  ]);
  mounted.poke();
  await rig.settle();
  const after = await rig.state();
  if (!after.applied.includes(1)) wrong.push("the house's question note for the card was never applied");
  const open2 = openQuestions(first.id);
  if (open2.length !== 1) wrong.push(`after the house's question note the card holds ${open2.length} open questions, not 1: it was asked twice`);
  if (cards.getCard(first.id).status !== "questions") wrong.push(`after the house's notes the card stands in ${cards.getCard(first.id).status}, not questions`);

  if (wrong.length > 0) return broken(wrong.join("; ").slice(0, 600));
  return held("both hunter tickets placed as hunter and stamped {board, card}; the needs-you card stands in questions with the house's question and two options; no created told; the house's question note applied after leaves one open question");
});
