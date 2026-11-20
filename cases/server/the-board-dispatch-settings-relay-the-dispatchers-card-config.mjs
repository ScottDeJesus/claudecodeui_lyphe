// The running server mounts the board-dispatch module behind sign-in: GET /api/kanban-dispatch/settings relays
// `dispatcher card config` (200 with its width and threshold for the checks token, 401 with none).
//
// Read only: the settings are read, never written.
//
// protects: server/index.ts, server/modules/kanban-dispatch/
// writes: none

import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { api, apiWithNoToken } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const SETTINGS = "/api/kanban-dispatch/settings";

runCase(async () => {
  let config;
  try {
    const out = execFileSync(path.join(os.homedir(), ".claude", "scripts", "dispatcher"), ["card", "config", "--json"], {
      encoding: "utf8",
      timeout: 30000,
      cwd: os.homedir(),
    });
    config = JSON.parse(out);
  } catch (error) {
    return cannotRun(`dispatcher card config --json did not answer: ${String(error?.message ?? error).split("\n")[0]}`);
  }

  const wrong = [];
  const signedOut = await apiWithNoToken(SETTINGS, { judge401: false });
  if (signedOut.status !== 401) wrong.push(`GET ${SETTINGS} with no token answered ${signedOut.status}, not 401`);
  const signedIn = await api(SETTINGS);
  if (signedIn.status !== 200) wrong.push(`GET ${SETTINGS} answered ${signedIn.status}, not 200`);
  else if (signedIn.json?.width !== config.width || signedIn.json?.threshold !== config.threshold) {
    wrong.push(`GET ${SETTINGS} answered ${JSON.stringify(signedIn.json)}, not width ${config.width} and threshold ${config.threshold} as the dispatcher prints`);
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`${SETTINGS}: 401 signed out, 200 with width ${config.width} and threshold ${config.threshold}`);
});
