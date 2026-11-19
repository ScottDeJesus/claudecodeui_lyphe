// A walk's screenshot is a file on this machine, and kanbanAttachmentsService takes it by its absolute
// path beside the upload: the card lists it under its own file name, as image/png with its size, and the
// stored bytes are the file's. A relative path is refused 400 and a path with no file 404, and neither
// leaves a row.
//
// The database and the attachment root are this case's own scratch folder (KANBAN_ATTACHMENTS_ROOT).
//
// protects: server/modules/kanban/kanban-attachments.service.ts, server/modules/kanban/index.ts
// writes: none

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

// The eight-byte PNG signature and one IHDR chunk: enough for the content sniff, which reads the header.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("0000000d49484452000000010000000108060000001f15c489", "hex"),
]);

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "attach-by-path");
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  process.env.KANBAN_ATTACHMENTS_ROOT = path.join(folder, "attachments");
  const shot = path.join(folder, "before-desktop-board.png");
  await writeFile(shot, PNG);

  const { initializeDatabase } = await import("../../server/modules/database/index.ts");
  await initializeDatabase();
  const kanban: any = await import("../../server/modules/kanban/index.ts");
  const attachments = kanban.kanbanAttachmentsService;
  if (typeof attachments?.addAttachmentFromPath !== "function") {
    return broken("kanbanAttachmentsService has no addAttachmentFromPath beside its upload");
  }

  const board = kanban.kanbanBoardsService.createBoard({ name: "case board" });
  const card = kanban.kanbanCardsService.createCard(board.id, { title: "case card" });
  const wrong: string[] = [];

  const refusedWith = (filePath: string): number | string => {
    try {
      attachments.addAttachmentFromPath(card.id, filePath);
      return "nothing";
    } catch (error: any) {
      return typeof error?.statusCode === "number" ? error.statusCode : String(error?.message ?? error);
    }
  };
  const relative = refusedWith("before-desktop-board.png");
  if (relative !== 400) wrong.push(`a relative path was answered ${relative}, not a 400 refusal`);
  const missing = refusedWith(path.join(folder, "no-such-shot.png"));
  if (missing !== 404) wrong.push(`a path with no file was answered ${missing}, not a 404 refusal`);
  const afterRefusals = kanban.kanbanCardsService.getCard(card.id).attachments.length;
  if (afterRefusals !== 0) wrong.push(`the two refusals left ${afterRefusals} attachment rows`);

  const attached = attachments.addAttachmentFromPath(card.id, shot);
  const listed = kanban.kanbanCardsService.getCard(card.id).attachments as Array<{ id: string; filename: string; mime: string; size: number }>;
  const row = listed.find((item) => item.id === attached?.id);
  if (listed.length !== 1 || !row) {
    wrong.push(`the card lists ${listed.length} attachments after one was taken by path`);
  } else {
    if (row.filename !== "before-desktop-board.png") wrong.push(`it is listed as ${row.filename}`);
    if (row.mime !== "image/png") wrong.push(`it is listed as ${row.mime}`);
    if (row.size !== PNG.length) wrong.push(`it is listed at ${row.size} bytes, not ${PNG.length}`);
    const file = attachments.resolveAttachmentFile(card.id, row.id);
    const stored = file ? await readFile(file.path) : null;
    if (!stored || !stored.equals(PNG)) wrong.push("the stored bytes are not the file's");
    if (file && !file.path.startsWith(process.env.KANBAN_ATTACHMENTS_ROOT)) wrong.push(`the bytes were stored at ${file.path}, outside the attachment root`);
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("a PNG taken by its absolute path is listed under its name as image/png with its size and its stored bytes are the file's; a relative path is 400 and a missing file 404, with no row");
});
