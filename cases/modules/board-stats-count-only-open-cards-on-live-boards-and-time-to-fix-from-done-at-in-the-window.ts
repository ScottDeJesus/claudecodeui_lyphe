// The board's numbers are read from its cards and their events, and only from boards and cards not archived.
// kanbanStatsService.stats(null, 7) over every live board: OPEN is not archived and not in Done (by priority and by
// lane); the oldest open high card; time to fix as hours from created_at to done_at over cards whose done_at falls in
// the window (median, per priority); one byDay entry per day of the window whose opened and fixed sum to the cards
// created and closed in it; waysIn by the creating event's actor; cameBack the cards created in the window carrying a
// regression-of: tag. stats(<board>, 7) is that board's alone, named. changelog(null, {}) lists done cards with a line,
// newest done_at first, with their board's name and the kind their tag says. No read writes a row or tells a listener.
//
// The cards are made through the board's own verbs (so each creating event carries its actor), then their times are
// set in the case's own scratch database; nothing here touches the live board.
//
// protects: server/modules/kanban/kanban-stats.service.ts, server/modules/kanban/kanban-stats-figures.ts, server/modules/database/repositories/kanban-stats.db.ts, server/shared/kanban-stats-types.ts, server/modules/kanban/index.ts
// writes: none

import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.now();
const ago = (days: number, plusHours = 0): string => new Date(NOW - days * DAY + plusHours * HOUR).toISOString();

type Spec = {
  key: string; board: "A" | "B" | "Z"; title: string; priority: "high" | "medium" | "low"; status: string;
  actor: string; createdDaysAgo: number; fixHours?: number; doneDaysAgo?: number; tag?: string; line?: string; archived?: boolean;
};

