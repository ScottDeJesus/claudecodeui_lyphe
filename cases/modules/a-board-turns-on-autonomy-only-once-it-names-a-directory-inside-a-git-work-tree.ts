// A board runs itself only once it names where its cards are built: PATCH /api/kanban/boards/:id with
// autonomy true is 409 KANBAN_BOARD_NEEDS_REPOS while the board names no repository, every repos entry
// must be an absolute path of a directory inside a git work tree (else 400), and once one is named the
// same PATCH is 200.
//
// The real board router runs on a loopback port over a database this case creates in its own scratch
// folder, mounted without createKanbanModule (whose lesson-spill sweep reads the live spill folder). Its
// error handler answers an AppError the way server/index.ts's global handler does: its status, and
// { error: { code } }. The git work tree named is this suite's own repo; the non-git directory is scratch.
//
// protects: server/modules/kanban/kanban-boards.service.ts, server/modules/kanban/kanban-board-repos.ts, server/modules/kanban/routes/board.routes.ts, server/modules/database/repositories/kanban-boards.db.ts, server/modules/database/kanban-schema.ts, server/modules/database/migrations-board-dispatch.ts
// writes: none

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url)); // this file is <repo>/cases/modules/<name>.ts

type Answer = { status: number; json: any };

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "board-repos");
  // Set before the database module loads: it opens the file this names and no other.
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  process.env.KANBAN_ATTACHMENTS_ROOT = path.join(folder, "attachments");
  const notGit = path.join(folder, "not-a-repo");
  await mkdir(notGit);

  const { initializeDatabase } = await import("../../server/modules/database/index.ts");
  await initializeDatabase();
  const kanban: any = await import("../../server/modules/kanban/index.ts");
  const { createKanbanRouter } = await import("../../server/modules/kanban/routes/kanban.routes.ts");
  const express = (await import("express")).default;

  const app = express();
  app.use(express.json());
  app.use(
    "/api/kanban",
    createKanbanRouter({
      boards: kanban.kanbanBoardsService,
      cards: kanban.kanbanCardsService,
      questions: kanban.kanbanQuestionsService,
      checklist: kanban.kanbanChecklistService,
      attachments: kanban.kanbanAttachmentsService,
      leases: kanban.kanbanLeasesService,
      lessons: kanban.kanbanLessonsService,
      memoryPending: () => 0,
    } as any)
  );
  app.use((error: any, _request: any, response: any, _next: any) => {
    const status = typeof error?.statusCode === "number" ? error.statusCode : 500;
    response.status(status).json({ error: { code: error?.code ?? "UNKNOWN", message: String(error?.message ?? error) } });
  });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.defer(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address() as { port: number };

  const call = async (method: string, route: string, body: unknown): Promise<Answer> => {
    const answer = await fetch(`http://127.0.0.1:${port}/api/kanban${route}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await answer.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: answer.status, json };
  };

  const created = await call("POST", "/boards", { name: "case board" });
  const board = created.json?.board ?? created.json;
  if (created.status >= 300 || typeof board?.id !== "string") {
    return broken(`POST /boards answered ${created.status}, with no board id`);
  }
  const wrong: string[] = [];
  if (!Array.isArray(board.repos) || board.repos.length !== 0) {
    wrong.push(`a new board read repos ${JSON.stringify(board.repos)}, not []`);
  }
  const patch = (body: unknown) => call("PATCH", `/boards/${board.id}`, body);

  const noRepos = await patch({ autonomy: true });
  if (noRepos.status !== 409 || noRepos.json?.error?.code !== "KANBAN_BOARD_NEEDS_REPOS") {
    wrong.push(`autonomy on with no repos answered ${noRepos.status} ${noRepos.json?.error?.code ?? ""}, not 409 KANBAN_BOARD_NEEDS_REPOS`);
  }

  const refused: Array<[string, unknown]> = [
    ["a relative path", ["cases/modules"]],
    ["a directory outside any git work tree", [notGit]],
    ["a path with nothing at it", [path.join(folder, "nothing-here")]],
    ["a bare string", REPO],
  ];
  for (const [what, repos] of refused) {
    const answer = await patch({ repos });
    if (answer.status !== 400) wrong.push(`repos naming ${what} answered ${answer.status}, not 400`);
  }
  const still = kanban.kanbanBoardsService.getBoard(board.id);
  if (still?.autonomy !== false || (still?.repos ?? []).length !== 0) {
    wrong.push(`after the refusals the board read autonomy ${still?.autonomy} and repos ${JSON.stringify(still?.repos)}`);
  }

  const inside = path.join(REPO, "server");
  const named = await patch({ repos: [inside] });
  const namedRepos: unknown = (named.json?.board ?? named.json)?.repos;
  if (named.status !== 200 || !Array.isArray(namedRepos) || !namedRepos.includes(inside)) {
    wrong.push(`repos naming ${inside} answered ${named.status} with repos ${JSON.stringify(namedRepos)}`);
  }

  const on = await patch({ autonomy: true });
  if (on.status !== 200 || (on.json?.board ?? on.json)?.autonomy !== true) {
    wrong.push(`autonomy on after naming a repo answered ${on.status} ${on.json?.error?.code ?? ""}`);
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("no repos: 409 KANBAN_BOARD_NEEDS_REPOS; relative, non-git, missing and bare-string repos: 400; a directory inside a git work tree: 200, then autonomy on: 200");
});
