// protects: server/modules/cerberus/cerberus-broadcast.ts, server/modules/cerberus/cerberus.routes.ts
// writes: none
// TIME IS HINTED. A check going stale, a mute running out or a node falling silent writes nothing, so no writer hints
// it: a tab's read hands the earliest such instant to armFlipDeadline, ONE unref'd timer that keeps the earliest
// future instant it was handed; when it fires, the judge the routes register (judgeFlipsWith) says what turned, and
// one cerberus_changed names it. Armed with a later instant, then an earlier one, then null and a past one, the timer
// is judged once, at the earliest instant and not before it; one frame names what the judge turned; a judgement that
// turned nothing sends no frame. The server's own module runs in a child process under tsx, over a scratch Cerberus
// store, with a stand-in open socket in connectedClients and a stand-in judge; nothing of the operator's is touched.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const EARLY_MS = 2000;

const CHILD = [
  'const ws = await import("@/modules/websocket/index.js");',
  'const b = await import("@/modules/cerberus/cerberus-broadcast.js");',
  'if (typeof b.armFlipDeadline !== "function" || typeof b.judgeFlipsWith !== "function") { console.log("CASE " + JSON.stringify({ missing: "cerberus-broadcast.ts exports no armFlipDeadline or no judgeFlipsWith" })); process.exit(0); }',
  'const sleep = (ms) => new Promise((r) => setTimeout(r, ms));',
  'const frames = [];',
  'const judged = [];',
  'ws.connectedClients.add({ readyState: ws.WS_OPEN_STATE ?? 1, send(m) { const f = JSON.parse(m); if (f.kind === "cerberus_changed") frames.push({ at: Date.now(), nodes: f.nodes, checks: f.checks }); } });',
  'let answer = { nodes: ["case-node"], checks: ["case-node/svc/clk"], next: null };',
  'b.judgeFlipsWith((at) => { judged.push({ at: at, now: Date.now() }); return answer; });',
  'const t0 = Date.now();',
  'b.armFlipDeadline(t0 + 4000);',
  'b.armFlipDeadline(t0 + 2000);',
  'b.armFlipDeadline(null);',
  'b.armFlipDeadline(t0 - 1000);',
  'await sleep(1800);',
  'const before = { frames: frames.length, judged: judged.length };',
  'await sleep(3700);',
  'const first = { frames: frames.slice(), judged: judged.slice(), before: before };',
  'answer = { nodes: [], checks: [], next: null };',
  'frames.length = 0; judged.length = 0;',
  'const t1 = Date.now();',
  'b.armFlipDeadline(t1 + 1200);',
  'await sleep(3000);',
  'console.log("CASE " + JSON.stringify({ t0: t0, first: first, quiet: { t1: t1, frames: frames.slice(), judged: judged.slice() } }));',
  'process.exit(0);',
].join("\n");

function runChild(dir, code) {
  const file = path.join(dir, "child.mjs");
  fs.writeFileSync(file, code);
  const r = spawnSync(process.execPath, ["--import", "tsx", file], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, TSX_TSCONFIG_PATH: "server/tsconfig.json", CERBERUS_DB_PATH: path.join(dir, "cerberus.db"), DATABASE_PATH: path.join(dir, "auth.db") },
  });
  const out = String(r.stdout || "");
  const line = out.split("\n").find((l) => l.startsWith("CASE "));
  const tail = (String(r.stderr || "") + "\n" + out).trim().split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 300);
  if (!line) return { o: null, tail, status: r.status };
  try { return { o: JSON.parse(line.slice(5)), tail, status: r.status }; } catch { return { o: null, tail, status: r.status }; }
}

runCase(async (t) => {
  let dir;
  try { dir = await scratchDir(t, "flip-deadline"); } catch (error) { return cannotRun("no scratch folder: " + String(error?.message ?? error)); }
  const { o, tail, status } = runChild(dir, CHILD);
  if (!o) return cannotRun("the child printed no CASE line (exit " + status + "): " + tail);
  if (o.missing) return broken(o.missing);
  const wrong = [];
  const due = o.t0 + EARLY_MS;
  if (o.first.before.frames + o.first.before.judged > 0) wrong.push("something fired before the earliest instant (" + JSON.stringify(o.first.before) + ")");
  let fired = null;
  if (o.first.judged.length !== 1) {
    wrong.push("the deadline was judged " + o.first.judged.length + " times, not once (at t0+" + o.first.judged.map((j) => j.at - o.t0).join(", t0+") + ")");
  } else {
    const j = o.first.judged[0];
    fired = j.now - due;
    if (j.at !== due) wrong.push("the judge was asked about t0+" + (j.at - o.t0) + ", not the earliest instant t0+" + EARLY_MS);
    if (j.now < due) wrong.push("the deadline fired " + (due - j.now) + " ms before its instant");
    if (j.now > due + 1000) wrong.push("the deadline fired " + (j.now - due) + " ms after its instant");
  }
  let sent = null;
  if (o.first.frames.length !== 1) {
    wrong.push(o.first.frames.length + " cerberus_changed frames went out for one judged turn, not 1");
  } else {
    const f = o.first.frames[0];
    sent = f.at - due;
    if (!(f.checks || []).includes("case-node/svc/clk") || !(f.nodes || []).includes("case-node")) wrong.push("the frame names " + JSON.stringify({ nodes: f.nodes, checks: f.checks }) + ", not what the judge said turned");
    if (f.at < due) wrong.push("the frame went out " + (due - f.at) + " ms before the instant");
    if (f.at > due + 2500) wrong.push("the frame went out " + (f.at - due) + " ms after the instant");
  }
  if (o.quiet.judged.length !== 1) wrong.push("a deadline armed 1.2 s ahead was judged " + o.quiet.judged.length + " times, not once");
  if (o.quiet.frames.length !== 0) wrong.push("a judgement that turned nothing still sent " + o.quiet.frames.length + " cerberus_changed frame(s)");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("armed t0+4000, t0+2000, null and t0-1000: judged once, at t0+2000 (fired +" + fired + " ms); one cerberus_changed +" + sent + " ms named case-node/svc/clk; a judgement that turned nothing sent no frame");
});
