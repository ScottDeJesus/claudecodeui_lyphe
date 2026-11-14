// An approved To-do ticket that Metis files an issue against through the kanban-pm file_issue tool is
// no longer offered in list_actionable's buildable bucket: an issue sends it back for re-planning or to
// the operator, never straight to the next session's build.
//
// The real file_issue and list_actionable handlers run against the real board router, mounted at the
// kanban-pm door on a loopback port over a database this case creates in its own scratch folder. The
// router is mounted without createKanbanModule, whose lesson-spill sweep reads the live spill folder.
//
// protects: server/modules/kanban-metis/mcp/kanban-pm-tools-detail.ts, server/modules/kanban-metis/mcp/kanban-pm-projections.ts, server/modules/kanban-metis/brief/METIS.md
// writes: none

import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "file-issue-queue");
  // Set before the database module loads: it opens the file this names and no other.
  process.env.DATABASE_PATH = path.join(folder, "auth.db");

  const { initializeDatabase } = await import("../../server/modules/database/index.ts");
  await initializeDatabase();
  const kanban = await import("../../server/modules/kanban/index.ts");
  const { createKanbanRouter } = await import("../../server/modules/kanban/routes/kanban.routes.ts");
  const { createKanbanPmClient } = await import("../../server/modules/kanban-metis/mcp/kanban-pm-client.ts");
  const { createDetailTools } = await import("../../server/modules/kanban-metis/mcp/kanban-pm-tools-detail.ts");
  const { createBoardTools } = await import("../../server/modules/kanban-metis/mcp/kanban-pm-tools-board.ts");
  const express = (await import("express")).default;

  const board = kanban.kanbanBoardsService.createBoard({ name: "case board" });
  const card = kanban.kanbanCardsService.createCard(board.id, {
    title: "case ticket",
    priority: "high",
    status: "todo",
    description: "a bug the operator queued and approved",
  });
  kanban.kanbanQuestionsService.approveCard(card.id);
  // The session's claim: BUILD step b moves the card to active before the chain runs.
  kanban.kanbanCardsService.moveCard(card.id, { status: "active" });

  const app = express();
  app.use(express.json());
  app.use(
    "/api/kanban-pm",
    createKanbanRouter({
      boards: kanban.kanbanBoardsService,
      cards: kanban.kanbanCardsService,
      questions: kanban.kanbanQuestionsService,
      checklist: kanban.kanbanChecklistService,
      attachments: kanban.kanbanAttachmentsService,
      leases: kanban.kanbanLeasesService,
      lessons: kanban.kanbanLessonsService,
      memoryPending: () => 0,
    })
  );
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.defer(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address() as { port: number };

  const client = createKanbanPmClient({
    apiUrl: `http://127.0.0.1:${port}`,
    token: "case",
    boardId: board.id,
    owner: "0123456789abcdef",
  });

  // BUILD step e: the chain landed blocked, so Metis files the block reason.
  await createDetailTools(client).handlers.file_issue({ id: card.id, text: "blocked: case" });

  const answer = await createBoardTools(client).handlers.list_actionable({});
  const queue = JSON.parse(answer.content[0].text) as Record<string, Array<{ id: string; approved: boolean }>>;
  const bucket = ["to_plan", "buildable", "awaiting_you", "active"].find((name) =>
    (queue[name] ?? []).some((row) => row.id === card.id)
  );
  const row = (queue[bucket ?? "buildable"] ?? []).find((r) => r.id === card.id);

  if (bucket === "buildable") {
    return broken(
      `after file_issue the ticket is still approved (${row?.approved}) and list_actionable offers it in buildable, ` +
        "so the next session claims it again"
    );
  }
  return held(`after file_issue the ticket sits in ${bucket ?? "no bucket"}, not in buildable`);
});
