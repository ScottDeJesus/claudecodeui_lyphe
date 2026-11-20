// THE WORD BACK TO A PERSON: when the board's note applier applies a `status done` note that MOVES a card into Done, it
// hands one event per active user to the notification orchestrator, as `dispatcher.module.ts` hands an ending:
// provider `system`, code `bug.fixed`, meta {boardName, title, changelog}; kind `stop` when the card's creating actor
// (`createdBy`) is `operator` or `restorly` — a person filed it — and `record` for any other filer. A card the note
// finds already in Done is moved by nothing and earns no word. The copy (`notification-copy.service.ts`) reads title
// `Fixed: <title>` and a body holding the changelog line and the board's name.
//
// The dispatcher is the stand-in of lib/board_placing.mjs, holding the three notes; the users and the board live in a
// database this case makes. The orchestrator's listeners hear every event before its own gates, so the case listens
// there; no push leaves (the scratch users have no channel).
//
// protects: server/modules/kanban-dispatch/kanban-dispatch.apply.ts, server/modules/kanban-dispatch/kanban-dispatch.word.ts, server/modules/notifications/services/notification-copy.service.ts, server/modules/kanban/kanban-cards.service.ts
// writes: none

import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { gitFolder, mountBoardDispatch, placingRig, quietJournal } from "../lib/board_placing.mjs";

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const rig = await placingRig(t, "word-back", {});
  const R = await gitFolder(path.join(rig.folder, "repo"));
  quietJournal(t);
  const { kanban, database } = await rig.open();
  const { kanbanBoardsService: boards, kanbanCardsService: cards } = kanban as any;
  const { userDb } = database as any;
  userDb.createUser("first-person", "x");
  userDb.createUser("second-person", "x");
  const users: number[] = userDb.getActiveUserIds();
  if (users.length !== 2) return cannotRun(`the scratch database holds ${users.length} active users, not the two made`);

  const notifications: any = await import("../../server/modules/notifications/index.ts");
  const heard: { userId: number; event: any }[] = [];
  const off = notifications.onNotification((userId: number, event: any) => heard.push({ userId, event }));
  t.defer(() => off());

  const board = boards.createBoard({ name: "Word board", repos: [R] });
  const his = cards.createCard(board.id, { title: "his own bug", status: "active" });
  const chats = cards.createCard(board.id, { title: "a chat's bug", status: "active" }, { actor: "chat" });
  const already = cards.createCard(board.id, { title: "already finished", status: "todo" });
  cards.moveCard(already.id, { status: "done" });
  cards.updateCard(his.id, { changelog: "His bug no longer happens." });
  cards.updateCard(chats.id, { changelog: "The chat's bug no longer happens." });
  cards.updateCard(already.id, { changelog: "Finished long ago." });

  await rig.addNotes([
    { id: 1, board: board.id, card: his.id, title: "his own bug", kind: "status", payload: { status: "done" } },
    { id: 2, board: board.id, card: chats.id, title: "a chat's bug", kind: "status", payload: { status: "done" } },
    { id: 3, board: board.id, card: already.id, title: "already finished", kind: "status", payload: { status: "done" } },
  ]);
  const mounted: any = await mountBoardDispatch(t);
  if (mounted.unmounted) return broken(mounted.unmounted);
  await rig.settle();
  await new Promise((r) => setTimeout(r, 500));

  const wrong: string[] = [];
  if (cards.getCard(his.id).status !== "done" || cards.getCard(chats.id).status !== "done") return broken("the status done notes did not move the two cards into Done");
  const fixed = heard.filter((h) => h.event?.code === "bug.fixed");
  const of = (title: string) => fixed.filter((h) => h.event?.meta?.title === title);
  const check = (title: string, changelog: string, kind: string) => {
    const got = of(title);
    const who = got.map((h) => h.userId).sort().join(",");
    if (who !== [...users].sort().join(",")) wrong.push(`"${title}" was told to users [${who}], not once to each of [${users.join(",")}]`);
    for (const h of got) {
      const e = h.event;
      if (e.provider !== "system") wrong.push(`"${title}"'s event names provider ${e.provider}, not system`);
      if (e.kind !== kind) wrong.push(`"${title}"'s event is a ${e.kind}, not a ${kind}`);
      const meta = JSON.stringify({ boardName: e.meta?.boardName, title: e.meta?.title, changelog: e.meta?.changelog });
      if (meta !== JSON.stringify({ boardName: "Word board", title, changelog })) wrong.push(`"${title}"'s meta is ${JSON.stringify(e.meta)}`);
      const text = notifications.buildNotificationText(e);
      if (!String(text.title).startsWith(`Fixed: ${title}`)) wrong.push(`"${title}"'s copy is titled ${JSON.stringify(text.title)}, not Fixed: ${title}`);
      if (!String(text.body).includes(changelog) || !String(text.body).includes("Word board")) wrong.push(`"${title}"'s copy body ${JSON.stringify(text.body)} does not hold the changelog line and the board's name`);
    }
  };
  check("his own bug", "His bug no longer happens.", "stop");
  check("a chat's bug", "The chat's bug no longer happens.", "record");
  if (of("already finished").length > 0) wrong.push(`a card the note found already in Done earned ${of("already finished").length} bug.fixed event(s)`);
  if (fixed.length !== 4) wrong.push(`${fixed.length} bug.fixed events were heard, not four`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("two cards moved into Done by status done notes: his a stop and the chat's a record, once per active user, meta {boardName, title, changelog}, copy `Fixed: <title>` with the line and the board; the card already in Done earned nothing");
});
