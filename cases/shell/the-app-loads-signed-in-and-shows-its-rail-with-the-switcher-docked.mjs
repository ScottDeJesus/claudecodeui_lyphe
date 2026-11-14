// A browser holding the checks token loads the app signed in: the views rail is drawn, and the app
// switcher's disc sits docked inside it, the place AppSwitcherDock holds open in the rail's top cell.
//
// protects: src/modules/app-switcher/, src/modules/project-workspace/WorkspaceRail.tsx, src/modules/project-workspace/RailButton.tsx, src/modules/auth/, src/shared/authToken.ts, src/shared/ui/DockableFab.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

// Read off the live page 2026-11-14. A rail button carries its view's id untranslated (RailButton.tsx's
// `data-view-id`), so the rail is found without its name in any one language.
const RAIL = 'nav:has(button[data-view-id="chat"])';
// The switcher's disc and not the companion's, which is a second `.vv-fab` (src/shared/constants.ts, FAB_SELECTOR).
const SWITCHER_DISC = ".vv-fab:not([data-companion-fab] .vv-fab)";
const DOCKED = "vv-fab--docked"; // DockableFab.tsx draws it while the disc is in its dock
// Wide enough that a browser with no stored position starts the disc docked (appSwitcherStorage.ts).
const DESKTOP = { width: 1440, height: 900 };
const WAIT_MS = 30000;

/** True once `locator` is visible; false when it never was within `WAIT_MS`. */
async function appears(locator) {
  try {
    await locator.waitFor({ state: "visible", timeout: WAIT_MS });
    return true;
  } catch (error) {
    if (error.name !== "TimeoutError") throw error;
    return false;
  }
}

runCase(async (t) => {
  const page = await withPage(t, { viewport: DESKTOP }); // past the boot screen, and not the sign-in screen
  const seconds = WAIT_MS / 1000;

  const rail = page.locator(RAIL);
  if (!(await appears(rail))) {
    const heading = (await page.locator("h1").first().textContent({ timeout: 1000 }).catch(() => null)) ?? "no heading";
    return broken(`signed in, the app drew no views rail in ${seconds} s — the page showed: ${heading.trim()}`);
  }
  const railButtons = await rail.locator("button[data-view-id]").count();

  const disc = page.locator(SWITCHER_DISC);
  if (!(await appears(disc))) return broken(`the rail is drawn but the app switcher's disc never appeared in ${seconds} s`);
  if (!(await appears(page.locator(`${SWITCHER_DISC}.${DOCKED}`)))) {
    return broken(`the app switcher's disc is drawn but not docked: a new ${DESKTOP.width}px-wide browser never gave it ${DOCKED} in ${seconds} s`);
  }

  const railBox = await rail.boundingBox();
  const discBox = await disc.boundingBox();
  if (railBox === null || discBox === null) return broken("the rail or the docked disc has no box on the page");
  const discCentre = { x: discBox.x + discBox.width / 2, y: discBox.y + discBox.height / 2 };
  const isInsideRail =
    discCentre.x >= railBox.x && discCentre.x <= railBox.x + railBox.width &&
    discCentre.y >= railBox.y && discCentre.y <= railBox.y + railBox.height;
  if (!isInsideRail) {
    return broken(
      `the docked disc is drawn outside the rail: its centre is at ${Math.round(discCentre.x)},${Math.round(discCentre.y)} ` +
        `and the rail spans x ${Math.round(railBox.x)}–${Math.round(railBox.x + railBox.width)}, y ${Math.round(railBox.y)}–${Math.round(railBox.y + railBox.height)}`,
    );
  }
  return held(
    `signed in with the checks token, the app drew its views rail (${railButtons} view buttons) with the switcher's disc docked in it ` +
      `at ${Math.round(discCentre.x)},${Math.round(discCentre.y)}`,
  );
});
