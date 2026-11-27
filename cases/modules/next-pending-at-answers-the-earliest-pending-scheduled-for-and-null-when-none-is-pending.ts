// NEXT PENDING AT. scheduledMessagesDb.nextPendingAt() is SELECT MIN(scheduled_for) FROM scheduled_messages WHERE
// status = 'pending': the one instant the next-due timer is armed at. A sent, cancelled or failed row never counts, the
// answer is the stored string itself (Date.parse of it is the armed instant), and nothing pending answers null.
//
// Scratch app database (lib/scheduled_messages_house.mjs); nothing of the operator's is touched.
//
// protects: server/modules/database/repositories/scheduled-messages.db.ts
// writes: none

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { firstLine, scheduledHouse } from "../lib/scheduled_messages_house.mjs";

runCase(async (t: any) => {
  let h: any;
  try {
    h = await scheduledHouse(t, "sched-next");
  } catch (error) {
    return cannotRun("the scratch app database would not open: " + firstLine(error));
  }
  const repo = h.db.scheduledMessagesDb;
  if (typeof repo?.nextPendingAt !== "function") return broken("scheduledMessagesDb has no nextPendingAt()");
  const T = Date.now();
  const mk = (minutes: number) =>
    repo.create({ userId: h.userId, sessionId: "case-next-session", content: "case " + minutes, options: {}, scheduledFor: new Date(T + minutes * 60_000) });
  h.session("case-next-session");
  const empty = repo.nextPendingAt();
  mk(-1);
  const c2 = mk(2);
  const f3 = mk(3);
  const p4 = mk(4);
  const p5 = mk(5);
  const claimed = repo.claimDue(new Date(T)).length;
  repo.cancel(h.userId, c2.id);
  repo.markFailed(f3.id, "case");
  const first = repo.nextPendingAt();
  repo.cancel(h.userId, p4.id);
  const second = repo.nextPendingAt();
  repo.cancel(h.userId, p5.id);
  const none = repo.nextPendingAt();

  const wrong: string[] = [];
  if (empty !== null) wrong.push("an empty table answered " + JSON.stringify(empty) + ", not null");
  if (claimed !== 1) wrong.push("claimDue claimed " + claimed + " rows, not the one past row (setup)");
  if (first !== p4.scheduled_for) wrong.push("with sent, cancelled (+2 m) and failed (+3 m) rows before it, it answered " + JSON.stringify(first) + ", not the +4 m pending " + p4.scheduled_for);
  else if (Date.parse(first) !== T + 4 * 60_000) wrong.push("Date.parse of the answer is " + Date.parse(first) + ", not the instant scheduled");
  if (second !== p5.scheduled_for) wrong.push("after the +4 m one was cancelled it answered " + JSON.stringify(second) + ", not " + p5.scheduled_for);
  if (none !== null) wrong.push("with nothing pending it answered " + JSON.stringify(none) + ", not null");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("empty null; " + first + " past a sent, a cancelled and a failed row; " + second + " after a cancel; null with nothing pending");
});
