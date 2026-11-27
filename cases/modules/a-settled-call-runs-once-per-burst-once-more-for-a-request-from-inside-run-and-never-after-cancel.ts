// protects: server/shared/settled-call.service.ts
// writes: none
//
// A settled call runs its reader once for a burst of requests: the souls lane's watch hears a launch's spec, pid files
// and first log lines within milliseconds, and the lane must read once for them, not once per write. This case imports
// server/shared/settled-call.service.ts and holds it to its contract: SETTLE_MS is 300 (the number the dispatcher's
// store watch settles with), a burst of requests runs run once after the window, a request made from inside run opens
// one new window, cancel() drops a pending call, and the pending timer never holds the process up (it is unref'd).

import { broken, held, runCase } from "../lib/case.mjs";

const SETTLED_CALL = "/home/lyphe/.claude/claudecodeui_lyphe/server/shared/settled-call.service.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const firstLine = (error: any) => String(error && error.message ? error.message : error).split("\n")[0];
const refedTimers = () => process.getActiveResourcesInfo().filter((kind) => kind === "Timeout").length;

runCase(async () => {
  let settled: any;
  try {
    settled = await import(SETTLED_CALL);
  } catch (error) {
    return broken(SETTLED_CALL + " does not load: " + firstLine(error));
  }
  if (typeof settled.createSettledCall !== "function") return broken(SETTLED_CALL + " exports no createSettledCall");
  const wrong: string[] = [];
  if (settled.SETTLE_MS !== 300) wrong.push("SETTLE_MS is " + settled.SETTLE_MS + ", not 300");

  let burstRuns = 0;
  const burst = settled.createSettledCall({ run: () => { burstRuns += 1; }, settleMs: 80 });
  for (let i = 0; i < 20; i += 1) burst.request();
  await wait(30);
  burst.request();
  if (burstRuns !== 0) wrong.push("run was called " + burstRuns + " time(s) inside the window");
  await wait(250);
  if (burstRuns !== 1) wrong.push("a burst of 21 requests ran run " + burstRuns + " times, not once");

  let innerRuns = 0;
  const inner: any = settled.createSettledCall({
    run: () => {
      innerRuns += 1;
      if (innerRuns === 1) inner.request();
    },
    settleMs: 50,
  });
  inner.request();
  await wait(350);
  if (innerRuns !== 2) wrong.push("a request made from inside run gave " + innerRuns + " run(s) in all, not 2");

  let cancelRuns = 0;
  const cancelled = settled.createSettledCall({ run: () => { cancelRuns += 1; }, settleMs: 50 });
  cancelled.request();
  cancelled.cancel();
  await wait(200);
  if (cancelRuns !== 0) wrong.push("a cancelled request still ran (" + cancelRuns + ")");
  cancelled.request();
  await wait(200);
  if (cancelRuns !== 1) wrong.push("a request after cancel() ran " + cancelRuns + " times, not once");

  const before = refedTimers();
  const pending = settled.createSettledCall({ run: () => {}, settleMs: 5000 });
  pending.request();
  const after = refedTimers();
  pending.cancel();
  if (after > before) wrong.push("a pending request holds a ref'd timer, which keeps the process alive at shutdown");

  if (wrong.length > 0) return broken("settled-call.service.ts: " + wrong.join("; "));
  return held("settled-call.service.ts: SETTLE_MS 300; 21 requests ran once; a request from inside run opened one new window; cancel() dropped the pending call; the pending timer is unref'd");
});
