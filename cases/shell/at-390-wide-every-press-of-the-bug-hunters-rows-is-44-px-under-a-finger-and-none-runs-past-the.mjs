// protects: src/modules/settings/tabs/agents-settings/sections/content/RunnerBugHuntersRow.tsx, src/modules/settings/tabs/agents-settings/sections/content/RunnerModelContent.tsx
// writes: none
//
// Under a finger every press the bug hunters rows add is 44 px (INV-10275, bug-hunters seam 11), and at 390 wide the rows
// stack: no control runs past the screen. A press is MEASURED BY HIT TEST, not by its box: at the control's centre x the
// case walks up and down from its centre until `elementFromPoint` lands on something that is neither the control, inside
// it, nor a label for it. A `::before` that reaches past a 30 px switch counts, as it does for a finger; a padded wrapper
// that does nothing when pressed does not. The kit's Switch is 52x30 with no hit area of its own (verve/controls.css),
// so each of the rows' six switches needs one.
//
// Nothing is pressed; every hunts write is refused by the page.

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { openAgents } from "../lib/agents_settings.mjs";
import { guardHunts, huntersRegion, pressHeights, waitForNightly } from "../lib/bug_hunters_settings.mjs";

const FINGER_PX = 43.5; // 44 px, less the half pixel a layout may round away
const WIDTH = 390;

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: WIDTH, height: 844 } });
  const guard = await guardHunts(page);
  await openAgents(page);
  if (!(await waitForNightly(page))) return broken("Settings → Agents at 390 wide draws no bug hunters rows (no switch \"Run the bug hunters nightly\")");
  const region = await huntersRegion(page);
  if (!region.found) return broken("the nightly switch is not among the window's visible controls");
  if (region.controls.length < 9) return broken(`the hunters rows hold ${region.controls.length} controls at 390 wide; the nightly switch, the start, two numbers, five hunter switches and the turns list are at least 9`);

  const heights = await pressHeights(page, region.controls.map((c) => c.i));
  const short = heights.filter((h) => h.height < FINGER_PX);
  if (short.length > 0) {
    return broken(`${short.length} of ${heights.length} presses are under 44 px at 390 wide: ${short.slice(0, 6).map((h) => `${h.name || h.row.slice(0, 30)} ${h.height} px`).join("; ")}`);
  }
  const after = await huntersRegion(page);
  const wide = (after.controls ?? []).filter((c) => c.rect.x < -0.5 || c.rect.x + c.rect.w > WIDTH + 0.5);
  if (wide.length > 0) return broken(`at 390 wide ${wide.length} control(s) reach past the screen: ${wide.slice(0, 4).map((c) => `${c.name || c.row.slice(0, 30)} ${Math.round(c.rect.x)}..${Math.round(c.rect.x + c.rect.w)}`).join("; ")}`);
  if (guard.writes.length > 0) return broken(`measuring the rows wrote ${JSON.stringify(guard.writes)}`);
  return held(`${heights.length} presses of the hunters rows at 390 wide, the shortest ${Math.min(...heights.map((h) => h.height))} px; none past the screen; no write`);
});
