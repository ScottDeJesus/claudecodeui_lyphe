// protects: server/modules/kanban-intake/kanban-intake.routes.ts, server/modules/kanban/routes/board.routes.ts
// writes: none
//
// The board seam B makes (restorly-users-bug-board): Restorly Users, made once through POST /api/kanban/boards by
// list-then-create, no folders, its switch off. eis_backend files every report but the owner's there by its id
// (RESTORLY_USERS_BOARD_ID); a second board of the name, a folder or the switch on would each break that.
// Reads only: the running server's board list with the checks token.

import { api } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

const BOARD_NAME = "Restorly Users";

runCase(async () => {
  const out = await api("/api/kanban/boards");
  if (out.status !== 200) return broken(`GET /api/kanban/boards answered ${out.status}`);
  const boards = Array.isArray(out.json) ? out.json : (out.json?.boards ?? []);
  const live = boards.filter((b) => b.name === BOARD_NAME && !b.archived);
  if (live.length !== 1) return broken(`${live.length} live boards are named ${BOARD_NAME}, not one`);
  const [board] = live;
  const wrong = [];
  if (!Array.isArray(board.repos) || board.repos.length !== 0) wrong.push(`its repos read ${JSON.stringify(board.repos)}, not []`);
  if (board.autonomy !== false) wrong.push(`its switch reads ${JSON.stringify(board.autonomy)}, not off`);
  if (wrong.length) return broken(`${board.id}: ${wrong.join("; ")}`);
  return held(`one live ${BOARD_NAME} board stands (${board.id}), repos [] and its switch off`);
});
