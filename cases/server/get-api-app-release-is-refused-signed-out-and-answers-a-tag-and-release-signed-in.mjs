// The newest release is the server's to read: GET /api/app-release is behind sign-in, refused 401 with no token, and
// with the checks token answers the lane's landed reading, { tag, release } — GitHub's tag beside the release's title,
// notes, link and date, or both null when the repository has published none. A 503 is the server saying it has not
// read GitHub yet (GitHub unreachable from this host), which is never a finding.
//
// protects: server/index.ts, server/modules/app-release/, server/modules/auth/auth.middleware.ts
// writes: none

import { api, apiWithNoToken } from "../lib/app.mjs";
import { broken, CannotRun, held, runCase } from "../lib/case.mjs";

const ROUTE = "/api/app-release";

runCase(async () => {
  const signedOut = await apiWithNoToken(ROUTE, { judge401: false });
  if (signedOut.status !== 401) return broken("GET " + ROUTE + " with no token answered " + signedOut.status + ", not 401");
  const signedIn = await api(ROUTE, { judge503: false });
  if (signedIn.status === 503) throw new CannotRun("GET " + ROUTE + " answered 503: the server has not read GitHub yet");
  if (signedIn.status !== 200) return broken("GET " + ROUTE + " with the checks token answered " + signedIn.status + ", not 200");
  const body = signedIn.json;
  if (body === null || typeof body !== "object") return broken("GET " + ROUTE + " answered 200 with a body that is not a JSON object");
  const keys = Object.keys(body).sort().join(",");
  if (keys !== "release,tag") return broken("GET " + ROUTE + " answered the keys " + (keys || "(none)") + ", not tag and release");
  if (body.tag === null) {
    if (body.release !== null) return broken("a null tag came beside a release " + JSON.stringify(body.release));
    return held("GET " + ROUTE + ": 401 with no token; 200 with the checks token and no published release (both null)");
  }
  if (typeof body.tag !== "string" || body.tag.length === 0) return broken("the tag is " + JSON.stringify(body.tag) + ", not a string");
  const release = body.release;
  if (release === null || typeof release !== "object" || typeof release.title !== "string" || typeof release.htmlUrl !== "string") {
    return broken("the tag " + body.tag + " came beside a release with no title or htmlUrl: " + JSON.stringify(release));
  }
  return held("GET " + ROUTE + ": 401 with no token; 200 with the checks token, newest tag " + body.tag);
});
