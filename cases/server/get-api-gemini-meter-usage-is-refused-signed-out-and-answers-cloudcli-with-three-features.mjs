// protects: server/index.ts, server/modules/gemini-meter/
// writes: none
//
// CloudCLI's own Gemini meter is mounted behind sign-in on the running server: GET /api/gemini-meter/usage?range=today
// with no token is refused 401; with the checks token it answers 200, project "cloudcli", exactly the three CloudCLI
// features, and every key row carries a key of four characters (the last four, never the key) held as "house" or
// "account"; range=year answers 400. Read only: no switch is pressed on the live server.

import { api, apiWithNoToken } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

const ROUTE = "/api/gemini-meter/usage";
const FEATURES = ["backup_transcription", "companion_speech", "read_aloud"];
const HOLDERS = new Set(["house", "account"]);

runCase(async () => {
  const signedOut = await apiWithNoToken(ROUTE + "?range=today", { judge401: false });
  if (signedOut.status !== 401) return broken("GET " + ROUTE + " with no token answered " + signedOut.status + ", not 401");
  const today = await api(ROUTE + "?range=today");
  if (today.status !== 200) return broken("GET " + ROUTE + "?range=today with the checks token answered " + today.status + " — " + String(today.text ?? "").slice(0, 160));
  const body = today.json ?? {};
  const wrong = [];
  if (body.project !== "cloudcli") wrong.push("project reads " + JSON.stringify(body.project));
  const listed = (Array.isArray(body.features) ? body.features : []).map((f) => f?.feature).sort().join(",");
  if (listed !== FEATURES.join(",")) wrong.push("features listed " + listed + ", not the three");
  const keys = Array.isArray(body.keys) ? body.keys : null;
  if (!keys) wrong.push("keys is not a list");
  for (const k of keys ?? []) {
    if (typeof k?.key !== "string" || k.key.length !== 4) wrong.push("a key row carries key " + JSON.stringify(String(k?.key).slice(0, 6) + "…") + " of length " + String(k?.key ?? "").length);
    if (!Array.isArray(k?.held_as) || k.held_as.some((h) => !HOLDERS.has(h))) wrong.push("a key row is held as " + JSON.stringify(k?.held_as));
  }
  const year = await api(ROUTE + "?range=year");
  if (year.status !== 400) wrong.push("range=year answered " + year.status + ", not 400");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("401 signed out; today: project cloudcli, features " + listed + ", " + keys.length + " key rows of four characters; range=year 400");
});
