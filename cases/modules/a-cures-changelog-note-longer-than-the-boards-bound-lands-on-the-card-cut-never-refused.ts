// THE CHANGELOG LINE'S BOUND: the line a finished walk leaves reaches the board as the dispatcher's `text` note
// `{changelog}`, built by the house's one note builder (`card_notes.changelog`). The night's cure writes
// `Holds again: <the first case's sentence>`, and a case's sentence is most often longer than the board's 300; a walk's
// own line is cut by the house at 300 code points, which the board counts in UTF-16 units. Either way the line must land
// on the card (cut, if it must be cut) and never be refused, or the card keeps no line, the word back carries none and
// the changelog route lists the card with an empty line.
//
// The two notes are built by the real `card_notes.changelog` (so a bound put there is seen), carried by the stand-in
// dispatcher of lib/board_placing.mjs, and applied by the real board-dispatch applier (so a cut there is seen too).
//
// protects: server/modules/kanban-dispatch/kanban-dispatch.apply.ts, server/modules/kanban-dispatch/kanban-dispatch.notes.ts, server/modules/kanban/kanban-cards.guards.ts
// writes: none

import { execFileSync } from "node:child_process";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { gitFolder, mountBoardDispatch, placingRig, quietJournal } from "../lib/board_placing.mjs";

const HOOKS = "/home/lyphe/.claude/hooks";
const BOUND = 300;
// A real sentence of this suite (the-drawer-lists-the-decisions-a-walk-noted-newest-first-and-not-an-answered-questions-own), 384 characters.
const SENTENCE =
  "Given a self-running board's card whose detail carries three decisions a walk noted (questionId null) at three different times and one decision recording an answered question (questionId set) → its drawer is opened → the Decided for you group counts 3 and lists exactly the three noted decisions, newest first, each with its question and its choice, and never the answered question's.";
const CURE_LINE = `Holds again: ${SENTENCE}`;
const EMOJI_LINE = [..."Fixed 🐛 ".repeat(60)].slice(0, BOUND - 1).join("").trimEnd() + "…";

/** The payload the house's own builder writes for a changelog line. */
function housePayload(line: string): Record<string, unknown> {
  const script = "import sys, json\nsys.path.insert(0, sys.argv[1])\nfrom dispatcher import card_notes\nprint(json.dumps(card_notes.changelog(sys.argv[2]).payload))";
  return JSON.parse(execFileSync("python3", ["-I", "-c", script, HOOKS, line], { encoding: "utf8" }));
}

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  let curePayload: Record<string, unknown>;
  let emojiPayload: Record<string, unknown>;
  try {
    curePayload = housePayload(CURE_LINE);
    emojiPayload = housePayload(EMOJI_LINE);
  } catch (error) {
    return cannotRun(`the house's card_notes.changelog could not be run: ${error instanceof Error ? error.message : String(error)}`);
  }
  const rig = await placingRig(t, "changelog-bound", {});
  const R = await gitFolder(path.join(rig.folder, "repo"));
  quietJournal(t);
  const { kanban } = await rig.open();
  const { kanbanBoardsService: boards, kanbanCardsService: cards } = kanban as any;
  const board = boards.createBoard({ name: "Bound board", repos: [R] });
  const cure = cards.createCard(board.id, { title: "the cured card", status: "active" });
  const emoji = cards.createCard(board.id, { title: "the emoji card", status: "active" });
  await rig.addNotes([
    { id: 1, board: board.id, card: cure.id, title: "the cured card", kind: "text", payload: curePayload },
    { id: 2, board: board.id, card: emoji.id, title: "the emoji card", kind: "text", payload: emojiPayload },
  ]);
  const mounted: any = await mountBoardDispatch(t);
  if (mounted.unmounted) return broken(mounted.unmounted);
  await rig.settle();

  const s = await rig.state();
  const wrong: string[] = [];
  const seen: string[] = [];
  for (const [id, card, label] of [[1, cure, "the cure's line"], [2, emoji, "the emoji line"]] as const) {
    const raw = s.results[id];
    if (raw === undefined) wrong.push(`${label}'s note was never stamped`);
    else if (raw !== null && String(raw).includes("refused")) wrong.push(`${label}'s note was stamped ${raw}`);
    const line: string = cards.getCard(card.id).changelog;
    const points = [...line].length;
    if (line === "") wrong.push(`${label}: the card's changelog is empty`);
    else if (points > BOUND) wrong.push(`${label}: the card's changelog is ${points} characters`);
    else if (id === 1 && !line.startsWith("Holds again:")) wrong.push(`the cure's card reads ${JSON.stringify(line.slice(0, 40))}, not its Holds again line`);
    seen.push(`${label} ${points} characters`);
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`both changelog notes landed on their cards, cut to the bound: ${seen.join(", ")}`);
});
