// protects: src/modules/cerberus/context/CerberusProvider.tsx, src/modules/cerberus/hooks/useCheckDetail.ts, src/modules/cerberus/hooks/useEnrollmentStatus.ts, src/modules/cerberus/hooks/useUpdateBatch.ts, src/modules/cerberus/utils/rewindowCells.ts
// writes: none
// THE CERBERUS TAB IS TOLD, NOT TICKED. CerberusProvider and useCheckDetail keep no clock read: no CLOCK_READ_MS and
// no setInterval; the held reading is re-windowed on the minute (useMinute, rewindowOverview / rewindowCells), and
// the stale banner is ONE STALE_AFTER_MS deadline armed while the socket is down. The Enroll dialog's status
// (useEnrollmentStatus) and the Update dialog's batch (useUpdateBatch) read on cerberus_changed through
// useServerFrame (reconnect included): no POLL_MS; the first arms only the timer to its token's expiry, the second
// only its REQUEST_TIMEOUT_MS abort and reads only on a frame whose updates is true. Nothing under src/modules/cerberus
// names CLOCK_READ_MS or POLL_MS. A reading of the source as it stands, comments stripped for the code checks.

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const PROVIDER = "src/modules/cerberus/context/CerberusProvider.tsx";
const SHEET = "src/modules/cerberus/hooks/useCheckDetail.ts";
const ENROLL = "src/modules/cerberus/hooks/useEnrollmentStatus.ts";
const BATCH = "src/modules/cerberus/hooks/useUpdateBatch.ts";

const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch { return null; }
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
  const text = {};
  for (const file of [PROVIDER, SHEET, ENROLL, BATCH]) {
    text[file] = read(file);
    if (text[file] === null) wrong.push(file + " is not there");
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  const code = (file) => codeOf(text[file]);

  for (const file of [PROVIDER, SHEET]) {
    if (/\bCLOCK_READ_MS\b/.test(text[file])) wrong.push(file + " still names CLOCK_READ_MS");
    if (/\bsetInterval\s*\(/.test(code(file))) wrong.push(file + " still calls setInterval");
    if (!/\buseMinute\s*\(/.test(code(file))) wrong.push(file + " no longer moves on the minute (no useMinute)");
  }
  if (!/\brewindowOverview\s*\(/.test(code(PROVIDER))) wrong.push(PROVIDER + " no longer re-windows the held overview (no rewindowOverview)");
  if (!/\brewindowCells\s*\(/.test(code(SHEET))) wrong.push(SHEET + " no longer re-windows the sheet's strip (no rewindowCells)");
  if (!/setTimeout\s*\([\s\S]{0,240}?STALE_AFTER_MS\s*\)[\s\S]{0,120}?\[\s*isConnected\s*\]/.test(code(PROVIDER))) {
    wrong.push(PROVIDER + ": the stale banner is no longer one STALE_AFTER_MS deadline armed in an effect on isConnected");
  }

  for (const file of [ENROLL, BATCH]) {
    if (!/\buseServerFrame\s*\(/.test(code(file))) wrong.push(file + " does not call useServerFrame");
    if (!/['"]cerberus_changed['"]/.test(code(file))) wrong.push(file + " names no cerberus_changed");
    if (/\bPOLL_MS\b/.test(text[file])) wrong.push(file + " still names POLL_MS");
    if (/\bsetInterval\s*\(/.test(code(file))) wrong.push(file + " calls setInterval");
  }
  const enrollTimers = (code(ENROLL).match(/setTimeout\s*\(/g) || []).length;
  if (enrollTimers !== 1) wrong.push(ENROLL + " arms " + enrollTimers + " timers, not the one to the token's expiry");
  else if (!/setTimeout\s*\([\s\S]{0,240}?expiresAt/.test(code(ENROLL))) wrong.push(ENROLL + ": its one timer is not armed to the token's expiresAt");
  const batchTimers = (code(BATCH).match(/setTimeout\s*\(/g) || []).length;
  const batchAborts = (code(BATCH).match(/setTimeout\s*\([^;]{0,120}REQUEST_TIMEOUT_MS/g) || []).length;
  if (batchAborts < 1) wrong.push(BATCH + " lost its REQUEST_TIMEOUT_MS abort");
  if (batchTimers !== batchAborts) wrong.push(BATCH + " arms " + (batchTimers - batchAborts) + " timer(s) that are not the read's REQUEST_TIMEOUT_MS abort");
  if (!/updates\s*===\s*true/.test(code(BATCH))) wrong.push(BATCH + " no longer reads only on a cerberus_changed whose updates is true");

  for (const file of sourcesUnder(path.join(ROOT, "src/modules/cerberus"))) {
    const t = fs.readFileSync(file, "utf8");
    for (const name of ["CLOCK_READ_MS", "POLL_MS"]) if (new RegExp("\\b" + name + "\\b").test(t)) wrong.push(path.relative(ROOT, file) + " names " + name);
  }
  if (wrong.length > 0) return broken([...new Set(wrong)].join("; "));
  return held("the provider and the sheet keep no clock read and re-window on useMinute; the stale banner is one STALE_AFTER_MS deadline while the socket is down; the enroll status and update batch ride cerberus_changed through useServerFrame with only the expiry timer and the REQUEST_TIMEOUT_MS abort; no CLOCK_READ_MS or POLL_MS under src/modules/cerberus");
});
