// A repos entry the server cannot even stat is the caller's bad path, not the server's fault: PATCH
// /api/kanban/boards/:id with repos naming a path holding a NUL byte, a path longer than the system allows
// (ENAMETOOLONG), or a path under a directory the server may not read (EACCES) answers 400
// KANBAN_BOARD_REPO_INVALID, as every other path that is not a git work tree does, and the board keeps
// repos []. Found 2026-11-18: each of the three answered 500 INTERNAL_ERROR, because the stat's catch in
// kanban-board-repos.ts turned only ENOENT and ENOTDIR into the 400.
//
// The real board router on a loopback port over a scratch database, mounted as the sibling case
// a-board-turns-on-autonomy-only-once-it-names-a-directory-inside-a-git-work-tree mounts it. The unreadable
// directory is a scratch folder set to mode 000; run as root it would be readable, so that one entry is
// skipped (and said) when the process is root.
//
// protects: server/modules/kanban/kanban-board-repos.ts
// writes: none

import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

type Answer = { status: number; json: any };

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "board-repos-unreadable");
  // Set before the database module loads: it opens the file this names and no other.
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  process.env.KANBAN_ATTACHMENTS_ROOT = path.join(folder, "attachments");

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

  const locked = path.join(folder, "locked");
  await mkdir(locked);
  await chmod(locked, 0o000);
  t.defer(() => chmod(locked, 0o700));
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;

  const paths: Array<[string, string]> = [
    ["a path holding a NUL byte", path.join(folder, "a\u0000b")],
    ["a path longer than the system allows", "/" + "a".repeat(300)],
  ];
  if (!asRoot) paths.push(["a path under a directory the server may not read", path.join(locked, "inside")]);

  const wrong: string[] = [];
  for (const [what, repo] of paths) {
    const answer = await call("PATCH", `/boards/${board.id}`, { repos: [repo] });
    const code = answer.json?.error?.code ?? "";
    if (answer.status !== 400 || code !== "KANBAN_BOARD_REPO_INVALID") {
      wrong.push(`repos naming ${what} answered ${answer.status} ${code}, not 400 KANBAN_BOARD_REPO_INVALID`);
    }
  }
  const still = kanban.kanbanBoardsService.getBoard(board.id);
  if ((still?.repos ?? []).length !== 0) wrong.push(`after the refusals the board read repos ${JSON.stringify(still?.repos)}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`NUL byte, over-long${asRoot ? "" : " and unreadable"} repo paths each answered 400 KANBAN_BOARD_REPO_INVALID; repos stayed []${asRoot ? " (unreadable skipped: running as root)" : ""}`);
});
