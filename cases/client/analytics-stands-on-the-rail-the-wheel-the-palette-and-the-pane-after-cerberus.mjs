// protects: src/shared/types.ts, src/modules/project-workspace/hooks/useProjectsState.ts, src/modules/project-workspace/hooks/useWorkspaceViews.ts, src/modules/project-workspace/context/PlacesContext.tsx, src/modules/project-workspace/ProjectCommandPalette.tsx, src/modules/project-workspace/WorkspaceMain.tsx
// writes: none
//
// Analytics is a place, laid out as MAN-7866 lays out a rail view (analytics-code-mode, interface H): AppTab gains
// 'analytics' directly after 'cerberus' and PlaceId gains it; VALID_TABS holds it, so a stored tab restores; HOUSE_VIEWS
// carries it directly after Cerberus with a lucide chart glyph no other view or place wears and the keywords the plan
// wrote; the wheel's SCREEN_PLACES stands it on the outer ring and its places list picks it; the palette lists it with
// the places; and WorkspaceMain draws AnalyticsPanel, from the module's barrel, ungated, in an h-full overflow-hidden box.
//
// Read as source, each piece by the shape it is written in today; a reshaped declaration is a change to how this case
// finds it, never to what it checks.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const W = "src/modules/project-workspace/";
const KEYWORDS = "analytics stats statistics numbers code mode trends";
const literals = (text) => Array.from(text.matchAll(/'([^']+)'/g), (m) => m[1]);
const body = (text, pattern) => {
  const found = text.match(pattern);
  return found ? found[1] : null;
};

runCase(async () => {
  const files = ["src/shared/types.ts", W + "hooks/useProjectsState.ts", W + "hooks/useWorkspaceViews.ts", W + "context/PlacesContext.tsx", W + "ProjectCommandPalette.tsx", W + "WorkspaceMain.tsx"];
  let texts;
  try {
    texts = await Promise.all(files.map((file) => readFile(path.join(REPO, file), "utf8")));
  } catch (error) {
    return broken("a file of the place is not on disk: " + String(error.message).split("\n")[0]);
  }
  const [types, state, views, places, palette, main] = texts;
  const wrong = [];

  const tabs = literals(body(types, /export type AppTab =([^;]+);/) ?? "");
  const at = tabs.indexOf("analytics");
  if (at === -1) wrong.push("AppTab has no 'analytics'");
  else if (tabs[at - 1] !== "cerberus") wrong.push("AppTab's 'analytics' follows " + JSON.stringify(tabs[at - 1]) + ", not 'cerberus'");
  if (!literals(body(types, /export type PlaceId =([^;]+);/) ?? "").includes("analytics")) wrong.push("PlaceId has no 'analytics'");
  if (!literals(body(state, /const VALID_TABS[^=]*=\s*new Set(?:<[^>]*>)?\(\[([^\]]*)\]/) ?? "").includes("analytics")) wrong.push("VALID_TABS has no 'analytics'");

  const house = body(views, /const HOUSE_VIEWS[^=]*=\s*\[([\s\S]*?)\n\];/);
  const entries = house ? Array.from(house.matchAll(/\{\s*id:\s*'([^']+)'([^}]*)\}/g), (m) => ({ id: m[1], rest: m[2] })) : [];
  const index = entries.findIndex((entry) => entry.id === "analytics");
  let icon = null;
  if (index === -1) wrong.push("HOUSE_VIEWS has no analytics entry");
  else {
    const entry = entries[index];
    if (index === 0 || entries[index - 1].id !== "cerberus") wrong.push("HOUSE_VIEWS' analytics entry follows " + JSON.stringify(index > 0 ? entries[index - 1].id : null) + ", not cerberus");
    icon = body(entry.rest, /icon:\s*(\w+)/);
    if (!icon || !/Chart/.test(icon)) wrong.push("its icon is " + JSON.stringify(icon) + ", not a lucide chart glyph");
    else {
      const worn = views.split(new RegExp("icon:\\s*" + icon + "\\b")).length - 1;
      if (worn !== 1) wrong.push(icon + " is worn by " + worn + " views");
      if (new RegExp("\\b" + icon + "\\b").test(places)) wrong.push(icon + " is worn by a place in PlacesContext.tsx too");
      if (!new RegExp("import \\{[^}]*\\b" + icon + "\\b[^}]*\\} from 'lucide-react'").test(views)) wrong.push(icon + " is not imported from lucide-react");
    }
    const words = body(entry.rest, /keywords:\s*'([^']*)'/);
    if (words !== KEYWORDS) wrong.push("its keywords are " + JSON.stringify(words));
    if (!/group:\s*'house'/.test(entry.rest)) wrong.push("its group is not 'house'");
  }

  const screens = body(places, /const SCREEN_PLACES[^=]*=\s*\[([\s\S]*?)\n\];/) ?? "";
  if (!/\{\s*id:\s*'analytics',\s*tab:\s*'analytics',\s*ring:\s*'outer'\s*\}/.test(screens)) wrong.push("SCREEN_PLACES has no { id: 'analytics', tab: 'analytics', ring: 'outer' }");
  if (!/\.\.\.pick\('analytics'\)/.test(places)) wrong.push("the wheel's places list does not pick('analytics')");
  if (!literals(body(palette, /const PLACE_VIEWS[^=]*=\s*new Set(?:<[^>]*>)?\(\[([^\]]*)\]/) ?? "").includes("analytics")) wrong.push("PLACE_VIEWS has no 'analytics'");
  if (!/\{\s*activeTab === 'analytics' && \(\s*<div className="h-full overflow-hidden">\s*<AnalyticsPanel\s*\/>\s*<\/div>\s*\)\s*\}/.test(main)) wrong.push("WorkspaceMain does not draw activeTab === 'analytics' as an ungated <div className=\"h-full overflow-hidden\"><AnalyticsPanel /></div>");
  if (!/import\s*\{[^}]*\bAnalyticsPanel\b[^}]*\}\s*from\s*'@\/modules\/analytics'/.test(main)) wrong.push("WorkspaceMain does not take AnalyticsPanel from '@/modules/analytics'");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("analytics follows cerberus in AppTab and HOUSE_VIEWS (" + icon + ", worn once), is a PlaceId and a valid tab, an outer screen place picked into the wheel, a palette place, and an ungated pane");
});
