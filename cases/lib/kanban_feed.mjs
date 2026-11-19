// kanban_feed.mjs — the dispatcher's card feed (`DispatcherPicture.cards`) as this page hears it, made up for one case.
//
// Usage (cases/shell/<name>.mjs), after lib/kanban_board.mjs's `openBoard` has routed the board:
//   const feed = await feedCards(page, [walk({ card: CARDS.bug.id, state: "queued", hold: "cards: 1 of 1 walking" })]);
//   await openBoard(page);                       // again: the reload below dropped the view, the routes stand
//   await feed.say([...]);                       // one more dispatcher_state frame, as the dispatcher sends on change
//
// THE FEED REACHES A PAGE TWO WAYS, AND BOTH ARE ANSWERED HERE, so a case reads the cards the board draws whichever
// way the board reads them: the seed (`GET /api/dispatcher/plans`, read once at load and again on a reconnect) and
// the `dispatcher_state` frames on the app's socket. The rest of the picture (plans, arcs, route, daemon) is the
// running server's own, read once through the checks token; only `cards` is this case's. A frame the server sends
// while the case runs has its `cards` replaced by the case's current ones, so a dispatcher that moves mid-case
// cannot take the case's cards off the page.
//
// The socket is handed on whole but for the page's presence report, as lib/app.mjs's own `withPage` hands it on.
// The page is reloaded once, so the seed and the socket are this file's from the first read. Nothing is written.

import { api } from "./app.mjs";
import { CannotRun } from "./case.mjs";
import { BOARD } from "./kanban_board.mjs";

const SEED = /\/api\/dispatcher\/plans(\?|$)/;
const APP_SOCKET = /\/ws(\?|$)/;
const PRESENCE_FRAME = "chat.presence";

/** One card object of the feed, every key `dispatcher-card.reader.ts` reads, on lib/kanban_board.mjs's board. */
export function walk({ board = BOARD.id, card, title = "", state = "walking", flow = "bug", hold = null, cases = [], stages = [] }) {
  return {
    board, card, title, state, flow, part: "whole", sorted_by: "jev", confidence: 0.9, hold, waits_on: null,
    chain_id: `case-chain-${card}`, cases, stages,
  };
}

/** One stage of a card object, the six keys the reader takes. */
export const stage = (name, soul, launchId, status, verdict = null) => ({ name, soul, launch_id: launchId, status, verdict, cost_usd: 0 });

const parse = (frame) => {
  if (typeof frame !== "string") return null;
  try {
    return JSON.parse(frame);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
};

/**
 * Answer the page's feed with `cards`, reload it, and return `say(next)`, which sends one more `dispatcher_state` frame
 * carrying `next`, and `heard()`, how many seeds and sockets this file answered (a case says so when nothing was heard).
 */
export async function feedCards(page, cards) {
  const seed = await api("/api/dispatcher/plans");
  if (seed.status !== 200 || !seed.json || typeof seed.json !== "object") {
    throw new CannotRun(`the running server answered ${seed.status} for the dispatcher's picture — never a finding`);
  }
  let current = cards;
  const sockets = [];
  let seeds = 0;
  const picture = () => ({ ...seed.json, cards: current, at: Date.now() });

  await page.route(SEED, (route) => {
    seeds += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(picture()) });
  });
  await page.routeWebSocket(APP_SOCKET, (socket) => {
    sockets.push(socket);
    const server = socket.connectToServer();
    socket.onMessage((frame) => {
      if (parse(frame)?.type !== PRESENCE_FRAME) server.send(frame);
    });
    server.onMessage((frame) => {
      const event = parse(frame);
      socket.send(event?.kind === "dispatcher_state" ? JSON.stringify({ ...event, cards: current }) : frame);
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  return {
    async say(next) {
      current = next;
      const frame = JSON.stringify({ kind: "dispatcher_state", ...picture() });
      for (const socket of sockets) socket.send(frame);
    },
    heard: () => ({ seeds, sockets: sockets.length }),
  };
}
