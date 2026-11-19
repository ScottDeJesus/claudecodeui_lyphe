// The board a defect in a folder belongs to: kanbanBoardsService.boardForPath(path) answers, among boards not
// archived, the one whose repos hold the longest folder that is the path or contains it; on a tie the board that
// runs itself, then the oldest; no board at all is null. A folder matches by whole path components, so a board
// naming R/sub never takes R/subway/y.
//
// Boards over a scratch git work tree R (R, R/sub, R/subway, R/sub/deep are folders in it): board "root" names R;
// "sub old" (made first, switched off) and "sub runs" (made after, switched on) both name R/sub; "subway" names
// R/subway; "deep archived" names R/sub/deep and is archived. The database is the case's own scratch file.
//
// protects: server/modules/kanban/kanban-boards.service.ts, server/modules/kanban/kanban-board-repos.ts, server/modules/database/repositories/kanban-boards.db.ts
// writes: none

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "board-for-path");
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  process.env.KANBAN_ATTACHMENTS_ROOT = path.join(folder, "attachments");
  const R = path.join(folder, "R");
  for (const sub of ["sub/deep/x", "subway/y", "other"]) mkdirSync(path.join(R, sub), { recursive: true });
  execFileSync("git", ["init", "-q", R]);
  const outside = path.join(folder, "elsewhere");
  mkdirSync(outside);

  const { initializeDatabase } = await import("../../server/modules/database/index.ts");
  await initializeDatabase();
  const kanban: any = await import("../../server/modules/kanban/index.ts");
  const boards = kanban.kanbanBoardsService;
  if (typeof boards.boardForPath !== "function") return broken("kanbanBoardsService has no boardForPath");

  const make = async (name: string, repos: string[]) => {
    const b = boards.createBoard({ name, repos });
    await pause(15); // created_at is what "oldest" reads; two boards never share a millisecond here
    return b;
  };
  const root = await make("root", [R]);
  const subOld = await make("sub old", [path.join(R, "sub")]);
  const subRuns = await make("sub runs", [path.join(R, "sub")]);
  const subway = await make("subway", [path.join(R, "subway")]);
  const deep = await make("deep archived", [path.join(R, "sub", "deep")]);
  boards.updateBoard(subRuns.id, { autonomy: true });
  boards.updateBoard(deep.id, { archived: true });

  const wrong: string[] = [];
  const nameOf = (b: any) => (b ? b.name : "null");
  const expect = (p: string, want: any, why: string) => {
    const got = boards.boardForPath(p);
    if ((got?.id ?? null) !== (want?.id ?? null)) wrong.push(`${path.relative(folder, p) || p} picked ${nameOf(got)}, not ${nameOf(want)} (${why})`);
  };

  expect(path.join(R, "sub", "deep", "x"), subRuns, "the archived deeper board is never picked; of the R/sub tie the one running itself");
  expect(path.join(R, "sub"), subRuns, "the folder itself; the tie goes to the board running itself");
  expect(path.join(R, "subway", "y"), subway, "R/sub is not a folder holding R/subway");
  expect(path.join(R, "other"), root, "only R holds it");
  expect(R, root, "the folder itself");
  expect(outside, null, "no board names a folder holding it");

  boards.updateBoard(subRuns.id, { autonomy: false });
  expect(path.join(R, "sub", "deep", "x"), subOld, "with neither switched on, the older board");

  if (wrong.length > 0) return broken(wrong.join("; ").slice(0, 380));
  return held("longest folder wins; the archived deeper board is skipped; R/subway never matches R/sub; a tie goes to the self-running board, then the oldest; a folder no board holds is null");
});
