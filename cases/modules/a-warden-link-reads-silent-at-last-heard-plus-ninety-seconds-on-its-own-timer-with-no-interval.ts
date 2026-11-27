// A NODE GOES SILENT AT ITS OWN INSTANT. Each node's record in the link registry (warden-links.ts) holds one deadline
// timer, armed at lastHeardAt + SILENCE_AFTER_MS + 1 whenever the node is heard (heard()) or seeded (seedFromStore()) and
// not silent; its firing tells the listeners the node is silent. No registry-wide interval looks for silence.
//
// Three nodes, each 600 ms short of silence: one heard, one seeded from the store, one heard and then heard again at once.
// Scratch Cerberus and app stores in the case's own folder; nothing of the operator's is read or written.
//
// protects: server/modules/cerberus/warden-links.ts, server/shared/deadline-timer.ts
// writes: none

import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server");
const SILENCE_MS = 90_000;
const LEAD_MS = 89_400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const dir = await scratchDir(t, "warden-silence");
  process.env.DATABASE_PATH = path.join(dir, "auth.db");
  process.env.CERBERUS_DB_PATH = path.join(dir, "cerberus.db");
  const intervals: unknown[] = [];
  const realSetInterval = globalThis.setInterval;
  (globalThis as any).setInterval = (fn: any, ms?: number, ...rest: any[]) => {
    const caller = (new Error().stack ?? "").split("\n")[2] ?? "";
    if (/warden-links|deadline-timer/.test(caller)) intervals.push(ms);
    return realSetInterval(fn, ms, ...rest);
  };
  t.defer(() => {
    (globalThis as any).setInterval = realSetInterval;
  });
  let database: any;
  let wardenLinks: any;
  try {
    database = await import(SERVER + "/modules/database/index.ts");
    await database.initializeDatabase();
    ({ wardenLinks } = await import(SERVER + "/modules/cerberus/warden-links.ts"));
  } catch (error) {
    return cannotRun("the scratch stores or the link registry would not load: " + String((error as Error)?.message ?? error).split("\n")[0]);
  }
  const told: Array<{ node: string; silentSince: number | null; at: number }> = [];
  wardenLinks.onChange((node: string, state: { silentSince: number | null }) => told.push({ node, silentSince: state.silentSince, at: Date.now() }));
  const silentTold = (node: string) => told.filter((x) => x.node === node && x.silentSince !== null);

  const aAt = Date.now() - LEAD_MS;
  wardenLinks.heard("case-a", aAt);
  const bAt = Date.now() - LEAD_MS;
  wardenLinks.heard("case-b", bAt);
  database.cerberusNodesDb.insert({ id: "case-c", desc: null, public_key: "k", cert_fingerprint: "f", warden_version: null, machine_id: null, facts: null, enrolled_at: Date.now() - 3_600_000 });
  const cAt = Date.now() - LEAD_MS;
  database.getCerberusConnection().prepare("UPDATE nodes SET last_heartbeat_at = ? WHERE id = ?").run(cAt, "case-c");
  wardenLinks.seedFromStore();
  await sleep(100);
  wardenLinks.heard("case-b", Date.now());
  await sleep(1900);

  const wrong: string[] = [];
  const saw: string[] = [];
  for (const [node, heardAt, how] of [["case-a", aAt, "heard"], ["case-c", cAt, "seeded"]] as const) {
    const tells = silentTold(node);
    const due = heardAt + SILENCE_MS;
    const state = wardenLinks.states().get(node);
    if (tells.length !== 1) wrong.push("the " + how + " node was told silent " + tells.length + " times within 1.4 s of its last heard + 90 s");
    else {
      if (tells[0].silentSince !== due) wrong.push("the " + how + " node was told silentSince " + tells[0].silentSince + ", not last heard + 90000 (" + due + ")");
      if (tells[0].at < due) wrong.push("the " + how + " node was told silent " + (due - tells[0].at) + " ms before its 90 s ran out");
      saw.push("the " + how + " node told silent " + (tells[0].at - due) + " ms after last heard + 90 s");
    }
    if (state?.silentSince !== due) wrong.push("states() reads the " + how + " node's silentSince " + state?.silentSince + ", not " + due);
  }
  if (silentTold("case-b").length !== 0) wrong.push("the node heard again before its 90 s ran out was told silent");
  if (intervals.length !== 0) wrong.push("setInterval was called " + intervals.length + " time(s), every " + intervals.join(", ") + " ms");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(saw.join("; ") + ", silentSince exactly last heard + 90000; the re-heard node told nothing; no setInterval");
});
