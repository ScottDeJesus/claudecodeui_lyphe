// NO THIRTY-SECOND POLL, IN THE CODE OR ITS ROW. Scheduled and queued messages are sent from timers armed at stored instants;
// the 30-second poll (POLL_INTERVAL_MS, its setInterval) is gone from server/modules/scheduled-messages, and MAN-9123 (the
// queued message) describes the timers with nothing of the poll left — it names nextPendingAt, the read the timer is
// armed at. Healed means deleted: a later edit that brings an interval or the poll's words back breaks this.
//
// Reads the repo's files and the docstore row; writes nothing.
//
// protects: server/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts, server/modules/scheduled-messages/services/scheduled-message-clock.service.ts, server/modules/scheduled-messages/services/scheduled-messages.service.ts
// writes: none

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/modules/scheduled-messages");
const DOCSTORE = path.join(os.homedir(), ".claude/scripts/docstore");

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []));
}

runCase(async () => {
  const ticks = [];
  for (const file of filesUnder(DIR)) {
    fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (/setInterval\s*\(|POLL_INTERVAL_MS/.test(line)) ticks.push(path.basename(file) + ":" + (i + 1));
    });
  }
  let body;
  try {
    body = JSON.parse(execFileSync(DOCSTORE, ["get", "MAN-9123"], { encoding: "utf8", timeout: 30_000 })).row.body;
  } catch (error) {
    return cannotRun("docstore get MAN-9123 did not answer: " + String(error?.message ?? error).split("\n")[0]);
  }
  const stale = body.match(/POLL_INTERVAL_MS|setInterval|poll(?:s|ed)? every|next poll|30[- ]second poll/gi) ?? [];
  const wrong = [];
  if (ticks.length > 0) wrong.push("the module still ticks: " + ticks.join(", "));
  if (stale.length > 0) wrong.push("MAN-9123 still says " + [...new Set(stale)].map((s) => JSON.stringify(s)).join(", "));
  if (!body.includes("nextPendingAt")) wrong.push("MAN-9123 does not name nextPendingAt");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("no setInterval or POLL_INTERVAL_MS in " + filesUnder(DIR).length + " files; MAN-9123 names nextPendingAt and nothing of the poll");
});
