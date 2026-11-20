// protects: src/modules/settings/tabs/agents-settings/sections/content/RunnerBugHuntersRow.tsx, src/modules/settings/tabs/agents-settings/sections/content/RunnerModelContent.tsx, src/modules/settings/hooks/useBugHunters.ts, src/modules/i18n/locales/en/settings.json
// writes: none
//
// Settings → Agents draws the bug hunters' rows (bug-hunters, seam 11) under the bug board's three rows: the switch
// "Run the bug hunters nightly", the night's start as an `Input type="time"`, the minutes a night as a typed number
// from 15 to 600 and the tickets a night from 1 to 50 (charters/hunts.toml's `minutes` and `tickets_per_night`).
// The bounds are the field's own (`min`/`max`) or said beside it in words; either way a reader can learn them.
//
// Every hunts write is refused by the page (lib/bug_hunters_settings.mjs), and the case presses nothing that writes.

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { openAgents } from "../lib/agents_settings.mjs";
import { guardHunts, huntersRegion, NIGHTLY_LABEL, waitForNightly } from "../lib/bug_hunters_settings.mjs";

const bounded = (control, lo, hi) =>
  (control.min === String(lo) && control.max === String(hi)) || new RegExp(`\\b${lo}\\s*(to|–|-|and)\\s*${hi}\\b`).test(control.row);

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  const guard = await guardHunts(page);
  await openAgents(page);
  if (!(await waitForNightly(page))) return broken(`Settings → Agents draws no switch named "${NIGHTLY_LABEL}"`);
  const region = await huntersRegion(page);
  if (!region.found) return broken(`the switch "${NIGHTLY_LABEL}" is not among the window's visible controls`);
  if (!region.afterBugBoard) return broken(`"${NIGHTLY_LABEL}" is not drawn under the bug board's rows ([data-runner-bug-board-age-days])`);

  const inputs = region.controls.filter((c) => c.tag === "input");
  const time = inputs.find((c) => c.type === "time");
  if (!time) return broken(`the hunters rows draw no time field for the start; their fields are ${JSON.stringify(inputs.map((c) => c.type || "text"))}`);
  const numbers = inputs.filter((c) => c.type !== "time");
  const named = (re) => numbers.find((c) => re.test(c.name)) ?? numbers.find((c) => re.test(c.row) && !numbers.some((o) => o !== c && re.test(o.name)));
  const minutes = named(/minute/i);
  const tickets = named(/ticket/i);
  if (!minutes) return broken(`no field of the hunters rows is named for the minutes a night (${JSON.stringify(numbers.map((c) => c.name || c.row.slice(0, 40)))})`);
  if (!tickets) return broken(`no field of the hunters rows is named for the tickets a night (${JSON.stringify(numbers.map((c) => c.name || c.row.slice(0, 40)))})`);
  if (minutes === tickets) return broken("the minutes and the tickets a night are one field");
  if (!bounded(minutes, 15, 600)) return broken(`the minutes-a-night field says no bounds of 15 to 600 (min ${minutes.min}, max ${minutes.max}, beside "${minutes.row.slice(0, 120)}")`);
  if (!bounded(tickets, 1, 50)) return broken(`the tickets-a-night field says no bounds of 1 to 50 (min ${tickets.min}, max ${tickets.max}, beside "${tickets.row.slice(0, 120)}")`);

  await page.waitForTimeout(800);
  if (guard.writes.length > 0) return broken(`drawing the hunters rows wrote ${JSON.stringify(guard.writes)}`);
  return held(`"${NIGHTLY_LABEL}" under the bug board rows; start a time field (${time.value}); minutes ${minutes.min ?? "?"}–${minutes.max ?? "?"}, tickets ${tickets.min ?? "?"}–${tickets.max ?? "?"}; no write`);
});
