// protects: src/modules/settings/tabs/agents-settings/sections/content/RunnerBugHuntersRow.tsx, src/modules/settings/hooks/useBugHunters.ts, src/shared/ui/sortable/useSortable.ts
// writes: none
//
// The bug hunters rows draw the five hunts as a list the operator reorders with the kit's sortable (`useSortable`,
// whose itemProps mark each item `data-sortable-item`), each hunter with one Switch for whether it takes a turn, and
// the projects of charters/hunts.toml as a SECOND such list (bug-hunters, seam 11). A hunter is found by its kind's
// word (security, behaviour, ui, data, code), a project by its name as the file holds it.
//
// Nothing is carried and nothing is pressed; every hunts write is refused by the page.

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { openAgents } from "../lib/agents_settings.mjs";
import { guardHunts, huntersRegion, KINDS, PROJECTS, waitForNightly } from "../lib/bug_hunters_settings.mjs";

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  const guard = await guardHunts(page);
  await openAgents(page);
  if (!(await waitForNightly(page))) return broken("Settings → Agents draws no bug hunters rows (no switch \"Run the bug hunters nightly\")");
  const region = await huntersRegion(page);
  if (!region.found) return broken("the nightly switch is not among the window's visible controls");

  const kindsDrawn = KINDS.filter((k) => region.hunters.some((h) => new RegExp(`\\b${k}\\b`, "i").test(h.text)));
  if (region.hunters.length !== 5 || kindsDrawn.length !== 5) {
    return broken(`the hunters are drawn as ${region.hunters.length} sortable item(s) naming ${JSON.stringify(kindsDrawn)}, not the five hunts as five`);
  }
  if (!region.huntersOneList) return broken("the five hunters are not items of one list");
  const lacking = region.hunters.filter((h) => h.switches !== 1);
  if (lacking.length > 0) return broken(`hunter item(s) ${JSON.stringify(lacking.map((h) => `${h.text.slice(0, 30)}: ${h.switches} switches`))} do not hold one switch`);

  const namesDrawn = PROJECTS.filter((p) => region.projects.some((item) => item.text.includes(p)));
  if (namesDrawn.length !== PROJECTS.length) return broken(`the projects' sortable list names ${JSON.stringify(namesDrawn)}, not the four of charters/hunts.toml`);
  if (!region.projectsOneList) return broken("the projects are not items of one list");
  if (!region.listsApart) return broken("the projects are items of the hunters' own list, not a second list");

  await page.waitForTimeout(800);
  if (guard.writes.length > 0) return broken(`drawing the lists wrote ${JSON.stringify(guard.writes)}`);
  return held(`five hunter items (${kindsDrawn.join(", ")}), one switch each, in one sortable list; the four projects in a second; no write`);
});
