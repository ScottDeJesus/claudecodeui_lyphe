// A card's done_at is the moment it arrived in Done, kept by the board's own move verb: moveCard into Done stamps
// it, a second move within Done (a reorder) keeps the stamp it has, a move out clears it, and a move back stamps
// it anew. The card's detail (getCard) and the board's roster (kanbanRosterService.boardCards) both read it as
// doneAt. updateCard takes a changelog line, which both read back as changelog; a line past 300 characters or one
// holding a line break never lands as given — refused or cut, the stored line stays one line of at most 300.
//
// The verbs run over a database this case creates in its own scratch folder, with the kanban module's services and
// nothing else loaded.
//
// protects: server/modules/kanban/kanban-cards.service.ts, server/modules/database/repositories/kanban-cards.db.ts, server/modules/database/repositories/kanban-roster.db.ts, server/modules/kanban/kanban-roster.service.ts, server/shared/kanban-types.ts
// writes: none

import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const LINE = "The hint now names the folder it means.";
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "done-at-move");
  // Set before the database module loads: it opens the file this names and no other.
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  process.env.KANBAN_ATTACHMENTS_ROOT = path.join(folder, "attachments");

  const { initializeDatabase } = await import("../../server/modules/database/index.ts");
  await initializeDatabase();
  const kanban: any = await import("../../server/modules/kanban/index.ts");
  const cards = kanban.kanbanCardsService;

  const board = kanban.kanbanBoardsService.createBoard({ name: "case board" });
  const card = cards.createCard(board.id, { title: "Hint says its repo path", status: "todo" });
  const other = cards.createCard(board.id, { title: "Another done card", status: "todo" });
  const read = () => {
    const detail = cards.getCard(card.id);
    const roster = kanban.kanbanRosterService.boardCards(board.id).find((c: any) => c.id === card.id);
    return { detail, roster };
  };

  const wrong: string[] = [];
  const say = (step: string, want: (v: string | null | undefined) => boolean, what: string) => {
    const { detail, roster } = read();
    if (!want(detail.doneAt)) wrong.push(`${step}: detail doneAt ${JSON.stringify(detail.doneAt)}, ${what}`);
    if (roster?.doneAt !== detail.doneAt) wrong.push(`${step}: roster doneAt ${JSON.stringify(roster?.doneAt)} is not the detail's`);
    return detail.doneAt as string | null;
  };

  say("in To Do", (v) => v === null, "not null");
  const before = Date.now();
  cards.moveCard(card.id, { status: "done" });
  const first = say("moved into Done", (v) => typeof v === "string" && Date.parse(v) >= before - 1000 && Date.parse(v) <= Date.now() + 1000, "not a stamp of now");

  await pause(30);
  cards.moveCard(other.id, { status: "done" });
  cards.moveCard(card.id, { status: "done", afterId: other.id });
  say("reordered within Done", (v) => v === first, `not the arrival stamp ${first}`);

  cards.moveCard(card.id, { status: "todo" });
  say("moved out to To Do", (v) => v === null, "not null");

  await pause(30);
  cards.moveCard(card.id, { status: "done" });
  say("moved back into Done", (v) => typeof v === "string" && v !== first && Date.parse(v) > Date.parse(first ?? ""), `not a stamp newer than ${first}`);

  cards.updateCard(card.id, { changelog: LINE });
  const { detail, roster } = read();
  if (detail.changelog !== LINE) wrong.push(`updateCard changelog: detail reads ${JSON.stringify(detail.changelog)}`);
  if (roster?.changelog !== LINE) wrong.push(`updateCard changelog: roster reads ${JSON.stringify(roster?.changelog)}`);

  const bad: Array<[string, string]> = [["a line of 301 characters", "x".repeat(301)], ["two lines", "First line.\nSecond line."]];
  for (const [what, line] of bad) {
    let refused = false;
    try {
      cards.updateCard(card.id, { changelog: line });
    } catch {
      refused = true;
    }
    const stored: unknown = cards.getCard(card.id).changelog;
    if (typeof stored !== "string") {
      wrong.push(`after ${what} the detail carries no changelog string (${typeof stored})`);
      continue;
    }
    if (stored === line || /[\r\n]/.test(stored) || stored.length > 300) {
      wrong.push(`${what} was ${refused ? "refused yet " : ""}stored as ${JSON.stringify(stored.slice(0, 40))}… (${stored.length} chars)`);
    }
  }

  if (wrong.length > 0) return broken(wrong.join("; ").slice(0, 380));
  return held("doneAt: null in To Do, stamped on arrival, kept by a reorder in Done, null after leaving, newer on return — detail and roster agree; the changelog line reads back, and a 301-char or two-line one never lands as given");
});
