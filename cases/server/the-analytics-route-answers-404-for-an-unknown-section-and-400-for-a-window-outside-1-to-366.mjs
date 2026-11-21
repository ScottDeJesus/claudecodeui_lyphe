// The service judges every question before any reader runs: an id no reader holds is a 404
// ANALYTICS_SECTION_UNKNOWN (an inherited name such as `constructor` too), and a window that is not one whole
// number from 1 to 366 is a 400 ANALYTICS_DAYS_INVALID, in the app's error envelope { success: false, error: { code } }.
//
// protects: server/index.ts, server/modules/analytics/
// writes: none

import { api } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

const BASE = "/api/analytics";
const UNKNOWN = ["nope", "constructor"];
const WINDOWS = ["0", "367", "7.5", "-3", "1e2", "abc", "30abc", "7&days=8"];

const said = (r) => r.json?.error?.code ?? String(r.text ?? "").slice(0, 80);

runCase(async () => {
  const wrong = [];
  for (const id of UNKNOWN) {
    const r = await api(`${BASE}/${id}?days=30`);
    if (r.status !== 404 || r.json?.error?.code !== "ANALYTICS_SECTION_UNKNOWN") {
      wrong.push(`GET ${BASE}/${id} answered ${r.status} ${said(r)}, not 404 ANALYTICS_SECTION_UNKNOWN`);
    }
  }
  for (const w of WINDOWS) {
    const r = await api(`${BASE}/code-mode?days=${w}`);
    if (r.status !== 400 || r.json?.error?.code !== "ANALYTICS_DAYS_INVALID") {
      wrong.push(`GET ${BASE}/code-mode?days=${w} answered ${r.status} ${said(r)}, not 400 ANALYTICS_DAYS_INVALID`);
    }
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`404 ANALYTICS_SECTION_UNKNOWN for ${UNKNOWN.join(", ")}; 400 ANALYTICS_DAYS_INVALID for days ${WINDOWS.join(", ")}`);
});
