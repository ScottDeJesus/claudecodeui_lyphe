// gemini_meter.mjs — CloudCLI's own Gemini meter (server/modules/gemini-meter/) over a scratch database, for cases/modules/.
//
//   import { meterGround, addUser, meterDoor, todayUtc, shapeOf, FEATURES, FEATURE_ROW_KEYS } from "../lib/gemini_meter.mjs";
//   const ground = await meterGround(t, "label");   // scratch auth.db named by DATABASE_PATH before any database module loads,
//                                                     // initializeDatabase run: { folder, database, db, meter, missing }
//   ground.meter                                      // the module's barrel (index.ts), or null with ground.missing saying why
//   const id = addUser(ground.db, "case-a");          // one users row, each NOT NULL column with no default filled
//   const door = await meterDoor(t, ground);          // the module's router on a loopback express app, or null when the barrel builds none
//   const answer = await door("GET", "/usage?range=today", id);   // { status, json, text }, signed in as id
//
// NOTHING REAL IS OPENED. The database is the case's scratch file; the router is served on 127.0.0.1 at a port the
// system picks, behind a stand-in for authenticateToken that signs each request in as the id the call names, and is
// closed when the case ends. createGeminiMeterModule is handed a heldKeysOf that answers no held key. No route of the
// module calls a model, so nothing here reaches Google.

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { scratchDir } from "./scratch.mjs";

const SERVER = "../../server/modules";
const firstLine = (error) => String(error?.message ?? error).split("\n")[0];

/** The three CloudCLI features, the design's GeminiFeature union. */
export const FEATURES = ["companion_speech", "read_aloud", "backup_transcription"];
/** The shared feature row, one shape at both doors (the design's ONE ROW SHAPE). */
export const FEATURE_ROW_KEYS = ["feature", "label", "enabled", "calls", "failures", "unmeasured_calls", "input_tokens", "output_tokens", "cost_usd", "models", "last_at"];
/** The shared key row. */
export const KEY_ROW_KEYS = ["key", "held_as", "calls", "cost_usd"];

/** Today as a UTC date, the meter's day. */
export const todayUtc = () => new Date().toISOString().slice(0, 10);

/** A row's keys, sorted and joined, to compare with a design shape. */
export const shapeOf = (row) => Object.keys(row ?? {}).sort().join(",");

/** A scratch database, booted, and the meter's barrel loaded over it. */
export async function meterGround(t, label) {
  const folder = await scratchDir(t, label);
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  await writeFile(process.env.DATABASE_PATH, "");
  const database = await import(SERVER + "/database/index.ts");
  await database.initializeDatabase();
  const db = database.getConnection();
  let meter = null;
  let missing = null;
  try {
    meter = await import(SERVER + "/gemini-meter/index.ts");
  } catch (error) {
    missing = "server/modules/gemini-meter/index.ts would not load — " + firstLine(error);
  }
  return { folder, database, db, meter, missing };
}

/** One account row on the scratch database; answers its id. */
export function addUser(db, name) {
  const names = [];
  const values = [];
  for (const column of db.prepare("PRAGMA table_info(users)").all()) {
    if (column.pk) continue;
    if (column.name === "username") {
      names.push(column.name);
      values.push(name);
    } else if (column.notnull && column.dflt_value === null) {
      names.push(column.name);
      values.push(/INT|REAL|NUM|BOOL/i.test(column.type) ? 0 : name + "-" + column.name);
    }
  }
  const sql = "INSERT INTO users (" + names.map((n) => '"' + n + '"').join(", ") + ") VALUES (" + names.map(() => "?").join(", ") + ")";
  return Number(db.prepare(sql).run(...values).lastInsertRowid);
}

/** The module's router on a loopback express app; null when the barrel builds no router. */
export async function meterDoor(t, ground) {
  if (!ground.meter) return null;
  const { default: express } = await import("express");
  const maker = Object.entries(ground.meter).find(([name, value]) => typeof value === "function" && /^create\w*Module$/.test(name));
  // The module is handed the voice module's reader of an account's held keys; here it holds none, so every key row
  // a case reads comes from the calls the case recorded.
  const built = maker ? await maker[1]({ heldKeysOf: () => [] }) : ground.meter;
  const router = typeof built === "function" ? built : (built?.router ?? built?.userRouter ?? null);
  if (typeof router !== "function") return null;
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    const id = Number(request.get("x-case-user"));
    request.user = { id, userId: id, username: "case-" + id };
    next();
  });
  app.use("/api/gemini-meter", router);
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    listening.on("error", reject);
  });
  t.defer(() => new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  }));
  const origin = "http://127.0.0.1:" + server.address().port + "/api/gemini-meter";
  return async (method, route, id, body) => {
    const headers = { "x-case-user": String(id) };
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(origin + route, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
  };
}
