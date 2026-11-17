// The update report is behind sign-in: GET /api/claude-updates with no token is refused 401, and the same
// request carrying the checks token answers 200 with the report's `packages`.
//
// protects: server/index.ts, server/modules/claude-updates/, server/modules/auth/auth.middleware.ts
// writes: none

import { api, apiWithNoToken } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

const ROUTE = "/api/claude-updates";

runCase(async () => {
  // The one call whose 401 is the promise, so the door hands it back instead of ending the case.
  const signedOut = await apiWithNoToken(ROUTE, { judge401: false });
  if (signedOut.status !== 401) {
    return broken(`GET ${ROUTE} with no token answered ${signedOut.status}, not 401`);
  }

  const signedIn = await api(ROUTE);
  if (signedIn.status !== 200) {
    return broken(`GET ${ROUTE} with the checks token answered ${signedIn.status}, not 200`);
  }
  const report = signedIn.json;
  if (report === null || typeof report !== "object" || !("packages" in report)) {
    const got = report === null ? "a body that is not JSON" : `the keys ${Object.keys(report).join(", ") || "(none)"}`;
    return broken(`GET ${ROUTE} with the checks token answered 200 with no packages key — ${got}`);
  }
  return held(`GET ${ROUTE}: 401 with no token, 200 with a packages key with the checks token`);
});
