// protects: src/shared/hooks/useVersionCheck.ts, src/shared/hooks/useCliVersion.ts, src/shared/hooks/useServerFrame.ts, src/shared/api.ts
// writes: none
// The update prompt and the CLI-version report are told, not ticked: useVersionCheck reads GET /api/app-release once and
// then takes app_release_state, useCliVersion's shared reader is called by each consumer's useServerFrame on
// cli_version_changed, and both answer websocket_reconnected through useServerFrame. Neither keeps the setInterval, the
// POLL_MS that named it, or the shared poller; readHealth still asks /health; the browser never asks GitHub.
// A reading of the source as it stands: a poll put back, or a GitHub URL in the client, reads BROKEN.

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const RIDERS = [
  { file: "src/shared/hooks/useVersionCheck.ts", kind: "app_release_state" },
  { file: "src/shared/hooks/useCliVersion.ts", kind: "cli_version_changed" },
];

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

function sourcesUnder(dir, found = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourcesUnder(full, found);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) found.push(full);
  }
  return found;
}

runCase(async () => {
  const wrong = [];
  for (const rider of RIDERS) {
    const text = read(rider.file);
    if (text === null) { wrong.push(rider.file + " is not there"); continue; }
    if (!/\buseServerFrame\s*\(/.test(text)) wrong.push(rider.file + " does not call useServerFrame");
    if (!text.includes("'" + rider.kind + "'") && !text.includes('"' + rider.kind + '"')) wrong.push(rider.file + " names no " + rider.kind);
    if (/\bsetInterval\s*\(/.test(text)) wrong.push(rider.file + " still calls setInterval");
    if (/\bPOLL_MS\b/.test(text)) wrong.push(rider.file + " still names POLL_MS");
    if (/\bpoller\b/i.test(text)) wrong.push(rider.file + " still speaks of a poller");
  }
  const check = read(RIDERS[0].file);
  if (check !== null) {
    if (!/\bapi\.appRelease\s*\(/.test(check)) wrong.push("useVersionCheck does not read the release through api.appRelease");
    if (!/fetch\(\s*['"]\/health['"]/.test(check)) wrong.push("readHealth no longer fetches /health");
  }
  for (const file of sourcesUnder(path.join(ROOT, "src"))) {
    if (fs.readFileSync(file, "utf8").includes("api.github.com")) wrong.push(path.relative(ROOT, file) + " names api.github.com");
  }
  if (wrong.length > 0) return broken([...new Set(wrong)].join("; "));
  return held("useVersionCheck rides app_release_state and useCliVersion cli_version_changed through useServerFrame; no setInterval, POLL_MS or poller in either; readHealth asks /health; nothing under src names api.github.com");
});
