// protects: server/modules/app-release/app-release.module.ts, server/shared/polled-lane.service.ts
// writes: none
// The release lane reads GitHub once at boot and then every 6 h. A failed read (a 502, a rate-limit 403, a
// timeout) must not leave GET /api/app-release answering 503, and the page without its update notice, for six
// hours: the lane asks again within a minute. GitHub is a stand-in fetch in this process (nothing leaves the
// machine); the route is mounted on a scratch express app on a free port.

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = "case-owner/case-repo";
const RELEASE = { tag_name: "v9.8.7", name: "Case release", body: "notes", html_url: "https://github.com/case-owner/case-repo/releases/tag/v9.8.7", published_at: "2026-11-01T00:00:00Z" };
const RETRY_WITHIN_MS = 60_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const dir: string = await scratchDir(t, "app-release-retry");
  process.env.DATABASE_PATH = path.join(dir, "auth.db");
  fs.writeFileSync(process.env.DATABASE_PATH, "");
  const asked: number[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url).host === "api.github.com") {
      asked.push(Date.now());
      if (asked.length === 1) return new Response(JSON.stringify({ message: "Server Error" }), { status: 502 });
      return new Response(JSON.stringify(RELEASE), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  t.defer(() => { globalThis.fetch = realFetch; });

  const { createAppReleaseModule } = await import("../../server/modules/app-release/app-release.module.ts");
  const { default: express } = await import("express");
  process.env.APP_RELEASE_REPO = REPO;
  const app = express();
  app.use("/api/app-release", createAppReleaseModule());
  const server: any = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.defer(() => server.close());
  const origin = "http://127.0.0.1:" + server.address().port;

  const firstAt = Date.now();
  const first = await realFetch(origin + "/api/app-release");
  const firstMs = Date.now() - firstAt;
  const until = Date.now() + RETRY_WITHIN_MS;
  while (asked.length < 2 && Date.now() < until) await sleep(250);
  if (asked.length < 2) {
    return broken("GitHub answered 502 to the first read and was not asked again in " + RETRY_WITHIN_MS / 1000 + " s; GET answered " + first.status + " after " + firstMs + " ms, and the next read waits for the 6 h interval");
  }
  await sleep(300);
  const after = await realFetch(origin + "/api/app-release");
  const body: any = await after.json().catch(() => null);
  if (after.status !== 200 || body?.tag !== RELEASE.tag_name) return broken("GitHub was asked again but GET then answered " + after.status + " " + JSON.stringify(body));
  return held("a 502 first read was retried " + (asked[1] - asked[0]) + " ms later and GET then answered " + body.tag);
});
