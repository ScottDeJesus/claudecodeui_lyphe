// The Analytics area is behind sign-in and names its sections: GET /api/analytics with no token is refused 401,
// and with the checks token answers 200 { sections: [{ id }] }, every entry exactly one string id, code-mode among them.
//
// protects: server/index.ts, server/modules/analytics/, server/shared/analytics-types.ts
// writes: none

import { api, apiWithNoToken } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

const ROUTE = "/api/analytics";

runCase(async () => {
  const signedOut = await apiWithNoToken(ROUTE, { judge401: false });
  if (signedOut.status !== 401) return broken(`GET ${ROUTE} with no token answered ${signedOut.status}, not 401`);
  const signedIn = await api(ROUTE);
  if (signedIn.status !== 200) return broken(`GET ${ROUTE} with the checks token answered ${signedIn.status}, not 200`);
  const sections = signedIn.json?.sections;
  if (!Array.isArray(sections)) return broken(`GET ${ROUTE} answered no sections list — ${String(signedIn.text ?? "").slice(0, 200)}`);
  const odd = sections.filter((s) => s === null || typeof s !== "object" || typeof s.id !== "string" || Object.keys(s).length !== 1);
  if (odd.length > 0) return broken(`GET ${ROUTE} listed entries that are not one string id: ${JSON.stringify(odd).slice(0, 200)}`);
  const ids = sections.map((s) => s.id);
  if (!ids.includes("code-mode")) return broken(`GET ${ROUTE} listed ${JSON.stringify(ids)}, without code-mode`);
  return held(`GET ${ROUTE}: 401 with no token, 200 with the checks token listing ${JSON.stringify(ids)}`);
});
