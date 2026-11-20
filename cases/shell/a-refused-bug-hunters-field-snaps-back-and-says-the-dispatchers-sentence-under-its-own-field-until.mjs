// protects: src/modules/settings/hooks/useBugHunters.ts, src/modules/settings/hooks/bugHuntersWire.ts, src/modules/settings/tabs/agents-settings/sections/content/RunnerBugHuntersRow.tsx, src/modules/settings/tabs/agents-settings/sections/content/RunnerBugHuntersSetting.tsx, src/modules/i18n/locales/en/settings.json
// writes: none
//
// A value the dispatcher refuses snaps back and says the dispatcher's sentence under its own field (bug-hunters phase 17).
// The 409 is the route's own shape (`{ error: <the dispatcher's line> }`, kanban-dispatch.verb.ts sendFailure) carrying the
// line `dispatcher hunt config --minutes 900` printed on a scratch file 2026-11-20. The row says it without the command's
// `REFUSED hunt config: ` lead and with a capital (useBugHunters' `refusals`), under the minutes row alone, and the field
// shows the saved 120 again. Typing in that field again is a new change: the old sentence falls.
// Every request under /api/kanban-dispatch/hunts/ is answered by the page (lib/bug_hunters_answer.mjs).

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { openAgents, until } from "../lib/agents_settings.mjs";
import { answerHunts, refusalsDrawn, shippedConfig, typeAndLeave } from "../lib/bug_hunters_answer.mjs";

const LINE = "REFUSED hunt config: minutes must be a whole number from 15 to 600, not 900";
const SAID = "Minutes must be a whole number from 15 to 600, not 900";
const FIELD = "runner-bug-hunters-minutes";

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  const hunts = await answerHunts(page, {
    get: () => ({ status: 200, body: shippedConfig() }),
    put: () => ({ status: 409, body: { error: LINE } }),
  });
  await openAgents(page);
  const field = page.locator(`.modal-backdrop #${FIELD}`).first();
  if (!(await until(async () => (await field.count()) > 0 && (await field.inputValue()) === "120", 10000))) {
    return broken(`the minutes field does not read the answered 120 (it reads ${(await field.count()) ? JSON.stringify(await field.inputValue()) : "nothing: not drawn"})`);
  }

  await typeAndLeave(page, FIELD, "900");
  const sent = await until(async () => hunts.writes().find((w) => w.method === "PUT"), 6000);
  if (!sent) return broken("900 typed in Minutes a night and left sent no PUT of /api/kanban-dispatch/hunts/settings");
  if (JSON.stringify(sent.body) !== JSON.stringify({ minutes: 900 })) return broken(`leaving Minutes a night at 900 sent ${JSON.stringify(sent.body)}, not { minutes: 900 } alone`);

  const shown = await until(async () => {
    const lines = await refusalsDrawn(page);
    return lines.minutes ? lines : null;
  }, 6000);
  if (!shown) return broken(`the 409 drew no refusal under the minutes row (rows with a refusal: ${JSON.stringify(await refusalsDrawn(page))})`);
  if (!shown.minutes.includes(SAID)) return broken(`the minutes row says "${shown.minutes}", not the dispatcher's sentence "${SAID}"`);
  if (/REFUSED hunt config/.test(shown.minutes)) return broken(`the minutes row says the command's lead: "${shown.minutes}"`);
  const elsewhere = Object.keys(shown).filter((k) => k !== "minutes");
  if (elsewhere.length > 0) return broken(`the refusal of minutes is also drawn under ${JSON.stringify(elsewhere)}`);
  const back = await until(async () => (await field.inputValue()) === "120", 4000);
  if (!back) return broken(`after the refusal the field reads ${JSON.stringify(await field.inputValue())}, not the saved 120: a refused value did not snap back`);

  await field.click();
  await field.press("End");
  await field.pressSequentially("5");
  const gone = await until(async () => !(await refusalsDrawn(page)).minutes, 4000);
  if (!gone) return broken(`typing in the minutes field again left the old sentence standing: "${(await refusalsDrawn(page)).minutes}"`);
  await page.keyboard.press("Escape");

  return held(`{ minutes: 900 } sent alone; the field snapped back to 120 and the minutes row alone said "Not saved. ${SAID}"; typing again took it away`);
});
