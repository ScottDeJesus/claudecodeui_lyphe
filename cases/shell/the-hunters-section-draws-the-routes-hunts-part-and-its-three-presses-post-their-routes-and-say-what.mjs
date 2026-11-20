// The Dashboard's bug hunters section is drawn from the dashboard route's `hunts` part, and its three presses call
// their routes (bug-hunters, seams 9 to 11, wired in phase 16). The section draws the route's hunter and project and
// none of the stand-in it drew before it was wired. Run a night now posts /hunts/night with no minutes (the night takes
// the minutes Settings holds); a 200 whose first line is `CLOSED night … — the next night opened` (a run past a stale
// night prints that before its OPENED line, and the route hands on only the first) did what was asked and says
// nothing; a 200 that opened nothing ("last night's hunter is still out — tonight opens nothing") and a 409 are said.
// Stop tonight's hunt, confirmed, posts /hunts/stop with no `now`: the hunter winds down at its next clock. Hunt it
// again posts /hunts/reopen { hunt, project: <the project's NAME, not its folder>, unit }, and a 409 is said beside the
// unit. A `hunts` part that answered ok: false draws its sentence and no press.
//
// The board is lib/kanban_board.mjs's made-up board; the dashboard and the three acts are answered by this case, and
// the app's socket is the case's (lib/bug_hunt_faces.mjs), so a re-read happens when the case sends a frame. Nothing
// reaches the dispatcher and nothing is written.
//
// protects: src/modules/kanban/dashboard/BugDashboard.tsx, src/modules/kanban/dashboard/useBugDashboard.ts, src/modules/kanban/dashboard/DashboardHunters.tsx, src/modules/kanban/dashboard/DashboardHunterSkips.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { BOARD, CARDS, openBoard } from "../lib/kanban_board.mjs";
import { AT, DASHBOARD, HUNT_ACT, QUIET_MS, WAIT_MS, answer, holdBus, json, standInIn, tab, until, watch } from "../lib/bug_hunt_faces.mjs";

const FOLDER = "/tmp/case-hunt-project";
const UNIT = "case/unit-a.py";
const DAY = 86400000;

function hunts(nightState) {
  return {
    nightly: false, start: "00:30", minutes: 120, order: ["code"], turns: "project",
    night: { night: "2026-11-18", state: nightState, opened_at: AT, minutes_used: 7, why: nightState === "open" ? null : "time spent" },
    sitting: null, next: { hunt: "code", project: FOLDER, rehunt: false },
    hunts: [{ hunt: "code", soul: "hephaestus", model: "opus", runs: true, projects: [{
      project: FOLDER, name: "Case project", unit_word: "files", state: "hunting", pass: 1, total: 9, covered: 4, skipped: 1, open: 4,
      tickets: 1, proposals: 0, nights_left: 2, cause: null, last: { night: "2026-11-18", minutes: 7, outcome: "wound down", covered: 4 } }] }],
    skipped: [{ hunt: "code", project: FOLDER, unit: UNIT, reason: "the case could not open it", marked_at: AT }],
    sittings: [{ night: "2026-11-18", hunt: "code", soul: "hephaestus", project: FOLDER, minutes: 7, outcome: "wound down", cause: null, covered: 4, skipped: 1, tickets: 1, proposals: 0 }],
  };
}

