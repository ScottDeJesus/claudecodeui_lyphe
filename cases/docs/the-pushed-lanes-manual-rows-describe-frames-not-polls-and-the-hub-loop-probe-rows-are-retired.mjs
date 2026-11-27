// protects: server/modules/websocket/MANUAL.md, docs/architecture/MANUAL.md, /home/lyphe/.claude/ArchPulse/src/live/hub.ts, /home/lyphe/.claude/ArchPulse/src/hooks/useDocSpaceSync.ts
// writes: none
//
// HEALED MEANS DELETED, IN THE MANUAL (pollers-hooks--client-pushes, seam 16). The ten rows that described the polls
// this plan removed now describe the frames: none names a retired interval constant, MAN-6102 no longer says the
// studio polls GET /api/docspace/version every 2500 ms, no row says an endpoint is polled by every open tab, and the
// probe rows of the hub's poll loop (INV-6770, INV-6772) are retired. Read through the docstore verbs, never written.

import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const DOCSTORE = path.join(os.homedir(), ".claude/scripts/docstore");
const ROWS = ["MAN-453", "MAN-723", "MAN-9543", "MAN-7871", "MAN-404", "MAN-464", "MAN-511", "MAN-6102", "MAN-7687", "MAN-7681"];
const RETIRED = ["INV-6770", "INV-6772"];
const RETIRED_CONSTANTS = /\b(?:JEV_POLL_MS|DEEPSEEK_USAGE_POLL_MS|BALANCE_POLL_MS|HEAL_POLL_MS|MEMORY_POLL_MS|ACCOUNTS_POLL_MS|TRANSCRIPT_POLL_MS|CLOCK_READ_MS|BUSY_POLL_MS|LIVE_POLL_MS|LIST_IDLE_MS|DOCSPACE_POLL_MS|VERSION_POLL_MS|PENDING_POLL_MS|POLL_MS)\b/;
const POLL_SENTENCES = [/every 2\s?500\s?ms/i, /every 2\.5\s?s\b/i, /polls\W+GET \/api\/docspace\/version/i, /polled by every open tab/i];

const ask = (args) => spawnSync(DOCSTORE, args, { encoding: "utf8", timeout: 30000 });

runCase(async () => {
  const faults = [];
  for (const token of ROWS) {
    const answer = ask(["get", token, "--text"]);
    if (answer.error) return cannotRun("docstore would not run: " + String(answer.error.message ?? answer.error));
    if (answer.status !== 0) {
      faults.push(token + " is retired or unknown (docstore get exit " + answer.status + ")");
      continue;
    }
    const lines = answer.stdout.split("\n");
    lines.forEach((line, index) => {
      const constant = RETIRED_CONSTANTS.exec(line);
      if (constant) faults.push(token + " line " + (index + 1) + " names " + constant[0]);
      for (const sentence of POLL_SENTENCES) if (sentence.test(line)) faults.push(token + " line " + (index + 1) + " still describes a poll: " + line.trim().slice(0, 90));
    });
  }
  for (const token of RETIRED) {
    const history = ask(["history", token, "--json"]);
    if (history.error || history.status !== 0) return cannotRun("docstore history " + token + " did not answer (exit " + history.status + ")");
    let rows;
    try {
      rows = JSON.parse(history.stdout).rows ?? [];
    } catch {
      return cannotRun("docstore history " + token + " answered no JSON");
    }
    if (rows.length === 0) faults.push(token + " is unknown to the store, not retired");
    else if (!rows.some((row) => row.verb === "retire") || ask(["get", token]).status === 0) faults.push(token + " is still filed");
  }
  if (faults.length > 0) return broken(faults.slice(0, 14).join("; ") + (faults.length > 14 ? " (+" + (faults.length - 14) + " more)" : ""));
  return held("the ten rows stand and none describes a retired poll; INV-6770 and INV-6772 are retired");
});
