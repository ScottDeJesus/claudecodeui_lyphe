// The dashboard's two house parts are each their own door's, and a door that does not answer blanks only its own
// part: GET /dashboard?board=all&days=30 on the router `createKanbanDispatchModule` builds answers 200 either way.
// With the cases door's binary (CASES_BIN, composed as the roadmap module composes it) naming no file, `cases` is
// { ok: false, error: <the thrown sentence> } while `stats`, `changelog` and `tickets` ({ ok: true }) still answer;
// with the dispatcher's binary (DISPATCHER_BIN) naming no file, `tickets` is { ok: false, error } while `cases`
// ({ ok: true }), `stats` and `changelog` still answer (bug-board-ways-in-and-dashboard, seam 9).
//
// The module is built twice over a scratch board database, each time with its environment set first, and its router is
// mounted on a loopback port as the server mounts it. The applier is never started, so nothing is placed or applied;
// the doors that do answer are the house's own, read only.
//
// protects: server/modules/kanban-dispatch/kanban-dispatch.dashboard.ts, server/modules/kanban-dispatch/kanban-dispatch.routes.ts, server/modules/kanban-dispatch/kanban-dispatch.module.ts, server/shared/dispatcher-command.ts
// writes: none

import os from "node:os";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

type Part = { ok: boolean; value?: unknown; error?: unknown };
type Answer = { status: number; json: any };

const SCRIPTS = path.join(os.homedir(), ".claude", "scripts");
const ROUTE = "/api/kanban-dispatch/dashboard?board=all&days=30";

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "dashboard-doors");
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  process.env.KANBAN_ATTACHMENTS_ROOT = path.join(folder, "attachments");
  const { initializeDatabase } = await import("../../server/modules/database/index.ts");
  await initializeDatabase();
  const { createKanbanDispatchModule } = await import("../../server/modules/kanban-dispatch/index.ts");
  const express = (await import("express")).default;
  const storeWatch: any = { attach: () => () => {} };

  /** Build the module with `env` set, mount its router, ask the dashboard once, and take it all down again. */
  const ask = async (env: Record<string, string>): Promise<Answer> => {
    const saved: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(env)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    const module = createKanbanDispatchModule(storeWatch);
    const app = express();
    app.use(express.json());
    app.use("/api/kanban-dispatch", module.router);
    app.use((error: any, _request: any, response: any, _next: any) => {
      response.status(typeof error?.statusCode === "number" ? error.statusCode : 500).json({ error: String(error?.message ?? error) });
    });
    const server = await new Promise<import("node:http").Server>((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    try {
      const { port } = server.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${port}${ROUTE}`, { signal: AbortSignal.timeout(60000) });
      const text = await response.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { status: response.status, json };
    } finally {
      await new Promise((resolve) => server.close(resolve));
      module.stop();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };

  const refused = (part: Part | undefined): boolean => part?.ok === false && typeof part.error === "string" && part.error.trim().length > 0;
  const answered = (part: Part | undefined): boolean => part?.ok === true && part.value !== null && typeof part.value === "object";
  const boardStands = (json: any): boolean => typeof json?.stats?.open?.total === "number" && Array.isArray(json?.changelog);
  const said = (json: any): string => JSON.stringify({ stats: json?.stats ? "…" : json?.stats, changelog: Array.isArray(json?.changelog) ? "[…]" : json?.changelog, cases: json?.cases, tickets: json?.tickets }).slice(0, 180);

  const wrong: string[] = [];
  const noCases = await ask({ CASES_BIN: path.join(folder, "no-such-cases"), DISPATCHER_BIN: path.join(SCRIPTS, "dispatcher") });
  if (noCases.status !== 200) wrong.push(`with no cases door the route answered ${noCases.status} ${JSON.stringify(noCases.json)?.slice(0, 120)}`);
  else if (!refused(noCases.json.cases) || !answered(noCases.json.tickets) || !boardStands(noCases.json)) {
    wrong.push(`with no cases door the answer was ${said(noCases.json)}`);
  }

  const noDispatcher = await ask({ CASES_BIN: path.join(SCRIPTS, "cases"), DISPATCHER_BIN: path.join(folder, "no-such-dispatcher") });
  if (noDispatcher.status !== 200) wrong.push(`with no dispatcher the route answered ${noDispatcher.status} ${JSON.stringify(noDispatcher.json)?.slice(0, 120)}`);
  else if (!refused(noDispatcher.json.tickets) || !answered(noDispatcher.json.cases) || !boardStands(noDispatcher.json)) {
    wrong.push(`with no dispatcher the answer was ${said(noDispatcher.json)}`);
  }

  if (wrong.length > 0) return broken(wrong.join("; ").slice(0, 390));
  return held(`no cases door: cases says "${String(noCases.json.cases.error).slice(0, 70)}", the rest answer; no dispatcher: tickets says "${String(noDispatcher.json.tickets.error).slice(0, 70)}", the rest answer`);
});
