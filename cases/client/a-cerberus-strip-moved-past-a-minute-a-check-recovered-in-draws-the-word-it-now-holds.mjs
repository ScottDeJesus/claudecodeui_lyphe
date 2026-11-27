// protects: src/modules/cerberus/utils/rewindowCells.ts, src/modules/cerberus/context/CerberusProvider.tsx, src/modules/cerberus/hooks/useCheckDetail.ts
// writes: none
// A QUIET MINUTE AFTER A RECOVERY DRAWS THE WORD NOW HELD. A strip's cell is the WORST word a check showed over its
// minute (cells.ts), so the minute a check recovered in reads failing while the check reads ok. The read that follows
// a recovery's frame lands in that same minute. rewindowCells must draw the next quiet minute with the word in force,
// as the server reads it, and not carry the recovery minute's worst forward. A scratch node whose health check went
// ok, failing, then ok again inside one minute is read as GET /overview reads it, 50 s into that minute. It is read
// again 5 s into the next minute, and the second read's cell for the new minute is compared with what
// rewindowOverview draws from the first read. The server's own modules run in a child process under tsx over a
// scratch Cerberus store; nothing of the operator's is touched.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;

const CHILD = [
  'const db = await import("@/modules/database/index.js");',
  'const D = await import("@/modules/cerberus/definitions.service.js");',
  'const { ingest } = await import("@/modules/cerberus/ingest.service.js");',
  'const { wardenLinks } = await import("@/modules/cerberus/warden-links.js");',
  'const { buildOverview } = await import("@/modules/cerberus/read-model/overview.js");',
  'const { rewindowOverview } = await import(' + JSON.stringify(ROOT + "src/modules/cerberus/utils/rewindowCells.ts") + ');',
  'db.getCerberusConnection();',
  'db.cerberusNodesDb.insert({ id: "case-node", desc: null, public_key: "k", cert_fingerprint: "f", warden_version: null, machine_id: null, facts: null, enrolled_at: Date.now() - 900000 });',
  'D.putDefinition("case-node", { services: [{ service: "svc", label: null, probes: [{ key: "svc/health", kind: "health_doc", every: 30, timeout: 5, cadence: 30, url: "http://127.0.0.1:1/h" }] }] });',
  'wardenLinks.attach({ node: "case-node", send: () => true, close() {}, version: "1", clockOffsetMs: null });',
  'const w = (at, prevAt, status, doc) => ({ check: "svc/clk", source: "svc/health", at: at, fetchedAt: at, status: status, docStatus: doc, value: status === "ok" ? "fine" : "down", data: null, tookMs: 5, prevAt: prevAt });',
  'const M = Math.floor(Date.now() / 60000) * 60000 - 180000;',
  'const stored = [ingest.ingestResults("case-node", 1, [w(M - 20000, null, "ok", "green")]), ingest.ingestResults("case-node", 2, [w(M + 10000, M - 20000, "failing", "red")]), ingest.ingestResults("case-node", 3, [w(M + 40000, M + 10000, "ok", "green")])];',
  'const inputs = (now) => ({ now: now, links: wardenLinks.states(), gateway: { listen: null, address: null, error: null }, memory: (n, k) => ingest.memory(n, k) });',
  'const svcOf = (o) => { const n = o.nodes.find((x) => x.id === "case-node"); return n ? n.services[0] : null; };',
  'const cellAt = (s, from) => (s ? (s.cells.find((c) => c.from === from) || null) : null);',
  'const first = buildOverview(inputs(M + 50000));',
  'const second = buildOverview(inputs(M + 65000));',
  'const shown = rewindowOverview(first, M + 60000);',
  'const f = svcOf(first);',
  'console.log("CASE " + JSON.stringify({ M: M, stored: stored, checkStatus: f && f.checks[0] ? f.checks[0].status : null, recoveryCell: cellAt(f, M), serverNext: cellAt(svcOf(second), M + 60000), drawnNext: cellAt(svcOf(shown), M + 60000) }));',
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
  try { dir = await scratchDir(t, "rewindow-recovered"); } catch (error) { return cannotRun("no scratch folder: " + String(error?.message ?? error)); }
  const { o, tail, status } = runChild(dir, CHILD);
  if (!o) return cannotRun("the child printed no CASE line (exit " + status + "): " + tail);
  if (!o.stored.every((s) => s && s.stored === 1)) return cannotRun("the scratch ok, failing, ok rows were not all stored: " + JSON.stringify(o.stored));
  if (o.checkStatus !== "ok" || !o.recoveryCell || o.recoveryCell.status !== "failing") return cannotRun("the read 50 s into the minute did not read the check ok over a failing cell: check " + o.checkStatus + ", cell " + JSON.stringify(o.recoveryCell));
  if (!o.serverNext || !o.drawnNext) return cannotRun("no cell for the next minute: server " + JSON.stringify(o.serverNext) + ", drawn " + JSON.stringify(o.drawnNext));
  const minute = new Date(o.M + 60000).toISOString();
  if (o.drawnNext.status !== o.serverNext.status || o.drawnNext.worst !== o.serverNext.worst) {
    return broken("a check that recovered in " + new Date(o.M).toISOString() + " (that cell failing, the check ok) is drawn " + o.drawnNext.status + " (worst " + o.drawnNext.worst + ") for the quiet minute " + minute + "; the server reads it " + o.serverNext.status + " (worst " + o.serverNext.worst + ")");
  }
  return held("the quiet minute " + minute + " after a recovery is drawn " + o.drawnNext.status + ", as the server reads it");
});
