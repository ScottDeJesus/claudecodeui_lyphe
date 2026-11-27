// protects: server/modules/deepseek/deepseek.module.ts, server/modules/providers/services/sessions-flushed.service.ts, server/modules/providers/services/sessions-watcher.service.ts, server/shared/paced-hint.service.ts
// writes: none
// The DeepSeek usage hint is told by the sessions watcher's flush, never by a clock. The real module is created over
// a stand-in vendor (no request leaves the box), a stand-in recorder and a scratch database; one stand-in socket in
// the real registry records what broadcastToAll sends; the flush seam's own announce plays the watcher's flush.
// Quiet for 11 s -> no deepseek_usage_changed; one flush of ids that name no DeepSeek session -> one { kind, at } at
// once; two more inside the gap -> exactly one more, no sooner than 10 s after the first. The watcher's own file is
// read for the seam: it exports onSessionsFlushed and its flush announces after broadcasting session_upserted.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";

const MODULE = "../../server/modules/deepseek/deepseek.module.ts";
const STATE = "../../server/modules/websocket/services/websocket-state.service.ts";
const FLUSHED = "../../server/modules/providers/services/sessions-flushed.service.ts";
const WATCHER = new URL("../../server/modules/providers/services/sessions-watcher.service.ts", import.meta.url);
const KIND = "deepseek_usage_changed";
const GAP_MS = 10_000;
const QUIET_MS = 11_000;
const VENDOR = "https://api.deepseek.com/";
const SCRATCH_PREFIX = "case-deepseek-hint-";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function watcherSeamFault(): string | null {
  const text = fs.readFileSync(WATCHER, "utf8");
  const exported = /export\s*\{[^}]*\bonSessionsFlushed\b[^}]*\}\s*from|export\s+function\s+onSessionsFlushed\b|export\s+const\s+onSessionsFlushed\b/;
  if (!exported.test(text)) return "sessions-watcher.service.ts exports no onSessionsFlushed";
  const start = text.indexOf("async function flushPendingWatcherUpdate");
  if (start < 0) return "sessions-watcher.service.ts holds no flushPendingWatcherUpdate";
  const end = text.indexOf("\n}\n", start);
  const body = text.slice(start, end < 0 ? undefined : end);
  const sent = body.indexOf("broadcastSessionUpsertedBatch(");
  const told = body.indexOf("announceSessionsFlushed(");
  if (told < 0) return "the watcher's flush announces nothing to the onSessionsFlushed subscribers";
  if (sent < 0 || told < sent) return "the watcher's flush announces before it broadcasts session_upserted";
  return null;
}

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const seam = watcherSeamFault();
  if (seam) return broken(seam);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), SCRATCH_PREFIX));
  t.defer(() => { if (path.basename(scratch).startsWith(SCRATCH_PREFIX)) fs.rmSync(scratch, { recursive: true, force: true }); });
  process.env.DATABASE_PATH = path.join(scratch, "auth.db");
  process.env.DEEPSEEK_USAGE_BIN = "/bin/true";
  process.env.DEEPSEEK_API_KEY = "sk-case-stand-in";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (String(url).startsWith(VENDOR)) {
      const vendor = { is_available: true, balance_infos: [{ currency: "USD", total_balance: "1.00", granted_balance: "0.00", topped_up_balance: "1.00" }] };
      return new Response(JSON.stringify(vendor), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  t.defer(() => { globalThis.fetch = realFetch; });

  const state: any = await import(STATE);
  const flushed: any = await import(FLUSHED);
  if (typeof flushed.announceSessionsFlushed !== "function") return broken("sessions-flushed.service.ts exports no announceSessionsFlushed");
  const frames: Array<{ at: number; body: any }> = [];
  const socket = {
    readyState: state.WS_OPEN_STATE,
    send: (s: string) => {
      let body: any;
      try { body = JSON.parse(s); } catch { return; }
      if (body?.kind === KIND) frames.push({ at: Date.now(), body });
    },
  };
  state.connectedClients.add(socket);
  t.defer(() => state.connectedClients.delete(socket));

  const mod: any = await import(MODULE);
  if (typeof mod.createDeepseekModule !== "function") return broken("deepseek.module.ts exports no createDeepseekModule");
  mod.createDeepseekModule();

  await sleep(QUIET_MS);
  const unasked = frames.length;
  flushed.announceSessionsFlushed(["case-a-claude-session-not-deepseek"]);
  await sleep(300);
  const atOnce = frames.length - unasked;
  flushed.announceSessionsFlushed(["case-second-flush"]);
  flushed.announceSessionsFlushed(["case-third-flush"]);
  await sleep(2_000);
  const insideGap = frames.length - unasked - atOnce;
  await sleep(GAP_MS - 2_300 + 1_500);
  const told = frames.slice(unasked);

  const wrong: string[] = [];
  if (unasked !== 0) wrong.push(`${unasked} ${KIND} frames in ${QUIET_MS / 1000} s with no flush (something other than a flush sends it)`);
  if (atOnce !== 1) wrong.push(`the first flush sent ${atOnce} frames at once, not 1`);
  if (insideGap !== 0) wrong.push(`${insideGap} frames inside the 10 s gap`);
  if (told.length !== 2) wrong.push(`three flushes sent ${told.length} frames in all, not 2 (one at once, one at the gap's end)`);
  for (const frame of told) {
    if (Object.keys(frame.body).sort().join(",") !== "at,kind" || typeof frame.body.at !== "number") wrong.push(`a frame is not { kind, at }: ${JSON.stringify(frame.body)}`);
  }
  const spacing = told.length === 2 ? told[1].body.at - told[0].body.at : null;
  if (spacing !== null && spacing < GAP_MS - 50) wrong.push(`the second frame came ${spacing} ms after the first`);
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`11 s with no flush: 0 frames; a flush of non-DeepSeek ids: 1 frame at once; two flushes in the gap: 1 more, ${spacing} ms after the first; every frame { kind, at }`);
});
