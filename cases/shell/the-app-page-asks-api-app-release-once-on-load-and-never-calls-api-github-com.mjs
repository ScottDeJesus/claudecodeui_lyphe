// protects: src/shared/hooks/useVersionCheck.ts, src/shared/api.ts, server/modules/app-release/app-release.module.ts
// writes: none
// The browser no longer asks GitHub for the newest release: every tab reads the server's one reading, GET
// /api/app-release, once when the page loads (the sidebar, the About tab and the wheel's mark share it), and every
// later reading arrives as app_release_state. A page reloaded in the dev app is watched for twenty seconds: a request
// to api.github.com, or more or fewer than one read of the route, reads BROKEN.

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

const WATCH_MS = 20_000;

runCase(async (t) => {
  const page = await withPage(t);
  const seen = [];
  page.on("request", (request) => {
    try { seen.push(new URL(request.url())); } catch { /* not a URL this case reads */ }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(WATCH_MS);
  const github = seen.filter((url) => url.host === "api.github.com");
  if (github.length > 0) return broken("the page asked api.github.com " + github.length + " time(s): " + github.map((url) => url.pathname).join(", "));
  const release = seen.filter((url) => url.pathname === "/api/app-release");
  if (release.length !== 1) return broken("the page asked GET /api/app-release " + release.length + " times in " + WATCH_MS / 1000 + " s after a reload, not once");
  return held("a reloaded page asked /api/app-release once and api.github.com never in " + WATCH_MS / 1000 + " s (" + seen.length + " requests)");
});
