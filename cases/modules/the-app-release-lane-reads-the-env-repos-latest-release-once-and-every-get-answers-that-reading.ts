// protects: server/modules/app-release/app-release.module.ts, server/modules/app-release/app-release.service.ts, server/shared/polled-lane.service.ts, server/index.ts
// writes: none
// The newest app release is read once per host, not once per tab every five minutes: the module asks GitHub for
// releases/latest of the repository APP_RELEASE_REPO names (today's slug the default), keeps the reading in a polled
// lane, and GET /api/app-release answers the lane's landed reading without asking again. GitHub is a stand-in fetch
// in this process (nothing leaves the machine); the route is mounted on a scratch express app on a free port; the
// socket is a stand-in in the real registry, removed when the case ends.

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = "case-owner/case-repo";
const DEFAULT_REPO = "siteboon/claudecodeui";
const RELEASE = { tag_name: "v9.8.7", name: "Case release", body: "notes", html_url: "https://github.com/case-owner/case-repo/releases/tag/v9.8.7", published_at: "2026-11-01T00:00:00Z" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const dir: string = await scratchDir(t, "app-release");
  // An existing file, so the connection does not copy a legacy auth.db of the install into the scratch.
  process.env.DATABASE_PATH = path.join(dir, "auth.db");
  fs.writeFileSync(process.env.DATABASE_PATH, "");
  const asked: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url).host === "api.github.com") {
      asked.push(url);
      return new Response(JSON.stringify(RELEASE), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  t.defer(() => { globalThis.fetch = realFetch; });

  const state: any = await import("../../server/modules/websocket/services/websocket-state.service.ts");
  const frames: any[] = [];
  const socket = {
    readyState: state.WS_OPEN_STATE,
    send: (text: string) => {
      try { const frame = JSON.parse(text); if (frame?.kind === "app_release_state") frames.push(frame); } catch { /* not a frame this case reads */ }
    },
  };
  state.connectedClients.add(socket);
  t.defer(() => state.connectedClients.delete(socket));

  const { createAppReleaseModule } = await import("../../server/modules/app-release/app-release.module.ts");
  const { default: express } = await import("express");
  process.env.APP_RELEASE_REPO = REPO;
  const app = express();
  app.use("/api/app-release", createAppReleaseModule());
  const server: any = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.defer(() => server.close());
  const origin = "http://127.0.0.1:" + server.address().port;

  const answers: Array<{ status: number; body: any }> = [];
  for (let i = 0; i < 3; i += 1) {
    const response = await realFetch(origin + "/api/app-release");
    answers.push({ status: response.status, body: await response.json().catch(() => null) });
  }
  await sleep(300);
  const wantUrl = "https://api.github.com/repos/" + REPO + "/releases/latest";
  if (asked.length !== 1) return broken("three GETs asked GitHub " + asked.length + " times, not once: " + JSON.stringify(asked));
  if (asked[0] !== wantUrl) return broken("GitHub was asked " + asked[0] + ", not " + wantUrl + " (APP_RELEASE_REPO=" + REPO + ")");
  for (const [i, a] of answers.entries()) {
    if (a.status !== 200) return broken("GET " + (i + 1) + " answered " + a.status + ", not 200");
    if (a.body?.tag !== RELEASE.tag_name || a.body?.release?.htmlUrl !== RELEASE.html_url) return broken("GET " + (i + 1) + " answered " + JSON.stringify(a.body) + ", not the landed tag and release");
  }
  for (const frame of frames) {
    if (typeof frame.at !== "number" || frame.tag !== RELEASE.tag_name || "seq" in frame || "sessionId" in frame) return broken("an app_release_state frame is not { kind, at, tag, release }: " + JSON.stringify(frame));
  }

  delete process.env.APP_RELEASE_REPO;
  createAppReleaseModule();
  const until = Date.now() + 2000;
  while (asked.length < 2 && Date.now() < until) await sleep(25);
  const wantDefault = "https://api.github.com/repos/" + DEFAULT_REPO + "/releases/latest";
  if (asked[1] !== wantDefault) return broken("with APP_RELEASE_REPO unset GitHub was asked " + (asked[1] ?? "nothing") + ", not " + wantDefault);

  process.env.APP_RELEASE_REPO = "not a slug";
  let refused = false;
  try { createAppReleaseModule(); } catch { refused = true; }
  delete process.env.APP_RELEASE_REPO;
  if (!refused) return broken("a repository slug that is not owner/name was taken");
  return held("one GitHub read for " + REPO + " answered three GETs with " + RELEASE.tag_name + "; " + frames.length + " app_release_state frame(s), each { kind, at, tag, release }; unset reads " + DEFAULT_REPO + "; a bad slug is refused");
});
