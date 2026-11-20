// protects: src/modules/settings/hooks/useBugHunters.ts, src/modules/settings/hooks/bugHuntersWire.ts, src/modules/settings/tabs/agents-settings/sections/content/RunnerBugHuntersRow.tsx, src/modules/settings/tabs/agents-settings/sections/content/RunnerBugHuntersSetting.tsx, src/modules/settings/tabs/agents-settings/sections/content/RunnerBugHuntersList.tsx
// writes: none
//
// The bug hunters rows draw what `GET /api/kanban-dispatch/hunts/settings` (`dispatcher hunt config --json`) answers,
// never the file as it ships (bug-hunters phase 17: useBugHunters reads the route). The page answers a config unlike the
// shipped one in every field, so a hook that draws its own defaults cannot pass: nightly on, 03:10, 45 minutes, 7
// tickets, `order` code then ui (security, behaviour and data sit out), the projects reversed, turns `hunter`.
//
// A READ THAT FAILS IS NOT THE DEFAULTS: the first read is answered 502, and the rows must be the one unknown row
// (`[data-runner-bug-hunters="unknown"]`) with its Retry and no nightly switch; Retry reads again, and the answer is drawn.
// Every request under /api/kanban-dispatch/hunts/ is answered by the page (lib/bug_hunters_answer.mjs); none may be a write.

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { openAgents, until } from "../lib/agents_settings.mjs";
import { answerHunts, huntersDrawn, ROW, shippedConfig } from "../lib/bug_hunters_answer.mjs";

const NIGHTLY = "Run the bug hunters nightly";
const SHIPPED = shippedConfig();
const ANSWER = shippedConfig({
  nightly: true, start: "03:10", minutes: 45, tickets_per_night: 7, order: ["code", "ui"], turns: "hunter",
  projects: [...SHIPPED.projects].reverse(),
});

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  let failFirst = true;
  const hunts = await answerHunts(page, {
    get: () => (failFirst ? { status: 502, body: { error: "CASE: the dispatcher did not answer" } } : { status: 200, body: ANSWER }),
  });
  await openAgents(page);
  const win = page.locator(".modal-backdrop");

  // The failed read: one unknown row, its Retry, and no switch drawn over a value nobody read.
  const unknown = win.locator('[data-runner-bug-hunters="unknown"]').first();
  if (!(await until(async () => (await unknown.count()) > 0, 10000))) {
    const switches = await win.getByRole("switch", { name: NIGHTLY }).count();
    return broken(`a hunts read answered 502 draws no unknown row (the nightly switch is drawn ${switches} time(s): defaults stood in for a read that failed)`);
  }
  if ((await win.getByRole("switch", { name: NIGHTLY }).count()) > 0) return broken("the unknown row stands beside a nightly switch drawn anyway");

  failFirst = false;
  const readsBefore = hunts.requests.filter((r) => r.method === "GET").length;
  await unknown.getByRole("button", { name: "Retry" }).first().click({ timeout: 10000 });
  const nightly = win.getByRole("switch", { name: NIGHTLY }).first();
  if (!(await until(async () => (await nightly.count()) > 0, 10000))) {
    const reads = hunts.requests.filter((r) => r.method === "GET").length - readsBefore;
    return broken(`Retry made ${reads} read(s) and the rows were not drawn from the answer`);
  }

  const seen = {
    nightly: await nightly.getAttribute("aria-checked"),
    start: await win.locator("#runner-bug-hunters-start").first().inputValue(),
    minutes: await win.locator("#runner-bug-hunters-minutes").first().inputValue(),
    tickets: await win.locator("#runner-bug-hunters-tickets").first().inputValue(),
    turns: ((await page.locator(`${ROW("turns")} .vv-select__trigger`).first().textContent()) ?? "").replace(/\s+/g, " ").trim(),
    ...(await huntersDrawn(page)),
  };
  const wrong = [];
  if (seen.nightly !== "true") wrong.push(`the switch reads ${seen.nightly}, the answer on`);
  if (seen.start !== "03:10") wrong.push(`start "${seen.start}", the answer 03:10`);
  if (seen.minutes !== "45") wrong.push(`minutes "${seen.minutes}", the answer 45`);
  if (seen.tickets !== "7") wrong.push(`tickets "${seen.tickets}", the answer 7`);
  if (!/One hunter at a time/.test(seen.turns)) wrong.push(`the turns list reads "${seen.turns}", the answer hunter (One hunter at a time)`);
  const taking = seen.hunters.filter((h) => !h.out).map((h) => h.key);
  const out = seen.hunters.filter((h) => h.out).map((h) => h.key).sort();
  if (JSON.stringify(taking) !== JSON.stringify(["code", "ui"])) wrong.push(`the hunters taking turns read ${JSON.stringify(taking)}, the answer ["code","ui"]`);
  if (JSON.stringify(out) !== JSON.stringify(["behaviour", "data", "security"])) wrong.push(`the hunters sitting out read ${JSON.stringify(out)}, the answer behaviour, data, security`);
  const projects = ANSWER.projects.map((p) => p.name);
  if (JSON.stringify(seen.projects) !== JSON.stringify(projects)) wrong.push(`the projects read ${JSON.stringify(seen.projects)}, the answer ${JSON.stringify(projects)}`);
  if (wrong.length > 0) return broken(`over the route's answer the rows draw: ${wrong.join("; ")}`);

  await page.waitForTimeout(800);
  if (hunts.writes().length > 0) return broken(`reading the rows wrote ${JSON.stringify(hunts.writes())}`);
  return held("a failed read is one unknown row and no switch; Retry reads again and the rows draw the answer: on, 03:10, 45, 7, code and ui taking turns, three sitting out, the projects reversed, One hunter at a time; no write");
});
