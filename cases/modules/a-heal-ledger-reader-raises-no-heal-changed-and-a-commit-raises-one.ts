// protects: server/modules/heal/heal.module.ts, server/shared/file-lane.service.ts, server/shared/paced-hint.service.ts, server/shared/directory-watch.service.ts, server/modules/websocket/services/websocket-state.service.ts
// writes: none
// The Heal screen reads again on heal_changed instead of every minute, so the server must say it when the reflex's
// ledger commits, and must NOT say it when a reader merely opens the ledger: in WAL mode every connection creates
// friction.db-wal and the last one removes it, and only a commit changes it. The ledger here is a scratch WAL-mode
// database at HEAL_LEDGER_PATH (the live one is never touched); the socket is a stand-in in the real registry.

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const dir: string = await scratchDir(t, "heal-ledger-hint");
  const ledger = path.join(dir, "friction.db");
  const Database = (await import("better-sqlite3")).default;
  const seed = new Database(ledger);
  seed.pragma("journal_mode = WAL");
  seed.exec("create table friction (id integer primary key, what text)");
  seed.prepare("insert into friction (what) values (?)").run("seed");
  seed.close();
  await sleep(200);

  process.env.HEAL_LEDGER_PATH = ledger;
  process.env.HEAL_REFLEX_BIN = path.join(dir, "no-heal-reflex");
  process.env.DATABASE_PATH = path.join(dir, "auth.db");

  const state: any = await import("../../server/modules/websocket/services/websocket-state.service.ts");
  const heard: Array<{ frame: any; at: number }> = [];
  const socket = {
    readyState: state.WS_OPEN_STATE,
    send: (text: string) => {
      try {
        const frame = JSON.parse(text);
        if (frame?.kind === "heal_changed") heard.push({ frame, at: Date.now() });
      } catch { /* not a frame this case reads */ }
    },
  };
  state.connectedClients.add(socket);
  t.defer(() => state.connectedClients.delete(socket));

  const { createHealModule } = await import("../../server/modules/heal/heal.module.ts");
  createHealModule();
  await sleep(300);

  let walSeen = 0;
  for (let i = 0; i < 2; i += 1) {
    const reader = new Database(ledger);
    reader.prepare("select count(*) as n from friction").get();
    if (fs.existsSync(`${ledger}-wal`)) walSeen += 1;
    reader.close();
    await sleep(200);
  }
  await sleep(1500);
  if (heard.length > 0) return broken(`two readers sent ${heard.length} heal_changed (the WAL was there during ${walSeen} of 2 reads)`);

  const start = Date.now();
  const writer = new Database(ledger);
  writer.prepare("insert into friction (what) values (?)").run("case commit");
  writer.close();
  while (heard.length === 0 && Date.now() - start < 1500) await sleep(25);
  if (heard.length === 0) return broken("no heal_changed within 1.5 s of a commit to the ledger");
  const after = heard[0].at - start;
  await sleep(500);
  if (heard.length !== 1) return broken(`one commit sent ${heard.length} heal_changed`);
  const frame = heard[0].frame;
  if (Object.keys(frame).sort().join(",") !== "at,kind" || typeof frame.at !== "number") return broken(`heal_changed is not exactly { kind, at }: ${JSON.stringify(frame)}`);
  return held(`two readers (the WAL there during ${walSeen} of 2 reads) sent nothing; one commit sent one heal_changed after ${after} ms`);
});
