// api.schedulingReport.entry reads one entry whole: an authenticated GET to /api/scheduling-report/entries/<id>, the id
// encoded here so a caller passes it as it holds it and it stays ONE path segment — a slash, a `?` or a `#` in it can
// never reach another route of the lane or turn into a query.
//
// The browser globals api.ts reads are stubbed in this process before it loads. Nothing leaves the process.
//
// protects: src/shared/api.ts
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";

const TOKEN = "case-token-entry";
const PREFIX = "/api/scheduling-report/entries/";

runCase(async () => {
  const store = new Map<string, string>([["auth-token", TOKEN]]);
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  const seen: Array<{ url: string; method: string; authorization: string | null }> = [];
  (globalThis as any).fetch = async (url: string, init: RequestInit = {}) => {
    seen.push({ url: String(url), method: (init.method ?? "GET").toUpperCase(), authorization: new Headers(init.headers ?? {}).get("Authorization") });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };

  const { api } = await import("../../src/shared/api.ts");
  const lane = (api as any).schedulingReport;
  if (!lane || typeof lane.entry !== "function") return broken("api.schedulingReport.entry is not a function");

  const ids = ["5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d", "../feed?x=1#y z"];
  const wrong: string[] = [];
  for (const id of ids) {
    const before = seen.length;
    await lane.entry(id);
    const calls = seen.slice(before);
    if (calls.length !== 1) { wrong.push(`${JSON.stringify(id)}: ${calls.length} requests, not 1`); continue; }
    const [call] = calls;
    const want = `${PREFIX}${encodeURIComponent(id)}`;
    if (call.url !== want) wrong.push(`${JSON.stringify(id)}: ${call.url}, not ${want}`);
    const url = new URL(call.url, "http://x");
    if (url.search !== "" || url.hash !== "") wrong.push(`${JSON.stringify(id)}: became a query or a fragment (${url.search}${url.hash})`);
    if (decodeURIComponent(url.pathname.slice(PREFIX.length)) !== id) wrong.push(`${JSON.stringify(id)}: segment does not decode back to the id`);
    if (call.method !== "GET") wrong.push(`${JSON.stringify(id)}: ${call.method}, not GET`);
    if (call.authorization !== `Bearer ${TOKEN}`) wrong.push(`${JSON.stringify(id)}: Authorization ${call.authorization}`);
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("entry(uuid) and entry of an id holding / ? # and a space: one authenticated GET each, the id one encoded segment");
});
