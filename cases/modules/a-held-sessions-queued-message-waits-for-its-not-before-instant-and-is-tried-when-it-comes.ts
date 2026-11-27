// THE NOT-BEFORE HOLD. holdQueued(sessionId, until) keeps a not-before instant per session; mayStartQueued(sessionId, now)
// reads it; the queued pass skips a held session; the clock's second timer, armed at the earliest hold, asks for the
// queued pass when it comes (a second, shorter hold fires first and finds the first still held). STOP_GRACE_MS (after a Stop) is 15 s and QUEUED_RETRY_MS (after a turn that did not go) 30 s.
//
// Scratch app database, a provider gateway that refuses every turn (lib/scheduled_messages_house.mjs). Nothing of the
// operator's is touched.
//
// protects: server/modules/scheduled-messages/services/scheduled-message-clock.service.ts, server/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts, server/shared/deadline-timer.ts
// writes: none

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { SERVER, firstLine, scheduledHouse, sleep, sleepUntil } from "../lib/scheduled_messages_house.mjs";

runCase(async (t: any) => {
  let h: any;
  let disp: any;
  try {
    h = await scheduledHouse(t, "sched-hold");
    disp = await import(SERVER + "/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts");
  } catch (error) {
    return cannotRun("the scratch dispatcher would not load: " + firstLine(error));
  }
  let clock: any;
  try {
    clock = await import(SERVER + "/modules/scheduled-messages/services/scheduled-message-clock.service.ts");
  } catch (error) {
    return broken("the scheduled-message clock would not load: " + firstLine(error));
  }
  const missing = ["holdQueued", "mayStartQueued"].filter((n) => typeof clock[n] !== "function");
  if (typeof disp.requestQueuedPass !== "function") missing.push("requestQueuedPass (dispatcher)");
  if (missing.length > 0) return broken("missing: " + missing.join(", "));
  const sid = h.session("case-held-session");
  disp.initializeScheduledMessageDispatcher(h.runtime);
  t.defer(() => disp.closeScheduledMessageDispatcher());
  await sleep(800);
  const T = Date.now();
  clock.holdQueued(sid, T + 2500);
  const early = clock.mayStartQueued(sid, T + 2400);
  clock.holdQueued("case-short-session", T + 1000);
  const other = clock.mayStartQueued("case-unheld-session", T);
  h.db.sessionDraftsDb.appendQueuedMessage(h.userId, sid, { id: "case-held", content: "case held", options: {}, attachments: [] }, 100_000);
  const base = h.attempts().length;
  disp.requestQueuedPass();
  await sleepUntil(T + 2000);
  const whileHeld = h.attempts().length - base;
  const after = clock.mayStartQueued("case-short-session", Date.now());
  await sleepUntil(T + 4500);
  const afterHold = h.attempts().length - base;

  const wrong: string[] = [];
  if (clock.STOP_GRACE_MS !== 15_000) wrong.push("STOP_GRACE_MS is " + clock.STOP_GRACE_MS);
  if (clock.QUEUED_RETRY_MS !== 30_000) wrong.push("QUEUED_RETRY_MS is " + clock.QUEUED_RETRY_MS);
  if (early !== false) wrong.push("mayStartQueued read " + early + " 100 ms before the hold's instant");
  if (after !== true) wrong.push("mayStartQueued read " + after + " for a session whose hold ended a second ago");
  if (other !== true) wrong.push("an unheld session read " + other);
  if (whileHeld !== 0) wrong.push("the held session's queued message was tried " + whileHeld + " time(s) before its instant");
  if (afterHold !== 1) wrong.push("it was tried " + afterHold + " time(s) in the 2 s after its instant, not once: the hold's timer did not ask for the queued pass");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("15000/30000; held false before, true after, unheld true; no try while held, one within 2 s of the instant");
});
