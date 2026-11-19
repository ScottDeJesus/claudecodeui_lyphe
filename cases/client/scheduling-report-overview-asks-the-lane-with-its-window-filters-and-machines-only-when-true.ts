// api.schedulingReport.overview is the Scheduling view's one window read: an authenticated GET to the lane mounted at
// /api/scheduling-report, its window, person and account passed as given, and `machines` sent as 1 only when true —
// the lane's allowlist takes machines 0|1, so `machines=true` or `machines=0`-for-false would be a 400 or a quiet widening.
//
// The browser globals api.ts reads are stubbed in this process before it loads: localStorage holds a fixed token and
// fetch records each call and answers an empty 200. Nothing leaves the process.
//
// protects: src/shared/api.ts, src/shared/authToken.ts
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";

const TOKEN = "case-token-overview";
const ACCOUNT = "0b6f4c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b";
const PATH = "/api/scheduling-report/overview";

type Seen = { url: string; method: string; authorization: string | null };

runCase(async () => {
  const store = new Map<string, string>([["auth-token", TOKEN]]);
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  const seen: Seen[] = [];
  (globalThis as any).fetch = async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers ?? {});
    seen.push({ url: String(url), method: (init.method ?? "GET").toUpperCase(), authorization: headers.get("Authorization") });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };

  // Loaded in the body, after the stubs: a module that will not load ends the case CANNOT RUN.
  const { api } = await import("../../src/shared/api.ts");
  const lane = (api as any).schedulingReport;
  if (!lane || typeof lane.overview !== "function") return broken("api.schedulingReport.overview is not a function");

  const asks: Array<{ label: string; args: unknown[]; path: string; query: Record<string, string> }> = [
    { label: "nothing", args: [], path: PATH, query: {} },
    { label: "the window, a person and an account", args: [{ days: 7, by: "eis:a b", account: ACCOUNT }], path: PATH,
      query: { days: "7", by: "eis:a b", account: ACCOUNT } },
    { label: "machines false", args: [{ days: 90, machines: false }], path: PATH, query: { days: "90" } },
    { label: "machines true", args: [{ days: 30, machines: true }], path: PATH, query: { days: "30", machines: "1" } },
  ];

  const wrong: string[] = [];
  for (const ask of asks) {
    const before = seen.length;
    await lane.overview(...ask.args);
    const calls = seen.slice(before);
    if (calls.length !== 1) { wrong.push(`${ask.label}: ${calls.length} requests, not 1`); continue; }
    const [call] = calls;
    const url = new URL(call.url, "http://x");
    if (url.pathname !== ask.path) wrong.push(`${ask.label}: path ${url.pathname}, not ${ask.path}`);
    const query = Object.fromEntries(url.searchParams.entries());
    if (JSON.stringify(Object.entries(query).sort()) !== JSON.stringify(Object.entries(ask.query).sort())) {
      wrong.push(`${ask.label}: query ${JSON.stringify(query)}, not ${JSON.stringify(ask.query)}`);
    }
    if (call.method !== "GET") wrong.push(`${ask.label}: ${call.method}, not GET`);
    if (call.authorization !== `Bearer ${TOKEN}`) wrong.push(`${ask.label}: Authorization ${call.authorization}, not the stored token`);
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("overview with nothing, with a window/person/account, with machines false and true: one authenticated GET each, machines=1 only when true");
});
