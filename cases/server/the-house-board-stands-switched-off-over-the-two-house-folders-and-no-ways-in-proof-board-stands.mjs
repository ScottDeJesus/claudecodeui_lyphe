// protects: server/modules/kanban/routes/board.routes.ts, server/modules/kanban/kanban-boards.service.ts
// writes: none
//
// The board the house's own tickets land on: a board named House, made once through POST /api/kanban/boards over the
// house's folders (/home/lyphe/.claude and this repo), its switch off, is kept. The proof board made beside it to walk
// one ticket end to end (Ways in proof, the same two folders, its switch on) is archived once the proof is shown, so it
// never outbids House for a ticket filed in those folders (boardForPath prefers a board that runs itself on a tie).
//
// Reads only: the running server's board list with the checks token.

import { api } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

const ROUTE = "/api/kanban/boards?includeArchived=1";
const HOUSE_FOLDERS = ["/home/lyphe/.claude", "/home/lyphe/.claude/claudecodeui_lyphe"];

runCase(async () => {
  const out = await api(ROUTE);
  if (out.status !== 200) return broken(`GET ${ROUTE} answered ${out.status}`);
  const boards = Array.isArray(out.json) ? out.json : (out.json?.boards ?? []);
  const wrong = [];

  const houses = boards.filter((b) => b.name === "House" && !b.archived);
  if (houses.length !== 1) {
    wrong.push(`${houses.length} boards named House stand, not one`);
  } else {
    const [house] = houses;
    if (house.autonomy !== false) wrong.push(`House's switch reads ${JSON.stringify(house.autonomy)}, not off`);
    const folders = [...(house.repos ?? [])].sort();
    if (JSON.stringify(folders) !== JSON.stringify([...HOUSE_FOLDERS].sort())) {
      wrong.push(`House names the folders ${JSON.stringify(house.repos)}, not ${JSON.stringify(HOUSE_FOLDERS)}`);
    }
  }

  const proofs = boards.filter((b) => b.name === "Ways in proof" && !b.archived);
  if (proofs.length) wrong.push(`${proofs.length} board(s) named Ways in proof still stand (${proofs.map((b) => b.id).join(", ")})`);

  if (wrong.length) return broken(wrong.join("; "));
  return held("one House board stands, switched off over the two house folders, and no Ways in proof board stands");
});
