// protects: src/modules/settings/hooks/useBugHunters.ts, src/modules/settings/hooks/bugHuntersWire.ts, src/modules/settings/tabs/agents-settings/sections/content/RunnerBugHuntersRow.tsx, src/modules/settings/tabs/agents-settings/sections/content/RunnerBugHuntersSetting.tsx, src/modules/settings/tabs/agents-settings/sections/content/RunnerBugHuntersList.tsx, server/modules/kanban-dispatch/kanban-dispatch.hunts.ts
// writes: none
//
// Each control of the bug hunters rows writes its own field through `PUT /api/kanban-dispatch/hunts/settings`, in the
// names that route takes (kanban-dispatch.hunts.ts SETTING_KEYS: nightly, start, minutes, ticketsPerNight, order,
// projects, turns), one field to a body; a hunter's turn switch and its move both write `order`, a project's move writes
// `projects`, and a blank typed draft writes nothing (bug-hunters phase 17). Every PUT is answered with the config it
// would leave (lib/bug_hunters_answer.mjs applyPut), so each act starts from the answer of the one before, and the rows
// must draw that answer. Nothing reaches the dispatcher.

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { openAgents, until } from "../lib/agents_settings.mjs";
import { answerHunts, huntersDrawn, ROW, shippedConfig, typeAndLeave } from "../lib/bug_hunters_answer.mjs";

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  const hunts = await answerHunts(page, { get: () => ({ status: 200, body: shippedConfig() }) });
  await openAgents(page);
  const win = page.locator(".modal-backdrop");
  const nightly = win.getByRole("switch", { name: "Run the bug hunters nightly" }).first();
  if (!(await until(async () => (await nightly.count()) > 0, 10000))) return broken("Settings → Agents draws no nightly switch");

  const said = [];
  // One act, then the one PUT it must send: exactly `want`, or nothing at all when `want` is null.
  const act = async (what, doIt, want) => {
    const before = hunts.writes().length;
    await doIt();
    if (want === null) {
      await page.waitForTimeout(900);
      const extra = hunts.writes().slice(before);
      return extra.length === 0 ? null : `${what} sent ${JSON.stringify(extra.map((w) => w.body))}; it should send nothing`;
    }
    const sent = await until(async () => hunts.writes()[before], 6000);
    if (!sent) return `${what} sent no write`;
    if (sent.method !== "PUT" || !sent.path.endsWith("/hunts/settings")) return `${what} sent ${sent.method} ${sent.path}`;
    if (JSON.stringify(sent.body) !== JSON.stringify(want)) return `${what} sent ${JSON.stringify(sent.body)}, not ${JSON.stringify(want)}`;
    await page.waitForTimeout(300);
    const more = hunts.writes().slice(before + 1);
    if (more.length > 0) return `${what} sent ${more.length + 1} writes: ${JSON.stringify(hunts.writes().slice(before).map((w) => w.body))}`;
    said.push(Object.keys(want)[0]);
    return null;
  };

  const steps = [
    ["the nightly switch", () => nightly.click(), { nightly: true }],
    ["start 01:15", () => typeAndLeave(page, "runner-bug-hunters-start", "01:15"), { start: "01:15" }],
    ["minutes 90", () => typeAndLeave(page, "runner-bug-hunters-minutes", "90"), { minutes: 90 }],
    ["a blank tickets draft", () => typeAndLeave(page, "runner-bug-hunters-tickets", ""), null],
    ["tickets 20", () => typeAndLeave(page, "runner-bug-hunters-tickets", "20"), { ticketsPerNight: 20 }],
    ["Security's turn switch off", () => win.getByRole("switch", { name: "The Security hunter takes a turn" }).first().click(), { order: ["behaviour", "ui", "data", "code"] }],
    ["Behaviour's move down", () => win.getByRole("button", { name: /^Move Behaviour down\./ }).first().click(), { order: ["ui", "behaviour", "data", "code"] }],
    ["Restorly connector's move down", () => win.getByRole("button", { name: /^Move Restorly connector down\./ }).first().click(), { projects: ["Restorly app", "Restorly connector", "CloudCLI", "The house"] }],
    ["the turns list's One hunter at a time", async () => {
      await page.locator(`${ROW("turns")} .vv-select__trigger`).first().click();
      await page.getByRole("listbox").last().getByRole("option", { name: /One hunter at a time/ }).first().click();
    }, { turns: "hunter" }],
  ];
  for (const [what, doIt, want] of steps) {
    const wrong = await act(what, doIt, want);
    if (wrong) return broken(wrong);
  }

  const drawn = await huntersDrawn(page);
  const seen = {
    nightly: await nightly.getAttribute("aria-checked"),
    start: await win.locator("#runner-bug-hunters-start").first().inputValue(),
    minutes: await win.locator("#runner-bug-hunters-minutes").first().inputValue(),
    tickets: await win.locator("#runner-bug-hunters-tickets").first().inputValue(),
    taking: drawn.hunters.filter((h) => !h.out).map((h) => h.key),
    out: drawn.hunters.filter((h) => h.out).map((h) => h.key),
    projects: drawn.projects,
    turns: ((await page.locator(`${ROW("turns")} .vv-select__trigger`).first().textContent()) ?? "").replace(/\s+/g, " ").trim(),
  };
  const want = { nightly: "true", start: "01:15", minutes: "90", tickets: "20", taking: ["ui", "behaviour", "data", "code"], out: ["security"], projects: ["Restorly app", "Restorly connector", "CloudCLI", "The house"] };
  const off = Object.keys(want).filter((k) => JSON.stringify(seen[k]) !== JSON.stringify(want[k]));
  if (off.length > 0 || !/One hunter at a time/.test(seen.turns)) {
    return broken(`after the answers the rows draw ${JSON.stringify(seen)}; the last answer holds ${JSON.stringify(want)} and turns hunter`);
  }
  return held(`one PUT per act, each its one field (${said.join(", ")}); the turn switch and the move wrote order, the project move projects, a blank draft nothing; the rows drew each answer`);
});
