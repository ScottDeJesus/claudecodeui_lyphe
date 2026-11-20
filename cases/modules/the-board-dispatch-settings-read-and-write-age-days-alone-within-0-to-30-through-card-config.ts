// The board-dispatch settings carry the dispatcher's third card number, `ageDays` (charters/cards.toml's `age_days`,
// 0 to 30), beside `width` and `threshold`, and write it through `dispatcher card config --age-days`: GET reads it off
// the file; PUT {ageDays: 7} alone is a whole request, 200, read back as 7 and written to the file with the other two
// numbers left as they were; 31, -1 and 2.5 are the caller's mistake, 400, and the file is untouched; a later PUT of
// the width alone keeps the 7 (bug-board-ways-in-and-dashboard, seam 9).
//
// The router `createKanbanDispatchModule` builds, mounted on a loopback port as the server mounts it, over a scratch
// cards.toml the real dispatcher is pointed at (CARDS_CONFIG_PATH, carried to the child in the module's environment).
// The house's own cards.toml is never read or written.
//
// protects: server/modules/kanban-dispatch/kanban-dispatch.routes.ts, server/modules/kanban-dispatch/kanban-dispatch.module.ts, /home/lyphe/.claude/hooks/dispatcher/card_config.py, /home/lyphe/.claude/hooks/dispatcher/cmd/card.py
// writes: none

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

type Answer = { status: number; json: any };

const START = "width = 1\nthreshold = 0.8\nage_days = 3\n";

/** The three numbers the file holds now, as the dispatcher writes them. */
function fileNumbers(file: string): { width: number; threshold: number; ageDays: number } {
  const text = readFileSync(file, "utf8");
  const read = (key: string) => Number((text.match(new RegExp(`^${key}\\s*=\\s*([0-9.]+)`, "m")) ?? [])[1]);
  return { width: read("width"), threshold: read("threshold"), ageDays: read("age_days") };
}

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "settings-age-days");
  const cards = path.join(folder, "cards.toml");
  writeFileSync(cards, START);
  process.env.CARDS_CONFIG_PATH = cards;
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  process.env.KANBAN_ATTACHMENTS_ROOT = path.join(folder, "attachments");
  const { initializeDatabase } = await import("../../server/modules/database/index.ts");
  await initializeDatabase();
  const { createKanbanDispatchModule } = await import("../../server/modules/kanban-dispatch/index.ts");
  const express = (await import("express")).default;

  const module = createKanbanDispatchModule({ attach: () => () => {} } as any);
  t.defer(() => module.stop());
  const app = express();
  app.use(express.json());
  app.use("/api/kanban-dispatch", module.router);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.defer(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address() as { port: number };

  const call = async (method: string, body?: unknown): Promise<Answer> => {
    const response = await fetch(`http://127.0.0.1:${port}/api/kanban-dispatch/settings`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const text = await response.text();
    try {
      return { status: response.status, json: JSON.parse(text) };
    } catch {
      return { status: response.status, json: null };
    }
  };

  const wrong: string[] = [];
  const first = await call("GET");
  if (first.status !== 200 || first.json?.ageDays !== 3 || first.json?.width !== 1 || first.json?.threshold !== 0.8) {
    wrong.push(`GET over age_days 3 answered ${first.status} ${JSON.stringify(first.json)}`);
  }

  const seven = await call("PUT", { ageDays: 7 });
  const afterSeven = fileNumbers(cards);
  if (seven.status !== 200 || seven.json?.ageDays !== 7) wrong.push(`PUT {ageDays: 7} answered ${seven.status} ${JSON.stringify(seven.json)}`);
  if (afterSeven.ageDays !== 7 || afterSeven.width !== 1 || afterSeven.threshold !== 0.8) {
    wrong.push(`after PUT {ageDays: 7} the file holds ${JSON.stringify(afterSeven)}`);
  }

  for (const bad of [31, -1, 2.5]) {
    const refused = await call("PUT", { ageDays: bad });
    const now = fileNumbers(cards);
    if (refused.status !== 400) wrong.push(`PUT {ageDays: ${bad}} answered ${refused.status}, not 400`);
    if (now.ageDays !== afterSeven.ageDays) wrong.push(`PUT {ageDays: ${bad}} moved the file to age_days ${now.ageDays}`);
  }

  const width = await call("PUT", { width: 2 });
  const read = await call("GET");
  if (width.status !== 200 || width.json?.ageDays !== 7 || read.json?.ageDays !== 7 || read.json?.width !== 2) {
    wrong.push(`PUT {width: 2} answered ${width.status} ${JSON.stringify(width.json)}, then GET ${JSON.stringify(read.json)}`);
  }

  if (wrong.length > 0) return broken(wrong.join("; ").slice(0, 390));
  return held("GET read ageDays 3; PUT {ageDays: 7} alone wrote age_days 7 and nothing else; 31, -1 and 2.5 were 400 and wrote nothing; a width alone kept 7");
});
