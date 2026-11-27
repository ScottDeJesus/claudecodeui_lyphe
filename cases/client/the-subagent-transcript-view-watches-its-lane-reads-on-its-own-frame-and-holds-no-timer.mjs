// protects: src/modules/chat/hooks/useSubagentTranscript.ts, src/shared/hooks/useLaneWatch.ts
// writes: none
//
// A subagent transcript view is told, not ticked. useSubagentTranscript watches the subagent_transcript lane through
// useLaneWatch, with the key shape the server resolves (agent:<appSessionId>:<toolUseId>, soul:<launchId>), reads again
// on a subagent_transcript_changed whose key is its own and on reconnect (frames were missed while the socket was down),
// and arms no timer: TRANSCRIPT_POLL_MS is gone from src and no comment of the hook describes a poll. useLaneWatch sends
// watch.start, sends it again on websocket_reconnected, sends watch.stop, and arms no timer either.
// A reading of the source as it stands: a poll put back, a key the server cannot resolve, or a rider that stops
// listening reads BROKEN.

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const HOOK = path.join(ROOT, "src/modules/chat/hooks/useSubagentTranscript.ts");
const LANE_HOOK = path.join(ROOT, "src/shared/hooks/useLaneWatch.ts");

function read(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return null; }
}
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const comments = (text) => (text.match(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g) ?? []).join("\n");

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
  const lane = read(LANE_HOOK);
  if (lane === null) wrong.push("src/shared/hooks/useLaneWatch.ts is not there");
  else {
    const body = code(lane);
    if (!/export function useLaneWatch\s*\(/.test(body)) wrong.push("useLaneWatch.ts exports no useLaneWatch function");
    if (!body.includes("'watch.start'") && !body.includes('"watch.start"')) wrong.push("useLaneWatch sends no watch.start");
    if (!body.includes("'watch.stop'") && !body.includes('"watch.stop"')) wrong.push("useLaneWatch sends no watch.stop");
    if (!lane.includes("websocket_reconnected")) wrong.push("useLaneWatch does not start again on websocket_reconnected");
    if (/setInterval|setTimeout/.test(body)) wrong.push("useLaneWatch arms a timer");
  }
  const hook = read(HOOK);
  if (hook === null) wrong.push("src/modules/chat/hooks/useSubagentTranscript.ts is not there");
  else {
    const body = code(hook);
    if (!/\buseLaneWatch\s*\(/.test(body) || !/['"]subagent_transcript['"]/.test(body)) wrong.push("useSubagentTranscript does not watch the subagent_transcript lane through useLaneWatch");
    if (!body.includes("subagent_transcript_changed")) wrong.push("useSubagentTranscript names no subagent_transcript_changed");
    if (!/\.key\b/.test(body)) wrong.push("useSubagentTranscript never reads a frame's key, so another view's frame would read it too");
    if (!/agent:\$\{[^}]+\}:\$\{[^}]+\}/.test(body)) wrong.push("useSubagentTranscript builds no agent:<session>:<toolUseId> key, the only agent key the server resolves");
    if (!/useServerFrame\s*\(/.test(body) && !body.includes("websocket_reconnected")) wrong.push("useSubagentTranscript does not read again on reconnect");
    if (/setInterval|setTimeout/.test(body)) wrong.push("useSubagentTranscript still arms a timer");
    if (/\bpoll(s|ed|ing)?\b/i.test(comments(hook))) wrong.push("a comment of useSubagentTranscript still describes a poll");
  }
  for (const file of sourcesUnder(path.join(ROOT, "src"))) {
    if (/\bTRANSCRIPT_POLL_MS\b/.test(fs.readFileSync(file, "utf8"))) wrong.push(path.relative(ROOT, file) + " names TRANSCRIPT_POLL_MS");
  }
  if (wrong.length > 0) return broken([...new Set(wrong)].join("; "));
  return held("the view watches subagent_transcript through useLaneWatch with the server's key shape, reads on its own key's frame and on reconnect, arms no timer; TRANSCRIPT_POLL_MS and the poll's comments are gone; useLaneWatch starts, restarts on reconnect and stops with no timer");
});