function answerFor(scope, days, part) {
  const today = Date.now();
  const oldest = { cardId: CARDS.bug.id, boardId: BOARD.id, boardName: BOARD.name, title: CARDS.bug.title, createdAt: new Date(today - DAY).toISOString(), ageDays: 1, priority: "high", status: "todo" };
  return {
    stats: {
      scope: { boardId: scope === "all" ? null : BOARD.id, boardName: scope === "all" ? null : BOARD.name, days },
      open: { total: 1, byPriority: { high: 1, medium: 0, low: 0 }, byLane: { not_ready: 0, todo: 1, questions: 0, active: 0 } },
      oldestOpenHigh: oldest, oldestOpen: [oldest],
      timeToFix: { all: { count: 0, medianHours: null, p90Hours: null }, high: null, medium: null, low: null },
      byDay: Array.from({ length: days }, (_, i) => ({ day: new Date(today - (days - 1 - i) * DAY).toISOString().slice(0, 10), opened: 0, fixed: 0 })),
      waysIn: [], cameBack: 0,
    },
    changelog: [],
    cases: { ok: false, error: "cases stats did not answer for this case" },
    tickets: { ok: true, value: { days, by_source: [], unplaced: [], came_back: { reopened: 0, regressions: 0 } } },
    hunts: part,
  };
}

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  const bus = await holdBus(page);
  await openBoard(page);
  let part = { ok: true, value: hunts("closed") };
  await answer(page, DASHBOARD, (request) => {
    const url = new URL(request.url());
    return json(answerFor(url.searchParams.get("board"), Number(url.searchParams.get("days")) || 30, part));
  });
  const acts = watch(page, HUNT_ACT);
  let reply = json({ line: "CLOSED night 2026-11-17 — the next night opened" });
  await answer(page, HUNT_ACT, () => reply);
  const posted = (act) => acts.filter((r) => r.method === "POST" && r.path.endsWith(`/hunts/${act}`));

  await tab(page, "Dashboard").click({ timeout: WAIT_MS });
  const section = page.locator('[data-dashboard-hunters="read"]').first();
  if (!(await section.waitFor({ timeout: WAIT_MS }).then(() => true, () => false))) {
    const face = await page.locator("[data-bug-dashboard]").first().getAttribute("data-bug-dashboard").catch(() => null);
    return broken(`over an answer whose hunts part is ok the face draws no read hunters section (data-bug-dashboard=${face})`);
  }
  if (!((await section.textContent()) ?? "").includes("Case project")) return broken("the hunters section does not draw the route's project, Case project");
  const stale = [...(await standInIn(section)), ...(((await section.textContent()) ?? "").includes("Restorly connector") ? ["Restorly connector"] : [])];
  if (stale.length > 0) return broken(`over the route's hunts part the section still draws its stand-in: ${stale.join(" | ")}`);
  const said = section.locator("[data-hunters-night-said]");
  const saysNothing = async () => { await page.waitForTimeout(QUIET_MS); return (await said.count()) === 0; };
  const says = (words) => until(page, async () => ((await said.first().textContent().catch(() => "")) ?? "").includes(words), 5000);
  const run = section.locator('[data-hunters-press="run"]').first();

  // RUN, answered with a CLOSED first line: it did what was asked.
  await run.click({ timeout: WAIT_MS });
  if (!(await until(page, () => posted("night").length === 1))) return broken("Run a night now sent no POST /hunts/night");
  const nightBody = posted("night")[0].body;
  if (nightBody !== null && typeof nightBody === "object" && "minutes" in nightBody) return broken(`Run a night now posted ${JSON.stringify(nightBody)}: it names minutes`);
  if (!(await saysNothing())) return broken(`a night that closed a stale one and opened ("CLOSED night … — the next night opened") is said as not done: ${await said.first().textContent()}`);

  // RUN, answered 200 with a line that opened nothing, then with a 409.
  reply = json({ line: "hunt night: last night's hunter is still out — tonight opens nothing" });
  await run.click({ timeout: WAIT_MS });
  if (!(await says("tonight opens nothing"))) return broken("a 200 whose line says tonight opens nothing is not said");
  reply = json({ error: "REFUSED hunt night: the case refuses this night" }, 409);
  await run.click({ timeout: WAIT_MS });
  if (!(await says("he case refuses this night"))) return broken("a 409 on Run a night now is not said in the dispatcher's words");

  // STOP, once a night is open, confirmed.
  part = { ok: true, value: hunts("open") };
  bus.dispatcherFrame();
  const stop = section.locator('[data-hunters-press="stop"]').first();
  if (!(await stop.waitFor({ timeout: WAIT_MS }).then(() => true, () => false))) return broken("with the night open the section offers no Stop tonight's hunt");
  reply = json({ line: "STOPPED night 2026-11-18 — stopped by the operator; the hunter winds down at its next clock" });
  await stop.click({ timeout: WAIT_MS });
  const question = page.getByRole("dialog").filter({ hasText: "Stop tonight's hunt?" }).first();
  await question.waitFor({ timeout: WAIT_MS });
  await question.getByRole("button", { name: "Stop tonight's hunt" }).last().click({ timeout: WAIT_MS });
  if (!(await until(page, () => posted("stop").length === 1))) return broken("Stop tonight's hunt, confirmed, sent no POST /hunts/stop");
  const stopBody = posted("stop")[0].body;
  if (stopBody !== null && typeof stopBody === "object" && stopBody.now === true) return broken(`Stop tonight's hunt posted ${JSON.stringify(stopBody)}: it ends the hunter now`);
  if (!(await saysNothing())) return broken(`a STOPPED line is said as not done: ${await said.first().textContent()}`);

  // HUNT IT AGAIN: the project by its name, a 409 said beside the unit.
  reply = json({ error: "REFUSED hunt reopen: the case refuses this reopen" }, 409);
  await section.locator(`[data-hunter-again="${UNIT}"]`).first().click({ timeout: WAIT_MS });
  if (!(await until(page, () => posted("reopen").length === 1))) return broken("Hunt it again sent no POST /hunts/reopen");
  const reopen = posted("reopen")[0].body ?? {};
  if (reopen.hunt !== "code" || reopen.project !== "Case project" || reopen.unit !== UNIT) {
    return broken(`Hunt it again posted ${JSON.stringify(reopen)}, not { hunt: "code", project: "Case project", unit: "${UNIT}" }`);
  }
  const refused = section.locator("[data-hunter-again-refused]").first();
  if (!(await until(page, async () => ((await refused.textContent().catch(() => "")) ?? "").includes("he case refuses this reopen"), 5000))) {
    return broken("a 409 on Hunt it again is not said beside its unit");
  }

  // A hunts part that did not answer: its sentence and no press.
  part = { ok: false, error: "dispatcher hunt status did not answer for this case" };
  bus.dispatcherFrame();
  const unread = page.locator('[data-dashboard-hunters="unread"]').first();
  if (!(await unread.waitFor({ timeout: WAIT_MS }).then(() => true, () => false))) return broken("a hunts part of ok: false draws no unread hunters section");
  if (!((await unread.textContent()) ?? "").includes("did not answer for this case")) return broken("the unread hunters section does not say the part's error");
  if ((await page.locator("[data-hunters-press], [data-hunter-again]").count()) > 0) return broken("a hunts part of ok: false still draws the section's presses");

  return held("the route's hunter drawn, no stand-in; night posted no minutes, CLOSED and STOPPED lines said nothing, tonight-opens-nothing and each 409 said; stop posted no now; reopen named Case project; ok: false drew only its sentence");
});
