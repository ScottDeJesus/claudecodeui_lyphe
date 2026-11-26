// protects: server/index.ts, server/modules/gemini-usage/, server/shared/shadow-connector-lane.ts, server/shared/shadow-connector-lane-router.ts, /opt/shadow-connector/core/gemini_features/summary.py, /opt/shadow-connector/core/gemini_features/claude_login.py
// writes: none
//
// The gemini-usage lane is mounted behind sign-in on the running server and answers the connector's reading whole. GET
// /api/gemini-usage/usage?range=7d with no token is refused 401; with the checks token it answers 200 with exactly the
// fifteen top-level keys shadow-connector's door serves, claude_login among them (no envelope of this server's, nothing added or dropped);
// range=year is the lane's own 422 and /api/gemini-usage/nothing its own 404, neither forwarded. Read only: no switch is
// pressed. A 5xx carrying only the lane's { error } means the connector is down: that cannot run, never a finding.

import { api, apiWithNoToken } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const LANE = "/api/gemini-usage";
const KEYS = ["account_id", "range", "from", "to", "cost_basis", "total_usd", "production_usd", "budgets_usd", "projects", "days", "budgets", "keys", "processes", "unpriced_models", "claude_login"];

runCase(async () => {
  const signedOut = await apiWithNoToken(LANE + "/usage?range=7d", { judge401: false });
  if (signedOut.status !== 401) return broken("GET " + LANE + "/usage with no token answered " + signedOut.status + ", not 401");
  const wrong = [];
  const week = await api(LANE + "/usage?range=7d");
  const body = week.json;
  let projects = 0;
  if (week.status === 200) {
    const got = Object.keys(body ?? {}).sort().join(",");
    if (got !== [...KEYS].sort().join(",")) wrong.push("the 7d answer's keys are " + got + ", not the connector's fifteen");
    if (body?.range !== "7d") wrong.push("its range reads " + JSON.stringify(body?.range));
    if (!Array.isArray(body?.projects)) wrong.push("its projects is not a list");
    else projects = body.projects.length;
  } else if (week.status >= 500 && body && Object.keys(body).join(",") === "error") {
    return cannotRun("the lane could not reach shadow-connector (" + week.status + " " + body.error + ") — the connector is down, never a finding of the lane");
  } else {
    wrong.push("GET 7d answered " + week.status + " " + String(week.text ?? "").slice(0, 160));
  }
  const year = await api(LANE + "/usage?range=year");
  if (year.status !== 422 || typeof year.json?.error !== "string") wrong.push("range=year answered " + year.status + " " + String(year.text ?? "").slice(0, 120) + ", not the lane's 422");
  const nothing = await api(LANE + "/nothing");
  if (nothing.status !== 404 || nothing.json?.error !== "not a route of the gemini-usage lane") {
    wrong.push("/nothing answered " + nothing.status + " " + String(nothing.text ?? "").slice(0, 120) + ", not the lane's own 404");
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("401 signed out; 7d 200 with the connector's fifteen keys and no other (" + projects + " projects); range=year 422; /nothing 404 'not a route of the gemini-usage lane'");
});
