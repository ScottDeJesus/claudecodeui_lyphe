// PLACE: the first step of every pass of the board's note applier runs `dispatcher bug pending --json`; for each ticket
// `kanbanBoardsService.boardForPath(path)` picks the board. A board: `createCard` in the ticket's `lane` at its
// priority, the ticket's source as the actor, `addTag` for its ticket tag `ticket:<id>` and then per tag,
// `addAttachmentFromPath` per shot, then
// `dispatcher bug placed <id> --result -` with {board: {id, name, repos, autonomy}, card: {id}}. No board: the stamp is
// {unplaced: "no board names <path>"}. A stamp that fails is owed and retried as a stamp only, never a second card.
//
// The dispatcher is the stand-in of lib/board_placing.mjs; the board lives in a database this case makes.
//
// protects: server/modules/kanban-dispatch/kanban-dispatch.tickets.ts, server/modules/kanban-dispatch/kanban-dispatch.apply.ts, server/modules/kanban-dispatch/kanban-dispatch.module.ts, server/modules/kanban/kanban-boards.service.ts, server/modules/kanban/kanban-cards.service.ts
// writes: none

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { PNG, gitFolder, mountBoardDispatch, placingRig, quietJournal } from "../lib/board_placing.mjs";

const FOOTER = "Filed by a chat · 2026-11-19 21:00 UTC";

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const rig = await placingRig(t, "placing", {});
  const R = await gitFolder(path.join(rig.folder, "repo-r"));
  const elsewhere = await gitFolder(path.join(rig.folder, "no-board-here"));
  await mkdir(path.join(R, "sub"), { recursive: true });
  const shot = path.join(rig.folder, "red-banner.png");
  await writeFile(shot, PNG);
  // The stand-in's store is seeded now that the folders its tickets name exist.
  const seeded = await rig.state();
  seeded.tickets = [
    { id: 1, source: "chat", path: path.join(R, "sub"), title: "the chat's ticket", description: `the words\n\n${FOOTER}`, priority: "high", shots: [shot], tags: [], lane: "todo", state: "filed" },
    { id: 2, source: "nightly", path: R, title: "the night's ticket", description: "a case broke", priority: "high", shots: [], tags: ["regression", "regression-of:c-old"], lane: "active", state: "filed" },
    { id: 3, source: "soul", path: elsewhere, title: "the soul's stray ticket", description: "no board names it", priority: "low", shots: [], tags: [], lane: "todo", state: "filed" },
    { id: 4, source: "cerberus", path: R, title: "the watch's ticket", description: "red for an hour", priority: "medium", shots: [], tags: [], lane: "todo", state: "filed", failStamps: 1 },
  ];
  await writeFile(path.join(rig.folder, "state.json"), JSON.stringify(seeded));

  quietJournal(t);
  const { kanban } = await rig.open();
  const { kanbanBoardsService: boards, kanbanCardsService: cards, kanbanRosterService: roster } = kanban as any;
  const board = boards.createBoard({ name: "Placing board", repos: [R] });
  if (!board?.id) return cannotRun("the scratch board would not be made");

  const mounted: any = await mountBoardDispatch(t);
  if (mounted.unmounted) return broken(mounted.unmounted);
  await rig.settle();
  mounted.poke();
  await rig.settle();

  const wrong: string[] = [];
  const heard: any[] = await rig.calls();
  const verb = (c: any) => `${c.argv[0]} ${c.argv[1]}`;
  const firstPending = heard.findIndex((c) => verb(c) === "bug pending");
  const firstNotes = heard.findIndex((c) => verb(c) === "card notes");
  if (firstPending < 0) return broken("no pass ran `dispatcher bug pending --json`: the applier places no ticket");
  if (firstNotes >= 0 && firstNotes < firstPending) wrong.push("`card notes` ran before `bug pending`: placing is not the pass's first step");

  const stamps = (id: number) => heard.filter((c) => verb(c) === "bug placed" && c.argv[2] === String(id));
  const parsed = (c: any) => {
    try {
      return JSON.parse(c?.stdin ?? "");
    } catch {
      wrong.push(`a bug placed stamp's stdin is not JSON: ${String(c?.stdin).slice(0, 80)}`);
      return {};
    }
  };
  const live = boards.getBoard(board.id);
  const boardStamp = JSON.stringify({ id: live.id, name: live.name, repos: live.repos, autonomy: live.autonomy });
  const onBoard: any[] = roster.boardCards(board.id);

  const placedCard = (id: number, title: string) => {
    const tries = stamps(id);
    if (tries.length === 0) {
      wrong.push(`ticket ${id} (${title}) was never stamped`);
      return null;
    }
    const last = parsed(tries[tries.length - 1]);
    if (JSON.stringify(last.board) !== boardStamp) wrong.push(`ticket ${id}'s stamp names board ${JSON.stringify(last.board)}, not ${boardStamp}`);
    if (typeof last.card?.id !== "string") {
      wrong.push(`ticket ${id}'s stamp carries no card id: ${JSON.stringify(last)}`);
      return null;
    }
    const keys = Object.keys(last).sort().join(",");
    if (keys !== "board,card") wrong.push(`ticket ${id}'s stamp holds keys ${keys}, not board,card`);
    return cards.getCard(last.card.id);
  };

  const chat = placedCard(1, "the chat's ticket");
  if (chat) {
    if (chat.boardId !== board.id || chat.status !== "todo" || chat.priority !== "high") wrong.push(`the chat's card is on ${chat.boardId} in ${chat.status} at ${chat.priority}, not To Do at high on the board naming R`);
    if (chat.title !== "the chat's ticket" || chat.description !== `the words\n\n${FOOTER}`) wrong.push(`the chat's card reads title ${JSON.stringify(chat.title)}, description ${JSON.stringify(chat.description)}`);
    if ((chat.attachments ?? []).length !== 1) wrong.push(`the chat's card holds ${(chat.attachments ?? []).length} attachments, not its one shot`);
    const chatTags = [...(chat.tags ?? [])].sort().join(",");
    if (chatTags !== "ticket:1") wrong.push(`the chat's card carries tags [${chatTags}], not its ticket's tag ticket:1`);
    const by = cards.createdBy(chat.id);
    if (by !== "chat") wrong.push(`the chat's card was created by ${by}, not chat`);
  }
  const night = placedCard(2, "the night's ticket");
  if (night) {
    if (night.status !== "active" || night.priority !== "high") wrong.push(`the night's card is in ${night.status} at ${night.priority}, not the active lane at high`);
    const tags = [...(night.tags ?? [])].sort().join(",");
    if (tags !== "regression,regression-of:c-old,ticket:2") wrong.push(`the night's card carries tags [${tags}], not regression, regression-of:c-old and its ticket's tag ticket:2`);
    if (cards.createdBy(night.id) !== "nightly") wrong.push(`the night's card was created by ${cards.createdBy(night.id)}, not nightly`);
  }

  const stray = stamps(3);
  if (stray.length === 0) wrong.push("the soul's ticket in a folder no board names was never stamped");
  else if (JSON.stringify(parsed(stray[0])) !== JSON.stringify({ unplaced: `no board names ${elsewhere}` })) wrong.push(`the stray ticket's stamp is ${stray[0].stdin}, not {"unplaced": "no board names ${elsewhere}"}`);
  if (onBoard.some((c) => c.title === "the soul's stray ticket")) wrong.push("the stray ticket became a card on a board that does not name its folder");

  const watchTries = stamps(4);
  if (watchTries.length < 2) wrong.push(`the watch's ticket, whose first stamp failed, was stamped ${watchTries.length} time(s): its owed stamp was never retried`);
  else {
    const ids = new Set(watchTries.map((c) => parsed(c).card?.id));
    if (ids.size !== 1) wrong.push(`the watch's retried stamp names ${ids.size} different cards: the retry made a card again`);
  }
  const watchCards = onBoard.filter((c) => c.title === "the watch's ticket");
  if (watchCards.length !== 1) wrong.push(`the board holds ${watchCards.length} cards for the watch's ticket, not one`);
  else {
    if (cards.createdBy(watchCards[0].id) !== "cerberus") wrong.push(`the watch's card was created by ${cards.createdBy(watchCards[0].id)}, not cerberus`);
    if (!(watchCards[0].tags ?? []).includes("ticket:4")) wrong.push(`the watch's card carries tags [${watchCards[0].tags}], not its ticket's tag ticket:4`);
  }
  if (onBoard.length !== 3) wrong.push(`the board holds ${onBoard.length} cards, not the three placed tickets: ${onBoard.map((c) => c.title).join(" | ")}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`bug pending ran first; three tickets became cards in their lane, priority and source (tags, ticket:<id> tag and shot carried) stamped {board, card}; the stray one stamped unplaced by its folder; the failed stamp retried ${watchTries.length - 1}x on the same card`);
});
