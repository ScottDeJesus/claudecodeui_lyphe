// scheduled_messages_house.mjs — the scheduled-messages module run over a scratch app database.
//
//   import { scheduledHouse, SERVER, sleep, sleepUntil } from "../lib/scheduled_messages_house.mjs";
//   const h = await scheduledHouse(t, "sched-next");   // scratch auth.db with one user: h.db, h.conn, h.userId,
//                                                      // h.session(id), h.logs, h.attempts(), h.runtime
//
// DATABASE_PATH (and the Cerberus store's path) point into the case's scratch folder before any server module loads,
// so nothing of the operator's database is read or written. h.runtime is a provider gateway that refuses every call,
// so a turn the dispatcher starts never reaches a provider: it ends as a failed or a not-started send, which the
// dispatcher logs. h.attempts() is those log lines for queued turns ("[ScheduledMessages] Queued turn …").
// Console lines are kept in h.logs and still printed as they were.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { scratchDir } from "./scratch.mjs";

export const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sleepUntil = (at) => sleep(Math.max(0, at - Date.now()));
export const firstLine = (error) => String(error?.message ?? error).split("\n")[0];

const said = (x) => {
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
};

export async function scheduledHouse(t, label) {
  const dir = await scratchDir(t, label);
  process.env.DATABASE_PATH = path.join(dir, "auth.db");
  process.env.CERBERUS_DB_PATH = path.join(dir, "cerberus.db");
  const logs = [];
  for (const m of ["log", "info", "warn", "error"]) {
    const real = console[m].bind(console);
    console[m] = (...a) => {
      logs.push(a.map(said).join(" "));
      real(...a);
    };
  }
  const db = await import(SERVER + "/modules/database/index.ts");
  await db.initializeDatabase();
  const conn = db.getConnection();
  const userId = Number(conn.prepare("INSERT INTO users (username, password_hash) VALUES (?, 'case')").run("case-" + label).lastInsertRowid);
  const session = (id) => {
    try {
      conn.prepare("INSERT OR IGNORE INTO projects (project_id, project_path) VALUES (?, ?)").run("case-" + label, dir);
    } catch {
      // a store with no projects table needs no project row
    }
    conn
      .prepare("INSERT INTO sessions (session_id, provider, project_path, custom_name, isArchived, created_at, updated_at) VALUES (?, 'claude', ?, 'case', 0, datetime('now'), datetime('now'))")
      .run(id, dir);
    return id;
  };
  const refused = [];
  const runtime = new Proxy({}, {
    get(_target, key) {
      if (key === "then" || typeof key === "symbol") return undefined;
      return () => {
        refused.push(String(key));
        throw new Error("the case's runtime refuses " + String(key));
      };
    },
  });
  const attempts = () => logs.filter((l) => l.includes("[ScheduledMessages] Queued turn"));
  return { dir, db, conn, userId, session, logs, attempts, runtime, refused };
}
