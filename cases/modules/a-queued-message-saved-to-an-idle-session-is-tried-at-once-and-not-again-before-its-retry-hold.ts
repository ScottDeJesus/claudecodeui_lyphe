// THE QUEUED PASS ON SAVE. The user module asks the dispatcher for a queued pass (requestQueuedPass) where it saves a queued
// message, so an idle session's queued turn is tried at once, not at a poll. A turn that did not go is put back and held
// (QUEUED_RETRY_MS), so it is not tried again in a loop.
//
// Through the user module's real routes (userRoutes, mounted on a listener of the case's own with a signed-in user stood
// in), over a scratch app database and a provider gateway that refuses every turn (lib/scheduled_messages_house.mjs).
// Nothing of the operator's is touched.
//
// protects: server/modules/user/user.service.ts, server/modules/user/user.module.ts, server/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts, server/modules/scheduled-messages/services/scheduled-message-clock.service.ts, server/modules/scheduled-messages/index.ts
// writes: none

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { SERVER, firstLine, scheduledHouse, sleep } from "../lib/scheduled_messages_house.mjs";

runCase(async (t: any) => {
  let h: any;
  let disp: any;
  let userRoutes: any;
  let express: any;
  try {
    h = await scheduledHouse(t, "sched-queued");
    disp = await import(SERVER + "/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts");
    userRoutes = (await import(SERVER + "/modules/user/index.ts")).userRoutes;
    express = (await import("express")).default;
  } catch (error) {
    return cannotRun("the scratch user module would not load: " + firstLine(error));
  }
  const sid = h.session("case-queued-session");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: h.userId, userId: h.userId, username: "case-sched-queued" };
    next();
  });
  app.use("/api/user", userRoutes);
  const server: any = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.defer(() => server.close());
  disp.initializeScheduledMessageDispatcher(h.runtime);
  t.defer(() => disp.closeScheduledMessageDispatcher());
  await sleep(800);
  const before = h.attempts().length;
  const answer = await fetch("http://127.0.0.1:" + server.address().port + "/api/user/drafts/queued-message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: sid, queuedMessage: { content: "case queued", attachments: [] } }),
  });
  const body = await answer.text();
  if (answer.status !== 200) return cannotRun("POST /api/user/drafts/queued-message answered " + answer.status + ": " + body.slice(0, 160));
  await sleep(2500);
  const soon = h.attempts().length - before;
  await sleep(4000);
  const later = h.attempts().length - before;

  const wrong: string[] = [];
  if (soon !== 1) wrong.push("the saved queued message was tried " + soon + " time(s) in the 2.5 s after the save, not once");
  if (later !== soon) wrong.push("it was tried " + (later - soon) + " more time(s) in the next 4 s, inside its retry hold");
  if (wrong.length > 0) return broken(wrong.join("; ") + (h.attempts().length ? " — " + h.attempts()[0].slice(0, 120) : ""));
  return held("tried once within 2.5 s of the save (" + h.attempts()[before].slice(0, 80) + "), not again in the next 4 s");
});