// The four live-board done cards in the window take 2, 10 and 30 hours (median 10); the fourth closed 25 days ago.
const SPECS: Spec[] = [
  { key: "a1", board: "A", title: "Hint says its repo path", priority: "high", status: "todo", actor: "chat", createdDaysAgo: 2 },
  { key: "a2", board: "A", title: "Sweep refuses my path", priority: "medium", status: "not_ready", actor: "operator", createdDaysAgo: 3 },
  { key: "a3", board: "A", title: "Disk check flaps", priority: "low", status: "questions", actor: "cerberus", createdDaysAgo: 1 },
  { key: "a4", board: "A", title: "Old high on Alpha", priority: "high", status: "active", actor: "operator", createdDaysAgo: 20 },
  { key: "a5", board: "A", title: "Red check on the connector", priority: "high", status: "done", actor: "cerberus", createdDaysAgo: 3, fixHours: 2, tag: "bug", line: "The connector answers again." },
  { key: "a6", board: "A", title: "Only show five decisions", priority: "medium", status: "done", actor: "operator", createdDaysAgo: 4, fixHours: 10, tag: "ui-change", line: "The drawer shows five decisions." },
  { key: "a7", board: "A", title: "Archived open card", priority: "high", status: "todo", actor: "operator", createdDaysAgo: 20, archived: true },
  { key: "a8", board: "A", title: "Long closed", priority: "medium", status: "done", actor: "operator", createdDaysAgo: 30, doneDaysAgo: 25, line: "An old fix." },
  { key: "b1", board: "B", title: "The hint came back", priority: "medium", status: "todo", actor: "chat", createdDaysAgo: 1, tag: "regression-of:a5" },
  { key: "b2", board: "B", title: "Rename the switch", priority: "low", status: "done", actor: "cerberus", createdDaysAgo: 2, fixHours: 30, tag: "tweak", line: "The switch says what it does." },
  { key: "b3", board: "B", title: "Oldest high anywhere", priority: "high", status: "todo", actor: "operator", createdDaysAgo: 30, tag: "regression-of:old" },
  { key: "z1", board: "Z", title: "On the archived board", priority: "high", status: "todo", actor: "operator", createdDaysAgo: 40 },
  { key: "z2", board: "Z", title: "Closed on the archived board", priority: "low", status: "done", actor: "chat", createdDaysAgo: 1, fixHours: 5, line: "Never listed." },
];

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "board-stats");
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  process.env.KANBAN_ATTACHMENTS_ROOT = path.join(folder, "attachments");

  const database: any = await import("../../server/modules/database/index.ts");
  await database.initializeDatabase();
  const kanban: any = await import("../../server/modules/kanban/index.ts");
  const stats = kanban.kanbanStatsService;
  if (!stats || typeof stats.stats !== "function" || typeof stats.changelog !== "function") {
    return broken("the kanban barrel exports no kanbanStatsService with stats and changelog");
  }
  const db = database.getConnection();

  const boards = {
    A: kanban.kanbanBoardsService.createBoard({ name: "Alpha" }),
    B: kanban.kanbanBoardsService.createBoard({ name: "Beta" }),
    Z: kanban.kanbanBoardsService.createBoard({ name: "Zed" }),
  };
  const ids: Record<string, string> = {};
  for (const s of SPECS) {
    const c = kanban.kanbanCardsService.createCard(boards[s.board].id, { title: s.title, priority: s.priority, status: s.status }, { actor: s.actor });
    ids[s.key] = c.id;
    if (s.tag) kanban.kanbanCardsService.addTag(c.id, s.tag);
    if (s.archived) kanban.kanbanCardsService.archiveCard(c.id);
    const created = ago(s.createdDaysAgo);
    const done = s.status !== "done" ? null : s.doneDaysAgo !== undefined ? ago(s.doneDaysAgo) : ago(s.createdDaysAgo, s.fixHours);
    db.prepare("UPDATE kanban_cards SET created_at = ?, updated_at = ?, done_at = ?, changelog = ? WHERE id = ?")
      .run(created, done ?? created, done, s.line ?? "", c.id);
    db.prepare("UPDATE kanban_events SET ts = ? WHERE card_id = ? AND kind = 'card.created'").run(created, c.id);
  }
  kanban.kanbanBoardsService.updateBoard(boards.Z.id, { archived: true });

  const eventsBefore = db.prepare("SELECT COUNT(*) AS n FROM kanban_events").get().n;
  let heard = 0;
  const stop = kanban.onKanbanWrite(() => { heard += 1; });
  t.defer(() => stop());

  const all = stats.stats(null, 7);
  const alpha = stats.stats(boards.A.id, 7);
  const lines = stats.changelog(null, {});

  const wrong: string[] = [];
  const eq = (what: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push(`${what} ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
  };
  eq("all: scope", all.scope, { boardId: null, boardName: null, days: 7 });
  eq("all: open.total", all.open?.total, 6);
  eq("all: open.byPriority", all.open?.byPriority, { high: 3, medium: 2, low: 1 });
  eq("all: open.byLane", all.open?.byLane, { not_ready: 1, todo: 3, questions: 1, active: 1 });
  eq("all: oldestOpenHigh", all.oldestOpenHigh?.title, "Oldest high anywhere");
  eq("all: oldestOpenHigh board", all.oldestOpenHigh?.boardName, "Beta");
  const oldest = (all.oldestOpen ?? []).map((c: any) => c.title);
  eq("all: oldestOpen first two", oldest.slice(0, 2), ["Oldest high anywhere", "Old high on Alpha"]);
  eq("all: oldestOpen count", oldest.length, 6);
  eq("all: timeToFix.all count/median", [all.timeToFix?.all?.count, all.timeToFix?.all?.medianHours], [3, 10]);
  eq("all: timeToFix high/medium/low medians", [all.timeToFix?.high?.medianHours, all.timeToFix?.medium?.medianHours, all.timeToFix?.low?.medianHours], [2, 10, 30]);
  const days: any[] = all.byDay ?? [];
  eq("all: byDay length", days.length, 7);
  if (new Set(days.map((d) => d.day)).size !== days.length || !days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day))) wrong.push("all: byDay days are not seven distinct YYYY-MM-DD");
  eq("all: byDay opened/fixed sums", [days.reduce((n, d) => n + d.opened, 0), days.reduce((n, d) => n + d.fixed, 0)], [7, 3]);
  const way = (src: string) => (all.waysIn ?? []).find((w: any) => w.source === src);
  eq("all: waysIn chat", [way("chat")?.opened, way("chat")?.open], [2, 2]);
  eq("all: waysIn cerberus", [way("cerberus")?.opened, way("cerberus")?.open], [3, 1]);
  eq("all: cameBack", all.cameBack, 1);

  eq("Alpha: scope", [alpha.scope?.boardId, alpha.scope?.boardName], [boards.A.id, "Alpha"]);
  eq("Alpha: open.total", alpha.open?.total, 4);
  eq("Alpha: oldestOpenHigh", alpha.oldestOpenHigh?.title, "Old high on Alpha");
  eq("Alpha: timeToFix.all count", alpha.timeToFix?.all?.count, 2);
  eq("Alpha: cameBack", alpha.cameBack, 0);

  eq("changelog: titles newest first", (lines ?? []).map((l: any) => l.title),
    ["Rename the switch", "Red check on the connector", "Only show five decisions", "Long closed"]);
  const byTitle = new Map((lines ?? []).map((l: any) => [l.title, l]));
  eq("changelog: kinds", ["Red check on the connector", "Only show five decisions", "Rename the switch", "Long closed"].map((k) => (byTitle.has(k) ? (byTitle.get(k) as any).kind : "absent")),
    ["bug", "ui-change", "tweak", null]);
  eq("changelog: a line's board and words", [(byTitle.get("Rename the switch") as any)?.boardName, (byTitle.get("Rename the switch") as any)?.changelog], ["Beta", "The switch says what it does."]);

  const eventsAfter = db.prepare("SELECT COUNT(*) AS n FROM kanban_events").get().n;
  if (eventsAfter !== eventsBefore || heard !== 0) wrong.push(`the reads wrote ${eventsAfter - eventsBefore} events and told ${heard} listeners`);

  if (wrong.length > 0) return broken(wrong.join("; ").slice(0, 390));
  return held("open 6 (3/2/1, lanes 1/3/1/1) with archived boards and cards left out; oldest high Beta's; fix median 10h (2/10/30); 7 days summing 7 opened, 3 fixed; chat 2/2, cerberus 3/1; cameBack 1; Alpha alone 4; changelog newest first with kinds; nothing written");
});
