// web-walk reach cloudcli opens every screen CloudCLI's walk dictionary (walk/screens.toml) names, at desktop in
// the app's own theme, and prints one line each; every one of them must say reached. A change that moves a screen
// and leaves its entry behind breaks this, as does an entry whose landmark the app no longer draws.
//
// The command is run as a person runs it, a child process of this case; reach tells nothing and writes nothing.
//
// protects: walk/, /home/lyphe/.claude/hooks/web_walk/node/, /home/lyphe/.claude/hooks/web_walk/apps.toml, src/modules/project-workspace/, src/modules/analytics/, src/modules/settings/
// writes: none

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { api } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

const WEB_WALK = "/home/lyphe/.claude/scripts/web-walk";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DICTIONARY = path.join(REPO, "walk", "screens.toml");
const lastLine = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
const parse = (line) => { try { return JSON.parse(line); } catch { return null; } };
const firstLine = (text) => (text ?? "").trim().split("\n")[0] ?? "";
const walkWith = (args, { input, env = {} } = {}) => {
  const base = { ...process.env };
  delete base.WEB_WALK_OUT; delete base.WEB_WALK_PICTURE_BYTES; delete base.WEB_WALK_APPS;
  return spawnSync(WEB_WALK, args, { input, encoding: "utf8", env: { ...base, ...env }, timeout: 110000, maxBuffer: 64 << 20 });
};

const SCREEN = /^\s*\[\s*screen\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\s*\]\s*$/gm;

/** The dictionary name a reach line is about: the one standing earliest in it, the longest at that place. */
function screenOf(line, names) {
  let best = null;
  for (const name of names) {
    const at = line.search(new RegExp(`(^|[^\\w-])${name.replace(/[-]/g, "\\-")}([^\\w-]|$)`));
    if (at < 0) continue;
    if (!best || at < best.at || (at === best.at && name.length > best.name.length)) best = { at, name };
  }
  return best?.name ?? null;
}

runCase(async () => {
  if (!fs.existsSync(WEB_WALK)) return broken(`${WEB_WALK} is not on disk`);
  if (!fs.existsSync(DICTIONARY)) return broken("walk/screens.toml is not on disk");
  const names = [...fs.readFileSync(DICTIONARY, "utf8").matchAll(SCREEN)].map((m) => m[1] ?? m[2]);
  if (names.length === 0) return broken("walk/screens.toml holds no [screen.<name>] table");
  await api("/api/user/preferences"); // the server answers, or the case CANNOT RUN
  const ran = walkWith(["reach", "cloudcli"]);
  if (ran.error) return broken(`web-walk reach cloudcli did not end: ${ran.error.message}`);
  const lines = ran.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return broken(`reach printed nothing (exit ${ran.status}): ${firstLine(ran.stderr)}`);
  const byScreen = new Map();
  for (const line of lines) { const name = screenOf(line, names); if (name && !byScreen.has(name)) byScreen.set(name, line); }
  const silent = names.filter((n) => !byScreen.has(n));
  const unreached = [...byScreen.entries()].filter(([, l]) => !/\breached\b/i.test(l) || /\bnot\b|unreached|never/i.test(l));
  const wrong = [];
  if (silent.length) wrong.push(`no line for ${silent.length} of ${names.length}: ${silent.slice(0, 8).join(", ")}`);
  if (unreached.length) wrong.push(`${unreached.length} not reached: ${unreached.slice(0, 4).map(([, l]) => l.slice(0, 140)).join(" | ")}`);
  if (wrong.length) return broken(wrong.join("; "));
  return held(`all ${names.length} screens of walk/screens.toml reached at desktop, one line each`);
});
