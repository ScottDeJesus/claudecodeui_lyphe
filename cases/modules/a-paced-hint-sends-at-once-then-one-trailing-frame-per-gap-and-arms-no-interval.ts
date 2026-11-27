// protects: server/shared/paced-hint.service.ts, server/shared/index.ts
// writes: none
// The paced hint is what keeps a busy writer (a ledger every session appends to) from becoming a storm of frames,
// and what keeps the house's rule that nothing ticks: the first tell goes at once, a burst inside the gap costs ONE
// trailing frame when the gap ends (the last write of a burst is never lost), stop() cancels it, the frame is
// { kind, at } and nothing else (MAN-453's hint rule), each timer is armed by a tell and unref'd, and there is no
// interval. The gap here is 300 ms so the case runs in about two seconds.

import fs from "node:fs";

import { broken, held, runCase } from "../lib/case.mjs";

const SOURCE = new URL("../../server/shared/paced-hint.service.ts", import.meta.url);
const GAP_MS = 300;
const TIMER_SLACK_MS = 2;
const realSetTimeout = globalThis.setTimeout;
const sleep = (ms: number) => new Promise((resolve) => realSetTimeout(resolve, ms));

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const barrel = fs.readFileSync(new URL("../../server/shared/index.ts", import.meta.url), "utf8");
  if (!/\bcreatePacedHint\b/.test(barrel)) return broken("server/shared/index.ts does not expose createPacedHint");
  const mod: any = await import("../../server/shared/paced-hint.service.ts");
  if (typeof mod.createPacedHint !== "function") return broken("paced-hint.service.ts exports no createPacedHint");

  let intervals = 0;
  const realSetInterval = globalThis.setInterval;
  (globalThis as any).setInterval = (...args: unknown[]) => { intervals += 1; return (realSetInterval as any)(...args); };
  t.defer(() => { globalThis.setInterval = realSetInterval; });
  let inTell = false;
  const armed: any[] = [];
  (globalThis as any).setTimeout = (...args: unknown[]) => {
    const handle = (realSetTimeout as any)(...args);
    if (inTell) armed.push(handle);
    return handle;
  };
  t.defer(() => { globalThis.setTimeout = realSetTimeout; });

  const frames: any[] = [];
  const hint = mod.createPacedHint({ kind: "case_paced", minGapMs: GAP_MS, send: (frame: any) => frames.push(frame) });
  const tell = () => { inTell = true; try { hint.tell(); } finally { inTell = false; } };
  t.defer(() => hint.stop());

  tell();
  if (frames.length !== 1) return broken(`the first tell sent ${frames.length} frames at once, not 1`);
  for (let i = 0; i < 3; i += 1) { await sleep(40); tell(); }
  if (frames.length !== 1) return broken(`a burst inside the gap sent ${frames.length - 1} frames at once`);
  await sleep(GAP_MS + 200);
  if (frames.length !== 2) return broken(`after the gap the burst had sent ${frames.length - 1} frames, not 1`);
  const spacing = frames[1].at - frames[0].at;
  if (spacing < GAP_MS - TIMER_SLACK_MS) return broken(`the trailing frame came ${spacing} ms after the first, inside the ${GAP_MS} ms gap`);
  await sleep(GAP_MS + 100);
  if (frames.length !== 2) return broken(`a quiet gap sent ${frames.length - 2} frames`);
  tell();
  if (frames.length !== 3) return broken("a tell after a quiet gap did not go at once");
  tell();
  hint.stop();
  await sleep(GAP_MS + 200);
  if (frames.length !== 3) return broken("stop() did not cancel the pending frame");

  const shapes = frames.filter((f) => Object.keys(f).sort().join(",") !== "at,kind" || f.kind !== "case_paced" || typeof f.at !== "number");
  if (shapes.length > 0) return broken(`a frame is not exactly { kind, at }: ${JSON.stringify(shapes[0])}`);
  if (armed.length === 0) return broken("no timer was armed for the burst's trailing frame");
  const held_ = armed.filter((h) => typeof h?.hasRef !== "function" || h.hasRef());
  if (held_.length > 0) return broken(`${held_.length} of ${armed.length} timers armed by tell() keep the process alive (not unref'd)`);
  if (intervals > 0) return broken(`setInterval was called ${intervals} times`);
  if (/setInterval/.test(fs.readFileSync(SOURCE, "utf8"))) return broken("paced-hint.service.ts names setInterval");
  return held(`first frame at once; burst gave one trailing frame ${spacing} ms later; stop() cancelled; frames are { kind, at }; ${armed.length} timer(s), all unref'd; no interval`);
});
