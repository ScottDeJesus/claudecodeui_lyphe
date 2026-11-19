// FEED: `dispatcher status --json` carries `cards`, one object per card row (board, card, title, state, flow, part,
// sorted_by, confidence, hold, waits_on, chain_id, cases [{suite, name, word}], stages [{name, soul, launch_id, status,
// verdict, cost_usd}]). The dispatcher lane reads it through its own reader (`dispatcher-card.reader.ts`) into
// `DispatcherPicture.cards`, the list the `dispatcher_state` frame carries to the board, and refuses a card whose field
// does not read, naming the field — as it refuses a malformed plan or outing.
//
// The document is printed by a stand-in for the dispatcher in this case's scratch folder; nothing is read from the
// real store.
//
// protects: server/modules/dispatcher/dispatcher-card.reader.ts, server/modules/dispatcher/dispatcher-state.service.ts, server/modules/dispatcher/dispatcher-state.transport.ts, server/shared/types.ts
// writes: none

import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const CARD = {
  board: "b-1", card: "c-2", title: "cases sweep --suite . refuses the relative path", state: "walking", flow: "bug",
  part: "whole", sorted_by: "jev", confidence: 0.93, hold: null, waits_on: null,
  chain_id: "chain-card-b-1-c-2-20261119-000000-abcd",
  cases: [{ suite: "/home/lyphe/.claude", name: "a-relative-suite-path-is-refused-naming-an-absolute-one", word: "broken" }],
  stages: [
    { name: "diagnose", soul: "asclepius", launch_id: "dispatch-asclepius-20261119-000000-aaaa", status: "done", verdict: null, cost_usd: 0.42 },
    { name: "scenarios", soul: "athena", launch_id: null, status: null, verdict: null, cost_usd: 0 },
  ],
};
const QUEUED = { ...CARD, card: "c-3", title: "held", state: "queued", flow: "tweak", sorted_by: "default", confidence: null,
  hold: "cards: 1 of 1 walking", waits_on: 7, chain_id: null, cases: [], stages: [] };

const documentWith = (cards: unknown[]) => ({
  generated_at: "2026-11-19T00:00:00Z", home: "/nowhere/dispatcher",
  route: { provider: "claude", word: "claude", park_at_peak: false, peak_until: null },
  daemon: { alive: false, pid: null, unit: null }, offpeak_at: "none",
  arcs: [], plans: [], planners: [], cards,
});

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "card-feed");
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  const { initializeDatabase } = await import("../../server/modules/database/index.ts");
  await initializeDatabase();
  const state: any = await import("../../server/modules/dispatcher/dispatcher-state.service.ts");

  const standIn = async (name: string, document: unknown): Promise<string> => {
    const file = path.join(folder, `${name}.json`);
    await writeFile(file, JSON.stringify(document));
    const bin = path.join(folder, name);
    await writeFile(bin, `#!/bin/sh\ncat '${file}'\n`);
    await chmod(bin, 0o755);
    return bin;
  };
  const read = async (bin: string) => state.lanePictureOf(await state.readDispatcherStore({ bin, timeoutMs: 20000, env: { ...process.env } }));

  const wrong: string[] = [];
  let picture: any;
  try {
    picture = await read(await standIn("good", documentWith([CARD, QUEUED])));
  } catch (error) {
    return broken(`a document with two well-formed cards was refused: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  if (!Array.isArray(picture.cards)) return broken(`the lane's picture has no cards list (keys: ${Object.keys(picture).join(", ")})`);
  // Key order is the reader's own; the promise is the keys and their values.
  const canon = (value: unknown): unknown =>
    Array.isArray(value) ? value.map(canon)
      : value !== null && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canon((value as any)[k])]))
        : value;
  if (JSON.stringify(canon(picture.cards)) !== JSON.stringify(canon([CARD, QUEUED]))) {
    wrong.push(`the picture's cards are ${JSON.stringify(picture.cards).slice(0, 300)}, not the feed's two cards key for key`);
  }

  try {
    await read(await standIn("bad", documentWith([CARD, { ...QUEUED, state: 7 }])));
    wrong.push("a card whose state is the number 7 was read into the picture, not refused");
  } catch (error) {
    const said = String((error as Error)?.message ?? error);
    if (!/state/.test(said)) wrong.push(`a card whose state is 7 was refused without naming state: ${said.split("\n")[0]}`);
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("the feed's walking and queued cards ride the lane's picture key for key; a card with state 7 is refused naming state");
});
