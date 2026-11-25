// protects: src/modules/gemini-spend/useGeminiUsage.ts, src/shared/api.ts
// writes: none
//
// The Gemini view is told, it never asks on a clock (the plan's "Told, not asking"). useGeminiUsage reads both doors,
// GET /api/gemini-usage/usage and GET /api/gemini-meter/usage, when the view mounts (7 days, its opening window), when the
// page becomes visible again and when the window changes, once each, and at no other moment. The real view is mounted in
// the running app's page with both doors answered by the case (lib/gemini_panel.mjs), so nothing real is read; the page
// going away and coming back is stood in for by document.visibilityState and its event.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { geminiPanel, sleep, until } from "../lib/gemini_panel.mjs";

const QUIET_MS = 25000;
const onceEach = (reads, range) => reads.connector.join(",") === range && reads.meter.join(",") === range;

runCase(async (t) => {
  const panel = await geminiPanel(t);
  if (panel.cannot) return cannotRun(panel.cannot);
  if (panel.error) return broken(panel.error);
  if (!(await until(() => panel.drawn(), 10000))) return broken("the view drew neither door's place within 10 s of mounting (reads " + JSON.stringify(panel.asked) + ")");
  await sleep(1500);
  const wrong = [];
  const said = [];

  const mount = panel.reads(0);
  if (!onceEach(mount, "7d")) wrong.push("mounting read " + JSON.stringify(mount) + ", not each door once for 7d");
  if (panel.mounted.interval) wrong.push("useGeminiUsage.ts calls setInterval");
  said.push("mount " + JSON.stringify(mount));

  let from = panel.asked.length;
  await sleep(QUIET_MS);
  if (panel.asked.length !== from) wrong.push("with nothing done for " + QUIET_MS / 1000 + " s it read " + JSON.stringify(panel.reads(from)) + ": a clock");
  said.push("quiet " + QUIET_MS / 1000 + " s: " + (panel.asked.length - from) + " reads");

  from = panel.asked.length;
  await panel.visible();
  await sleep(1500);
  const back = panel.reads(from);
  if (!onceEach(back, "7d")) wrong.push("the page becoming visible again read " + JSON.stringify(back) + ", not each door once for 7d");
  said.push("visible " + JSON.stringify(back));

  from = panel.asked.length;
  await panel.window("today");
  await sleep(1500);
  const today = panel.reads(from);
  if (!onceEach(today, "today")) wrong.push("choosing Today read " + JSON.stringify(today) + ", not each door once for today");
  if (!(await until(() => panel.drawn(), 5000))) wrong.push("after Today the view did not draw both places again");
  said.push("Today " + JSON.stringify(today));

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(said.join("; "));
});
