// protects: src/modules/accounts/hooks/useClaudeAccounts.ts, src/shared/hooks/useServerFrame.ts, server/modules/accounts/accounts-lanes.ts
// writes: none
//
// pollers-hooks--client-pushes, seam 8: the account picture is read on mount and again only when the server says
// accounts_changed (or the socket reconnects), never on a clock. The app opens signed in with the checks token; across
// a minute in which the door's account files are not written, no GET /api/accounts reaches the server. A write to
// those files during the minute makes a read there the frame's, so the case cannot judge and says so.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withPage } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const ACCOUNT_HOME = path.join(os.homedir(), ".claude", "state", "claude_account");
const WATCHED_MS = 63000;
const stamp = () =>
  ["accounts.json", "chosen.json"]
    .map((name) => { try { return fs.statSync(path.join(ACCOUNT_HOME, name)).mtimeMs; } catch { return 0; } })
    .join(",");

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  const asks = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") return;
    if (new URL(request.url()).pathname === "/api/accounts") asks.push(Date.now());
  });
  await page.waitForTimeout(3000);
  const before = stamp();
  const from = asks.length;
  await page.waitForTimeout(WATCHED_MS);
  if (stamp() !== before) return cannotRun("the door's account files were written during the minute, so a read then answers accounts_changed, not a clock");
  const later = asks.length - from;
  if (later > 0) return broken(later + " GET /api/accounts reached the server across 63 s with the account files unmoved: the picture is still read on a clock");
  return held("no GET /api/accounts across 63 s with the account files unmoved");
});
