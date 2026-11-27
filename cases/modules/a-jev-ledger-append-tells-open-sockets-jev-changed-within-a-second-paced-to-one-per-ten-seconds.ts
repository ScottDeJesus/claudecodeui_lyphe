// protects: server/modules/jev/jev.module.ts, server/shared/file-lane.service.ts, server/shared/paced-hint.service.ts, server/shared/directory-watch.service.ts, server/modules/websocket/services/websocket-state.service.ts
// writes: none
// The Jev panel and the Jev balance read again on jev_changed instead of on a clock, so the server must say it when
// the ledger every session's Jev hook appends to moves: an append to the file JEV_LEDGER_PATH names reaches every
// open socket as { kind: 'jev_changed', at } within a second, a burst costs one more frame no sooner than ten seconds
// later, and another file of the same directory says nothing. The ledger is a scratch file (the live one is never
// written); the socket is a stand-in in the real registry, removed when the case ends.

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const GAP_MS = 10_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const dir: string = await scratchDir(t, "jev-ledger-hint");
  const ledger = path.join(dir, "jev_ledger.jsonl");
  const other = path.join(dir, "other.jsonl");
  fs.writeFileSync(ledger, '{"case":"seed"}\n');
  fs.writeFileSync(other, "");
  // Read by the module's composition root, so set before it is built.
  process.env.JEV_LEDGER_PATH = ledger;
  process.env.JEV_BIN = path.join(dir, "no-jev-reader");
  process.env.DATABASE_PATH = path.join(dir, "auth.db");

  const state: any = await import("../../server/modules/websocket/services/websocket-state.service.ts");
  const heard: Array<{ frame: any; at: number }> = [];
  const socket = {
    readyState: state.WS_OPEN_STATE,
    send: (text: string) => {
      try {
        const frame = JSON.parse(text);
        if (frame?.kind === "jev_changed") heard.push({ frame, at: Date.now() });
      } catch { /* not a frame this case reads */ }
    },
  };
  state.connectedClients.add(socket);
  t.defer(() => state.connectedClients.delete(socket));

  const { createJevModule } = await import("../../server/modules/jev/jev.module.ts");
  createJevModule();
  await sleep(300);

  fs.appendFileSync(other, '{"case":"not the ledger"}\n');
  await sleep(1000);
  if (heard.length > 0) return broken(`a write to another file of the ledger's directory sent ${heard.length} jev_changed`);

  const start = Date.now();
  fs.appendFileSync(ledger, '{"case":"append 1"}\n');
  while (heard.length === 0 && Date.now() - start < 1000) await sleep(25);
  if (heard.length === 0) return broken("no jev_changed within a second of the ledger's append");
  const firstAfter = heard[0].at - start;
  for (let i = 2; i <= 4; i += 1) {
    await sleep(700);
    fs.appendFileSync(ledger, `{"case":"append ${i}"}\n`);
  }
  await sleep(Math.max(0, start + 3000 - Date.now()));
  if (heard.length !== 1) return broken(`the burst sent ${heard.length - 1} more jev_changed inside three seconds`);
  await sleep(Math.max(0, start + 11_500 - Date.now()));
  if (heard.length !== 2) return broken(`by 11.5 s the burst had sent ${heard.length - 1} more jev_changed, not 1`);
  const spacing = heard[1].frame.at - heard[0].frame.at;
  if (spacing < GAP_MS - 2) return broken(`the second jev_changed came ${spacing} ms after the first, inside the ten-second gap`);
  await sleep(3000);
  if (heard.length !== 2) return broken(`a quiet three seconds sent ${heard.length - 2} more jev_changed`);
  const odd = heard.find(({ frame }) => Object.keys(frame).sort().join(",") !== "at,kind" || typeof frame.at !== "number");
  if (odd) return broken(`a jev_changed is not exactly { kind, at }: ${JSON.stringify(odd.frame)}`);
  return held(`another file sent nothing; the append sent jev_changed after ${firstAfter} ms; the burst one more ${spacing} ms later; quiet after`);
});
