// api.schedulingReport.feedUrl is the Scheduling view's EventSource URL. EventSource cannot send an Authorization
// header, so the stored token rides as `?token=`, as api.uploadRuns.feedUrl's does, read at EACH call: a token
// refreshed after the module loaded is the one the next (re)open carries, and with none stored the URL is bare.
//
// The localStorage api.ts reads is stubbed in this process before it loads. Nothing leaves the process.
//
// protects: src/shared/api.ts, src/shared/authToken.ts
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";

const BARE = "/api/scheduling-report/feed";
// A token whose characters need encoding, so an unencoded join would read back different.
const LATER_TOKEN = "eyJ.a+b/c=";

runCase(async () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  (globalThis as any).fetch = async () => new Response("{}", { status: 200 });

  const { api } = await import("../../src/shared/api.ts");
  const lane = (api as any).schedulingReport;
  if (!lane || typeof lane.feedUrl !== "function") return broken("api.schedulingReport.feedUrl is not a function");

  const wrong: string[] = [];
  const none = lane.feedUrl();
  if (none !== BARE) wrong.push(`with no token stored: ${JSON.stringify(none)}, not ${BARE}`);

  store.set("auth-token", LATER_TOKEN);
  const later = String(lane.feedUrl());
  const url = new URL(later, "http://x");
  if (url.pathname !== BARE) wrong.push(`with a token: path ${url.pathname}, not ${BARE}`);
  if (url.searchParams.get("token") !== LATER_TOKEN) wrong.push(`with a token: token reads ${JSON.stringify(url.searchParams.get("token"))}, not the stored one`);
  if ([...url.searchParams.keys()].join() !== "token") wrong.push(`with a token: query keys ${[...url.searchParams.keys()].join()}, not token alone`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("feedUrl is bare with no token and carries the token stored after load, encoded, as its only query key");
});
