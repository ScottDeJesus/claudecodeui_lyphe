// ONE TICKET, ONE CARD. The placing pass makes a ticket's card, then stamps the ticket back (`bug placed`). Until that
// stamp lands the ticket still reads `filed`, and `bug pending` lists it to every pass that asks. Two moments make a
// second pass ask while the first card already stands:
//   (a) the stamp failed (a locked store) and is owed, but what is owed lives in the server's memory, and a save's
//       handover replaces the server: the new one lists the ticket `filed` and has nothing owed;
//   (b) during a handover the old and the new server stand at once (the dev supervisor boots the new one BESIDE the
//       old, and `kanbanDispatch.start()` runs in every boot's listen callback, not in the sole server's duties).
// Either way the board must hold one card for the ticket, and the ticket be stamped with it.
//
// The dispatcher is the stand-in of lib/board_placing.mjs; the board lives in a database this case makes, and each
// "server" is one `createKanbanDispatchModule` over it, mounted as the server mounts it.
//
// protects: server/modules/kanban-dispatch/kanban-dispatch.tickets.ts, server/modules/kanban-dispatch/kanban-dispatch.apply.ts, server/modules/kanban-dispatch/kanban-dispatch.module.ts
// writes: none

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { gitFolder, placingRig, quietJournal } from "../lib/board_placing.mjs";

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const rig = await placingRig(t, "one-card", {});
  const R = await gitFolder(path.join(rig.folder, "repo"));
  const ticket = (id: number, title: string, extra: Record<string, unknown> = {}) => ({
    id, source: "chat", path: R, title, description: "the words", priority: "medium", shots: [], tags: [], lane: "todo", state: "filed", ...extra,
  });
  const seeded = await rig.state();
  seeded.tickets = [ticket(1, "the ticket whose stamp failed", { failStamps: 1 })];
  await writeFile(path.join(rig.folder, "state.json"), JSON.stringify(seeded));

  quietJournal(t);
  const { kanban } = await rig.open();
  const { kanbanBoardsService: boards, kanbanRosterService: roster } = kanban as any;
  const board = boards.createBoard({ name: "One card board", repos: [R] });
  if (!board?.id) return cannotRun("the scratch board would not be made");
  const mod: any = await import("../../server/modules/kanban-dispatch/index.ts");
  const storeWatch = { attach: () => () => {}, followChains: () => {}, start: () => {}, stop: () => {} };
  const server = () => {
    const made = mod.createKanbanDispatchModule(storeWatch);
    t.defer(() => made.stop());
    return made;
  };

  // (a) The first server places ticket 1, its stamp fails, and a save's handover replaces it.
  const first = server();
  first.start();
  await rig.settle();
  first.stop();
  const second = server();
  second.start();
  await rig.settle();
  second.stop();

  // (b) Ticket 2 is filed while two servers stand at once.
  const s = await rig.state();
  s.tickets.push(ticket(2, "the ticket filed during a handover"));
  await writeFile(path.join(rig.folder, "state.json"), JSON.stringify(s));
  const old = server();
  const successor = server();
  old.start();
  successor.start();
  await rig.settle();

  const onBoard: any[] = roster.boardCards(board.id);
  const after = await rig.state();
  const wrong: string[] = [];
  const said: string[] = [];
  for (const [id, moment] of [[1, "a stamp the restart forgot"], [2, "a handover"]] as const) {
    const title = after.tickets.find((x: any) => x.id === id).title;
    const cards = onBoard.filter((c) => c.title === title);
    const stamped = after.tickets.find((x: any) => x.id === id);
    if (cards.length !== 1) wrong.push(`across ${moment}, ticket ${id} is ${cards.length} cards on the board (${cards.map((c) => c.id).join(", ")})`);
    else if (stamped.state !== "placed" || stamped.card?.id !== cards[0].id) wrong.push(`ticket ${id} reads ${stamped.state} with card ${stamped.card?.id}, not its one card ${cards[0].id}`);
    said.push(`ticket ${id}: ${cards.length} card`);
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`each ticket is one card, stamped with it, across a forgotten stamp and a handover (${said.join(", ")})`);
});
