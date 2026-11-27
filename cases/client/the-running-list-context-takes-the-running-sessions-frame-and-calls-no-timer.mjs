// protects: src/shared/context/SessionProtectionContext.tsx, src/shared/hooks/useServerFrame.ts
// writes: none
// The sidebar's Running list and its marks are told, never polled (pollers-hooks--client-pushes, seam 7): with its
// comments left out, SessionProtectionContext.tsx calls no setInterval and no setTimeout, takes running_sessions_state
// through useServerFrame, and reads again when the tab is shown (visibilitychange); the shared hook answers
// websocket_reconnected, which is how a frame missed while the socket was down is healed.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONTEXT = "src/shared/context/SessionProtectionContext.tsx";
const HOOK = "src/shared/hooks/useServerFrame.ts";
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

runCase(async () => {
  let context;
  let hook;
  try { context = code(await readFile(path.join(REPO, CONTEXT), "utf8")); } catch { return broken(CONTEXT + " is not on disk"); }
  try { hook = code(await readFile(path.join(REPO, HOOK), "utf8")); } catch { return broken(HOOK + " is not on disk"); }
  const wrong = [];
  const timers = [...context.matchAll(/\b(?:window\.)?set(?:Interval|Timeout)\s*\(/g)].map((m) => m[0]);
  if (timers.length > 0) wrong.push(CONTEXT + " still calls " + timers.join(", "));
  if (!/['"]running_sessions_state['"]/.test(context)) wrong.push(CONTEXT + " names no running_sessions_state");
  if (!/useServerFrame\s*\(\s*\[[^\]]*(?:RUNNING_SESSIONS_STATE_KIND|['"]running_sessions_state['"])/.test(context)) wrong.push("no useServerFrame call of " + CONTEXT + " takes running_sessions_state");
  if (!/visibilitychange/.test(context)) wrong.push(CONTEXT + " reads nothing when the tab is shown (no visibilitychange)");
  if (!/['"]websocket_reconnected['"]/.test(hook)) wrong.push(HOOK + " answers no websocket_reconnected");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(CONTEXT + " calls no timer, takes running_sessions_state through useServerFrame and reads on visibilitychange; the hook answers websocket_reconnected");
});
