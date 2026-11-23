// protects: /opt/eis-app/walk/screens.toml, /opt/eis-app/walk/app.mjs
// writes: none
//
// The words that keep Restorly's dictionary honest reach whoever edits its walk folder: a docstore row governing it says a
// change which moves a screen updates screens.toml in the same change. Retiring it, or narrowing its governs, breaks this.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const WEB_WALK = "/home/lyphe/.claude/scripts/web-walk";
const WALK = "/opt/eis-app/walk";
const DICTIONARY = WALK + "/screens.toml";
const ADAPTER = WALK + "/app.mjs";
const APPS = "/home/lyphe/.claude/hooks/web_walk/apps.toml";
const LIBRARY = "/home/lyphe/.claude/hooks/web_walk/node/package.json";
const first = (text) => String(text ?? "").trim().split("\n")[0] ?? "";
const lastLine = (text) => String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
const json = (line) => { try { return JSON.parse(line); } catch { return null; } };
const walkWith = (args, { input, env = {} } = {}) => {
  const base = { ...process.env };
  delete base.WEB_WALK_OUT; delete base.WEB_WALK_PICTURE_BYTES; delete base.WEB_WALK_APPS;
  return spawnSync(WEB_WALK, args, { input, encoding: "utf8", env: { ...base, ...env }, timeout: 105000, maxBuffer: 64 << 20 });
};
/** The dictionary read with the walk library's own TOML parser; null when the parser will not load. */
async function readToml(file) {
  const require = createRequire(LIBRARY);
  const { parse } = await import(pathToFileURL(require.resolve("smol-toml")).href);
  return parse(fs.readFileSync(file, "utf8"));
}
/** The live registry's restorly row, copied with some keys replaced and the given defaults. */
function restorlyRow(replace, defaults) {
  const text = fs.readFileSync(APPS, "utf8");
  const start = text.indexOf("[app.restorly]");
  const end = text.indexOf("[app.restorly.defaults]");
  if (start < 0 || end < start) return null;
  let row = text.slice(start, end);
  for (const [key, value] of Object.entries(replace)) row = row.replace(new RegExp("^" + key + "\\s*=.*$", "m"), key + " = " + JSON.stringify(value));
  return row + "[app.restorly.defaults]\n" + Object.entries(defaults).map(([k, v]) => k + " = " + JSON.stringify(v)).join("\n") + "\n";
}

const DOCSTORE = "/home/lyphe/.claude/scripts/docstore";
function rowsFor(file) {
  const r = spawnSync(DOCSTORE, ["govern", file, "--touch", "write", "--limit", "25", "--text"], { encoding: "utf8", timeout: 30000 });
  return (r.stdout ?? "").split("\n").map((l) => l.trim().split(" ")[0]).filter((tok) => /^(MAN|INV)-\d+$/.test(tok));
}
runCase(async () => {
  const saying = new Map();
  const says = (tok) => {
    if (!saying.has(tok)) { const r = spawnSync(DOCSTORE, ["get", tok, "--text"], { encoding: "utf8", timeout: 30000 }); const b = r.stdout ?? ""; saying.set(tok, /screens\.toml/.test(b) && /same change/i.test(b)); }
    return saying.get(tok);
  };
  const a = rowsFor(DICTIONARY).filter(says), b = rowsFor(ADAPTER).filter(says);
  const both = a.filter((tok) => b.includes(tok));
  if (both.length === 0) return broken("no row governing both walk files says a moved screen updates screens.toml in the same change (screens.toml: " + (a.join(" ") || "none") + "; app.mjs: " + (b.join(" ") || "none") + ")");
  return held(both.join(" ") + " governs the walk folder and says it");
});
