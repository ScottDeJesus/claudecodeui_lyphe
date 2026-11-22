// protects: src/shared/types.ts, src/modules/project-workspace/hooks/useProjectsState.ts, src/modules/project-workspace/hooks/useWorkspaceViews.ts, src/modules/project-workspace/context/PlacesContext.tsx, src/modules/project-workspace/ProjectCommandPalette.tsx, src/modules/project-workspace/WorkspaceMain.tsx, src/modules/i18n/locales/en/common.json, src/App.tsx
// writes: none
//
// R&D is a place (rnd-area phase 6, interface G's registration): 'rnd' joins AppTab and PlaceId; VALID_TABS holds it, so a
// stored tab restores; PLACE_VIEWS lists it in the palette; SCREEN_PLACES stands it on the outer ring and the places list picks
// it before cerberus; the views list carries it with the lucide FlaskConical and the label key tabs.rnd, which reads R&D in en;
// WorkspaceMain draws the lazy RndTab from the module's barrel; App.tsx mounts RndFeed, so the wheel's mark is lit from any page.
//
// Read as source, each piece by the shape it is written in today; a reshaped declaration is a change to how this case finds
// it, never to what it checks.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);

const W = "src/modules/project-workspace/";
const literals = (text) => Array.from(text.matchAll(/'([^']+)'/g), (m) => m[1]);
const body = (text, pattern) => {
  const found = text.match(pattern);
  return found ? found[1] : null;
};

runCase(async () => {
  const files = ["src/shared/types.ts", W + "hooks/useProjectsState.ts", W + "hooks/useWorkspaceViews.ts", W + "context/PlacesContext.tsx", W + "ProjectCommandPalette.tsx", W + "WorkspaceMain.tsx", "src/modules/i18n/locales/en/common.json", "src/App.tsx"];
  let texts;
  try {
    texts = await Promise.all(files.map((file) => readFile(path.join(REPO, file), "utf8")));
  } catch (error) {
    return broken("a file of the place is not on disk: " + String(error.message).split("\n")[0]);
  }
  const [types, state, views, places, palette, main, common, app] = texts;
  const wrong = [];
  if (!literals(body(types, /export type AppTab =([^;]+);/) ?? "").includes("rnd")) wrong.push("AppTab has no 'rnd'");
  if (!literals(body(types, /export type PlaceId =([^;]+);/) ?? "").includes("rnd")) wrong.push("PlaceId has no 'rnd'");
  if (!literals(body(state, /const VALID_TABS[^=]*=\s*new Set(?:<[^>]*>)?\(\[([^\]]*)\]/) ?? "").includes("rnd")) wrong.push("VALID_TABS has no 'rnd'");
  if (!literals(body(palette, /const PLACE_VIEWS[^=]*=\s*new Set(?:<[^>]*>)?\(\[([^\]]*)\]/) ?? "").includes("rnd")) wrong.push("PLACE_VIEWS has no 'rnd'");
  const screens = body(places, /const SCREEN_PLACES[^=]*=\s*\[([\s\S]*?)\n\];/) ?? "";
  if (!/\{\s*id:\s*'rnd',\s*tab:\s*'rnd',\s*ring:\s*'outer'\s*\}/.test(screens)) wrong.push("SCREEN_PLACES has no { id: 'rnd', tab: 'rnd', ring: 'outer' }");
  const rndPick = places.indexOf("...pick('rnd')");
  const cerberusPick = places.indexOf("...pick('cerberus')");
  if (rndPick === -1) wrong.push("the wheel's places list does not pick('rnd')");
  else if (cerberusPick === -1 || rndPick > cerberusPick) wrong.push("pick('rnd') does not come before pick('cerberus')");
  const at = views.search(/\bid:\s*'rnd'/);
  if (at === -1) wrong.push("the views list has no rnd entry");
  else {
    const next = views.slice(at + 4).search(/\bid:\s*'/);
    const entry = views.slice(at, next === -1 ? at + 800 : at + 4 + next);
    if (!/icon:\s*FlaskConical\b/.test(entry)) wrong.push("the rnd view's icon is not FlaskConical");
    // The label key is the entry's own 'tabs.rnd', or the list's one rule that names each view tabs.<its id>.
    const byRule = /t\(\s*`tabs\.\$\{[\w.]*\bid\}`/.test(views) || /t\(\s*['"]tabs\.['"]\s*\+\s*[\w.]*\bid\b/.test(views);
    if (!/['"]tabs\.rnd['"]/.test(entry) && !byRule) wrong.push("the rnd view's label key is not tabs.rnd");
    if (!/import\s*\{[^}]*\bFlaskConical\b[^}]*\}\s*from\s*'lucide-react'/.test(views)) wrong.push("FlaskConical is not imported from lucide-react");
  }
  let label = null;
  try {
    label = JSON.parse(common)?.tabs?.rnd ?? null;
  } catch (error) {
    wrong.push("en common.json does not parse: " + String(error.message).split("\n")[0]);
  }
  if (label !== "R&D") wrong.push("en common.json's tabs.rnd reads " + JSON.stringify(label) + ", not R&D");
  if (!/activeTab === 'rnd' && \([\s\S]{0,400}?<RndTab\b/.test(main)) wrong.push("WorkspaceMain draws no RndTab for activeTab === 'rnd'");
  if (!/import\s*\{[^}]*\bRndTab\b[^}]*\}\s*from\s*'@\/modules\/rnd'/.test(main)) wrong.push("WorkspaceMain does not take RndTab from '@/modules/rnd'");
  if (!/<RndFeed\b/.test(app) || !/import\s*\{[^}]*\bRndFeed\b[^}]*\}\s*from\s*'@\/modules\/rnd'/.test(app)) wrong.push("App.tsx does not mount RndFeed from '@/modules/rnd'");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("rnd is an AppTab, a PlaceId, a valid tab and a palette place; an outer screen place picked before cerberus; a FlaskConical view labelled tabs.rnd = R&D; WorkspaceMain draws RndTab and App.tsx mounts RndFeed");
});
