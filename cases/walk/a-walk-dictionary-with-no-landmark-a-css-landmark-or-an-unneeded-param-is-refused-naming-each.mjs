// The dictionary is checked when it is read: under a scratch registry (WEB_WALK_APPS) whose cloudcli row names a
// scratch copy of walk/screens.toml, the copy as shipped lists its screens, and each of three broken copies is refused
// naming the file, the screen and the key: an entry with no landmark, a landmark named by position (css), a path
// holding a {param} its needs do not hold. No browser opens; only the scratch folder is written.
//
// protects: /home/lyphe/.claude/hooks/web_walk/node/, /home/lyphe/.claude/hooks/web_walk/apps.toml, walk/screens.toml
// writes: none

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

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

const REGISTRY = "/home/lyphe/.claude/hooks/web_walk/apps.toml";
const HEADER = /^\s*\[\[?\s*[^\]]+\]\]?\s*$/m;

function withoutLandmark(text, screen) {
  const at = text.search(new RegExp(`^[ \\t]*\\[\\s*screen\\.(?:"${screen}"|${screen})\\s*\\]\\s*$`, "m"));
  if (at < 0) return null;
  const headerEnd = text.indexOf("\n", at) + 1;
  const next = text.slice(headerEnd).search(HEADER);
  const end = next < 0 ? text.length : headerEnd + next;
  const body = text.slice(headerEnd, end);
  const cut = body.replace(/^\s*landmark\s*=.*(\n|$)/m, "");
  return cut === body ? null : text.slice(0, headerEnd) + cut + text.slice(end);
}

runCase(async (t) => {
  if (!fs.existsSync(WEB_WALK)) return broken(`${WEB_WALK} is not on disk`);
  if (!fs.existsSync(REGISTRY)) return broken(`${REGISTRY} is not on disk`);
  if (!fs.existsSync(DICTIONARY)) return broken("walk/screens.toml is not on disk");
  const registry = fs.readFileSync(REGISTRY, "utf8");
  if (!registry.includes(DICTIONARY)) return broken(`the registry does not name ${DICTIONARY}`);
  const shipped = fs.readFileSync(DICTIONARY, "utf8");
  const dir = await scratchDir(t, "walk-refusals");
  const screensUnder = (label, dictionaryText) => {
    const dictionary = path.join(dir, `${label}.toml`);
    const apps = path.join(dir, `apps-${label}.toml`);
    fs.writeFileSync(dictionary, dictionaryText);
    fs.writeFileSync(apps, registry.split(DICTIONARY).join(dictionary));
    const ran = walkWith(["screens", "cloudcli"], { env: { WEB_WALK_APPS: apps } });
    return { dictionary, status: ran.error ? `error ${ran.error.message}` : ran.status, words: `${ran.stdout}\n${ran.stderr}`, lines: ran.stdout.split("\n").filter((l) => l.trim()).length };
  };
  const plain = screensUnder("shipped", shipped);
  if (plain.status !== 0 || plain.lines === 0) return broken(`the shipped copy under a scratch registry: exit ${plain.status}, ${plain.lines} lines: ${firstLine(plain.words)}`);
  const noLandmark = withoutLandmark(shipped, "analytics");
  if (!noLandmark) return cannotRun("the shipped [screen.analytics] holds no one-line landmark to take away");
  const copies = [
    { label: "no-landmark", text: noLandmark, screen: "analytics", keys: ["landmark"] },
    { label: "css-landmark", text: `${shipped}\n[screen.athena-css]\nsays = "a screen its landmark names by position"\nlandmark = { css = "main" }\n`, screen: "athena-css", keys: ["css"] },
    { label: "unneeded-param", text: `${shipped}\n[screen.athena-param]\nsays = "a screen whose path holds a parameter it does not need"\nlandmark = "Analytics"\npath = "/athena/{who}"\n`, screen: "athena-param", keys: ["who", "path", "needs"] },
  ];
  const wrong = [];
  const said = [];
  for (const c of copies) {
    const r = screensUnder(c.label, c.text);
    const names = r.words.includes(r.dictionary) && r.words.includes(c.screen) && c.keys.some((k) => r.words.includes(k));
    if (r.status === 0 || !names) wrong.push(`${c.label}: exit ${r.status}, words "${r.words.trim().slice(0, 200)}"`);
    else said.push(`${c.label}: ${r.words.trim().split("\n").find((l) => l.includes(c.screen))?.slice(0, 120)}`);
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held(`the shipped copy lists ${plain.lines} lines; refused: ${said.join(" | ")}`);
});
