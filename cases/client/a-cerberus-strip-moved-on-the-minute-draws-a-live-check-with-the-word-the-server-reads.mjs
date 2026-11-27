// protects: src/modules/cerberus/utils/rewindowCells.ts, src/modules/cerberus/context/CerberusProvider.tsx, src/modules/cerberus/hooks/useCheckDetail.ts
// writes: none
// THE STRIP MOVES ON THE MINUTE WITHOUT A READ. The tab reads the overview only on a frame, and the store keeps only
// status moves, so a healthy fleet sends no frame for minutes. rewindowOverview moves each strip on the minute from the
// reading held. Every status change of a check is hinted (a write, or the flip deadline), so a minute with no frame is a
// minute in which no word changed. The cell the client draws for it must be the word the server reads for that minute.
// The case reads GET /api/cerberus/overview, waits past the next minute boundary, reads it again, and compares the
// second read's cell for the new minute with what rewindowOverview draws from the first read.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { api } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const MINUTE_MS = 60_000;

runCase(async (t) => {
  let dir;
  try { dir = await scratchDir(t, "rewindow"); } catch (error) { return cannotRun("no scratch folder: " + String(error?.message ?? error)); }
  const first = await api("/api/cerberus/overview");
  if (first.status !== 200 || !Array.isArray(first.json?.nodes)) return cannotRun("GET /api/cerberus/overview answered " + first.status);
  const wait = (Math.floor(Date.now() / MINUTE_MS) + 1) * MINUTE_MS + 3000 - Date.now();
  await new Promise((resolve) => setTimeout(resolve, wait));
  const second = await api("/api/cerberus/overview");
  if (second.status !== 200 || !Array.isArray(second.json?.nodes)) return cannotRun("the second GET /api/cerberus/overview answered " + second.status);
  const minute = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;

  const held1 = path.join(dir, "first.json");
  fs.writeFileSync(held1, JSON.stringify(first.json));
  const child = path.join(dir, "child.ts");
  fs.writeFileSync(child, [
    'import fs from "node:fs";',
    "import { rewindowOverview } from " + JSON.stringify(ROOT + "src/modules/cerberus/utils/rewindowCells.ts") + ";",
    "const held = JSON.parse(fs.readFileSync(" + JSON.stringify(held1) + ', "utf8"));',
    "const shown = rewindowOverview(held, " + minute + ");",
    'console.log("CASE " + JSON.stringify(shown.nodes.map((n) => ({ id: n.id, cells: n.services.map((s) => (s.cells.find((c) => c.from === ' + minute + ') ?? {}).status ?? null) }))));',
  ].join("\n"));
  const r = spawnSync(process.execPath, ["--import", "tsx", child], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
  const line = String(r.stdout || "").split("\n").find((l) => l.startsWith("CASE "));
  if (!line) return cannotRun("the child printed no CASE line (exit " + r.status + "): " + String(r.stderr || "").slice(-300));
  const shown = JSON.parse(line.slice(5));

  let compared = 0;
  const greyed = [];
  for (const node of shown) {
    const read = second.json.nodes.find((n) => n.id === node.id);
    if (!read || read.services.length !== node.cells.length) continue;
    node.cells.forEach((drawn, index) => {
      const word = (read.services[index].cells.find((c) => c.from === minute) ?? {}).status;
      if (drawn === null || word === undefined || word === "unknown") return;
      compared += 1;
      if (drawn !== word) greyed.push(node.id + "[" + index + "] drawn " + drawn + ", server " + word);
    });
  }
  if (compared === 0) return cannotRun("no strip of the live fleet read a word other than unknown for " + new Date(minute).toISOString());
  if (greyed.length > 0) return broken(greyed.length + " of " + compared + " live strips draw the minute " + new Date(minute).toISOString() + " unlike the server's own read: " + greyed.slice(0, 4).join("; "));
  return held(compared + " live strips draw the minute " + new Date(minute).toISOString() + " with the word the server reads for it");
});
