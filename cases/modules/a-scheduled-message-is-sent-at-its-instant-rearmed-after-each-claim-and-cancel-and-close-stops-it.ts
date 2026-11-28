// THE NEXT-DUE TIMER. The dispatcher arms one timer at the earliest pending scheduled_for (nextPendingAt), claims what is
// due when it fires and arms again for the next; scheduledMessagesService.schedule and cancel tell it (onChanged), so a
// cancel moves the timer to the next pending message. closeScheduledMessageDispatcher clears the timer and the
// subscription. No setInterval: the 30-second poll is gone.
//
// Scratch app database, a provider gateway that refuses every turn (lib/scheduled_messages_house.mjs): a claimed message
// ends sent or failed, never pending. Nothing of the operator's is touched.
//
// protects: server/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts, server/modules/scheduled-messages/services/scheduled-message-clock.service.ts, server/modules/scheduled-messages/services/scheduled-messages.service.ts, server/modules/database/repositories/scheduled-messages.db.ts, server/shared/deadline-timer.ts
// writes: none

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { SERVER, firstLine, scheduledHouse, sleep, sleepUntil } from "../lib/scheduled_messages_house.mjs";

runCase(async (t: any) => {
  const intervals: unknown[] = [];
  const realSetInterval = globalThis.setInterval;
  (globalThis as any).setInterval = (fn: any, ms?: number, ...rest: any[]) => {
    const caller = (new Error().stack ?? "").split("\n").slice(2, 4).join(" ");
    if (/scheduled-message|deadline-timer/.test(caller)) intervals.push(ms);
    return realSetInterval(fn, ms, ...rest);
  };
  let h: any;
  let disp: any;
  let svc: any;
  try {
    h = await scheduledHouse(t, "sched-timer");
    svc = (await import(SERVER + "/modules/scheduled-messages/services/scheduled-messages.service.ts")).scheduledMessagesService;
    disp = await import(SERVER + "/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts");
  } catch (error) {
    return cannotRun("the scratch dispatcher would not load: " + firstLine(error));
  }
  const sid = h.session("case-timer-session");
  disp.initializeScheduledMessageDispatcher(h.runtime);
  t.defer(() => disp.closeScheduledMessageDispatcher());
  await sleep(500);
  const status = (id: string) => h.conn.prepare("SELECT status FROM scheduled_messages WHERE id = ?").get(id)?.status;
  const T = Date.now();
  const put = (at: number) => svc.schedule({ userId: h.userId, sessionId: sid, content: "case message", scheduledFor: new Date(at).toISOString() });
  const a = put(T + 2000);
  const b = put(T + 4000);
  const c = put(T + 6000);
  svc.cancel(h.userId, b.id);
  await sleepUntil(T + 1500);
  const aBefore = status(a.id);
  await sleepUntil(T + 3500);
  const aAfter = status(a.id);
  await sleepUntil(T + 5500);
  const cBefore = status(c.id);
  await sleepUntil(T + 7500);
  const cAfter = status(c.id);
  const bEnd = status(b.id);
  disp.closeScheduledMessageDispatcher();
  const T2 = Date.now();
  const d = put(T2 + 1500);
  await sleepUntil(T2 + 3500);
  const dAfterClose = status(d.id);
  (globalThis as any).setInterval = realSetInterval;

  const wrong: string[] = [];
  if (aBefore !== "pending") wrong.push("the +2 s message read " + aBefore + " at +1.5 s, before its instant");
  if (aAfter === "pending") wrong.push("the +2 s message was still pending at +3.5 s: nothing sent it at its instant");
  if (cBefore !== "pending") wrong.push("the +6 s message read " + cBefore + " at +5.5 s");
  if (cAfter === "pending") wrong.push("the +6 s message was still pending at +7.5 s: the timer was not armed again after the claim and the cancel");
  if (bEnd !== "cancelled") wrong.push("the cancelled +4 s message reads " + bEnd);
  if (dAfterClose !== "pending") wrong.push("after close, a message scheduled 1.5 s out read " + dAfterClose + " 2 s after its instant: close left a timer or a subscription");
  if (intervals.length !== 0) wrong.push("setInterval was called " + intervals.length + " time(s) from the scheduled-messages code, every " + intervals.join(", ") + " ms");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("+2 s pending at 1.5 s, " + aAfter + " by 3.5 s; cancelled +4 s stayed cancelled; +6 s pending at 5.5 s, " + cAfter + " by 7.5 s; after close one stayed pending; no setInterval");
});
