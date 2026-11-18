// A browser holding the checks token opens the app at its bare root and lands on the sessions home, signed in: the
// address moves to /home (useHeldWorkspace.ts replaces a bare `/` once, at the mount) and the home is the page on
// screen, its board of chats and Kaylee's core at its foot drawn over the held workspace.
//
// protects: src/modules/project-workspace/hooks/useHeldWorkspace.ts, src/modules/project-workspace/home/, src/modules/project-workspace/ProjectWorkspaceShell.tsx, src/modules/project-workspace/ProjectWorkspaceRoute.tsx, src/shared/context/StationLayerContext.tsx, src/shared/ui/HeldPage.tsx, src/modules/sidebar/board/SessionsBoard.tsx, src/App.tsx, src/shared/constants.ts, src/modules/auth/, src/shared/authToken.ts
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

// Read off the live page 2026-11-18. Each is a data attribute the source sets, so the home is found without its
// words in any one language.
const HOME_PATH = "/home"; // src/shared/constants.ts, SESSIONS_HOME_PATH
const HOME = "[data-workspace-home]"; // WorkspaceHome.tsx's root
const BOARD = `${HOME} [data-sessions-board]`; // SessionsBoard.tsx: the chats by folder, or its empty state inside it
const CORE = `${HOME} [data-home-core]`; // WorkspaceHome.tsx: Kaylee's core docked at the foot
const FOLDER = "[data-board-folder]"; // BoardFolder.tsx: one column per folder, counted for the held line
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

/** True once the page's address is `HOME_PATH`; false when it never was within `WAIT_MS`. */
async function arrivesHome(page) {
  try {
    await page.waitForURL((url) => url.pathname === HOME_PATH, { timeout: WAIT_MS });
    return true;
  } catch (error) {
    if (error.name !== "TimeoutError") throw error;
    return false;
  }
}

runCase(async (t) => {
  // The bare root of the dev server, signed in: any other screen has ended the case CANNOT RUN.
  const page = await withPage(t, { viewport: DESKTOP });
  const seconds = WAIT_MS / 1000;

  if (!(await arrivesHome(page))) {
    const at = new URL(page.url());
    return broken(`opened at the bare root, the app never moved to ${HOME_PATH} in ${seconds} s — it stood at ${at.pathname}${at.search}${at.hash}`);
  }
  if (!(await appears(page.locator(HOME)))) {
    return broken(`the address is ${HOME_PATH} but the sessions home was never on screen in ${seconds} s`);
  }
  if (!(await appears(page.locator(BOARD)))) {
    return broken(`the sessions home is on screen but its board of chats was never drawn in ${seconds} s`);
  }
  if (!(await appears(page.locator(CORE)))) {
    return broken(`the sessions home and its board are drawn but Kaylee's core never stood at its foot in ${seconds} s`);
  }
  const folders = await page.locator(BOARD).locator(FOLDER).count();
  return held(`opened at the bare root with the checks token, the app landed signed in on ${HOME_PATH}: the home's board (${folders} folder columns) and Kaylee's core are on screen`);
});
