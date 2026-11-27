// protects: server/modules/cerberus/read-model/check-views.ts, server/modules/cerberus/read-model/node-links.ts, server/modules/cerberus/read-model/freshness.ts, server/modules/cerberus/read-model/overview.ts, server/modules/cerberus/flip-judge.ts
// writes: none
// A TAB'S READ FORECASTS ITS OWN EXPIRY. Every comparison the read model makes between a stored time and inputs.now
// that decides a status or a link, and is not yet true, reports the instant it becomes true to inputs.flipsAt. A
// scratch node, linked, with a health-document component heard 20 s ago (stored) and 10 s ago (an unchanged status:
// ingest's memory only), is read as GET /overview reads it
// (buildOverview with collectFlips' flipsAt): the collector keeps the earliest instant ahead; judging that instant
// (judgeFlip) finds something turning there; one of the instants told turns the quiet check itself (its stale
// instant); and nothing turns at the read's own instant. The server's own modules run in a child process under tsx
// over a scratch Cerberus store; nothing of the operator's is touched.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;

const CHILD = [
  'const db = await import("@/modules/database/index.js");',
  'let judge;',
  'try { judge = await import("@/modules/cerberus/flip-judge.js"); } catch (e) { console.log("CASE " + JSON.stringify({ missing: "flip-judge.ts would not load: " + String(e && e.message).split("\\n")[0] })); process.exit(0); }',
  'const D = await import("@/modules/cerberus/definitions.service.js");',
  'const { ingest } = await import("@/modules/cerberus/ingest.service.js");',
  'const { wardenLinks } = await import("@/modules/cerberus/warden-links.js");',
  'const { buildOverview } = await import("@/modules/cerberus/read-model/overview.js");',
  'db.getCerberusConnection();',
  'db.cerberusNodesDb.insert({ id: "case-node", desc: null, public_key: "k", cert_fingerprint: "f", warden_version: null, machine_id: null, facts: null, enrolled_at: Date.now() - 600000 });',
  'D.putDefinition("case-node", { services: [{ service: "svc", label: null, probes: [{ key: "svc/health", kind: "health_doc", every: 30, timeout: 5, cadence: 30, url: "http://127.0.0.1:1/h" }] }] });',
  'wardenLinks.attach({ node: "case-node", send: () => true, close() {}, version: "1", clockOffsetMs: null });',
  'const w = (at, prevAt) => ({ check: "svc/clk", source: "svc/health", at: at, fetchedAt: at, status: "ok", docStatus: "green", value: "fine", data: null, tookMs: 5, prevAt: prevAt });',
  'const start = Date.now();',
  'const stored = [ingest.ingestResults("case-node", 1, [w(start - 20000, null)]), ingest.ingestResults("case-node", 2, [w(start - 10000, start - 20000)])];',
  'const inputs = (now) => ({ now: now, links: wardenLinks.states(), gateway: { listen: null, address: null, error: null }, memory: (n, k) => ingest.memory(n, k) });',
  'const t = Date.now();',
  'const told = [];',
  'buildOverview(Object.assign(inputs(t), { flipsAt: (at) => told.push(at) }));',
  'const flips = judge.collectFlips(t);',
  'buildOverview(Object.assign(inputs(t), { flipsAt: flips.flipsAt }));',
  'const ahead = [...new Set(told.filter((at) => at > t))].sort((a, b) => a - b);',
  'const quiet = judge.judgeFlip(t, () => inputs(t));',
  'const turns = ahead.slice(0, 6).map((at) => ({ at: at, judged: judge.judgeFlip(at, () => inputs(at)) }));',
  'console.log("CASE " + JSON.stringify({ t: t, stored: stored, told: told.length, ahead: ahead, earliest: flips.earliest(), quiet: quiet, turns: turns }));',
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

const named = (j) => (j.checks || []).concat(j.nodes || []);

runCase(async (t) => {
  let dir;
  try { dir = await scratchDir(t, "flip-forecast"); } catch (error) { return cannotRun("no scratch folder: " + String(error?.message ?? error)); }
  const { o, tail, status } = runChild(dir, CHILD);
  if (!o) return cannotRun("the child printed no CASE line (exit " + status + "): " + tail);
  if (o.missing) return broken(o.missing);
  if (!(o.stored[0] && o.stored[0].stored === 1)) return cannotRun("the scratch results were not stored as the read model needs them: " + JSON.stringify(o.stored));
  const wrong = [];
  if (o.ahead.length === 0) return broken("a tab's read of a check heard 10 s ago told its collector no instant ahead: the read model reports no flip");
  if (o.earliest !== o.ahead[0]) wrong.push("the collector kept " + o.earliest + ", not the earliest instant told (" + o.ahead[0] + ")");
  if (named(o.quiet).length > 0) wrong.push("judged at the read's own instant, the judge says " + JSON.stringify(named(o.quiet)) + " turned: an instant told that was already true");
  const first = o.turns[0];
  if (!first || named(first.judged).length === 0) wrong.push("the earliest instant told (+" + (o.ahead[0] - o.t) + " ms) turns nothing");
  const own = o.turns.find((x) => (x.judged.checks || []).some((k) => k.endsWith("svc/clk")));
  if (!own) wrong.push("no instant told turns the quiet check case-node/svc/clk (told +" + o.ahead.map((a) => a - o.t).join(", +") + " ms)");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("a read told " + o.ahead.length + " instant(s) ahead, earliest +" + (o.ahead[0] - o.t) + " ms (kept by the collector, turning " + JSON.stringify(named(first.judged)) + "); the quiet check turns at +" + (own.at - o.t) + " ms; nothing turns at the read's own instant");
});
