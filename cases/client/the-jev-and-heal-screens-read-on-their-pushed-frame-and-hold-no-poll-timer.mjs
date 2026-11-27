// protects: src/modules/jev/useJevPanel.ts, src/modules/accounts/hooks/useJevBalance.ts, src/modules/heal/context/HealContext.tsx, src/shared/hooks/useServerFrame.ts
// writes: none
// The Jev panel, the Jev balance and the Heal screen are told, not ticked: each reads on its server frame
// (jev_changed, heal_changed) through useServerFrame, which also answers websocket_reconnected (frames were missed
// while the socket was down) and holds its callback in a ref so a new closure never resubscribes. None of the three
// keeps a setInterval or the constant that named its interval, and the panel still reads when the tab is shown.
// A reading of the source as it stands: a poll put back, or a rider that stops listening, reads BROKEN.

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const RIDERS = [
  { file: "src/modules/jev/useJevPanel.ts", kind: "jev_changed", constants: ["JEV_POLL_MS"] },
  { file: "src/modules/accounts/hooks/useJevBalance.ts", kind: "jev_changed", constants: ["BALANCE_POLL_MS"] },
  { file: "src/modules/heal/context/HealContext.tsx", kind: "heal_changed", constants: ["HEAL_POLL_MS"] },
];
const GONE_EVERYWHERE = ["JEV_POLL_MS", "HEAL_POLL_MS"];

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch (error) {
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
  const hook = read("src/shared/hooks/useServerFrame.ts");
  if (hook === null) wrong.push("src/shared/hooks/useServerFrame.ts is not there");
  else {
    if (!/export function useServerFrame\s*\(/.test(hook)) wrong.push("useServerFrame.ts exports no useServerFrame function");
    if (!hook.includes("websocket_reconnected")) wrong.push("useServerFrame does not answer websocket_reconnected");
    if (!/\bsubscribe\b/.test(hook)) wrong.push("useServerFrame does not subscribe through useWebSocket");
    if (!/\buseRef\s*\(/.test(hook)) wrong.push("useServerFrame holds its callback in no ref");
    if (/setInterval|setTimeout/.test(hook)) wrong.push("useServerFrame arms a timer");
  }
  for (const rider of RIDERS) {
    const text = read(rider.file);
    if (text === null) { wrong.push(`${rider.file} is not there`); continue; }
    if (!/\buseServerFrame\s*\(/.test(text)) wrong.push(`${rider.file} does not call useServerFrame`);
    if (!text.includes(`'${rider.kind}'`) && !text.includes(`"${rider.kind}"`)) wrong.push(`${rider.file} names no ${rider.kind}`);
    if (/setInterval\s*\(/.test(text)) wrong.push(`${rider.file} still calls setInterval`);
    for (const name of rider.constants) if (new RegExp(`\\b${name}\\b`).test(text)) wrong.push(`${rider.file} still names ${name}`);
  }
  const panel = read(RIDERS[0].file);
  if (panel !== null && !panel.includes("visibilitychange")) wrong.push("the Jev panel no longer reads when the tab is shown (no visibilitychange)");
  for (const file of sourcesUnder(path.join(ROOT, "src"))) {
    const text = fs.readFileSync(file, "utf8");
    for (const name of GONE_EVERYWHERE) if (new RegExp(`\\b${name}\\b`).test(text)) wrong.push(`${path.relative(ROOT, file)} names ${name}`);
  }
  if (wrong.length > 0) return broken([...new Set(wrong)].join("; "));
  return held("the Jev panel and balance ride jev_changed and the Heal provider heal_changed through useServerFrame (reconnect included, callback in a ref); no interval or poll constant left; the panel still reads when shown");
});
