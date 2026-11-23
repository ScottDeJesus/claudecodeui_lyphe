// One walk fanned over phone and desktop in light and dark, through the command as a script hands it a walk
// (`web-walk run -`, the walk on stdin and its custom step as source text): four variants, each drawn as its name
// says, one captioned sheet per label under the picture byte limit, and the dev account's stored theme preference
// left as it was, since the adapter pins the theme on its own context's requests and never writes it.
//
// The pictures and the report go under the case's scratch folder (--out).
//
// protects: walk/app.mjs, /home/lyphe/.claude/hooks/web_walk/node/, /home/lyphe/.claude/hooks/web_walk/apps.toml, src/shared/context/ThemeContext.tsx
// writes: none

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { api } from "../lib/app.mjs";
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

const VARIANTS = ["desktop/dark", "desktop/light", "phone/dark", "phone/light"];
const PICTURE_BYTES = 1500000;
const WALK = {
  app: "cloudcli", sizes: ["phone", "desktop"], themes: ["light", "dark"], timeout_ms: 100000,
  steps: [
    { open: "analytics" },
    { step: "drawn", run: "async ({ page }) => page.evaluate(() => ({ dark: document.documentElement.classList.contains('dark'), coarse: matchMedia('(pointer: coarse)').matches, still: matchMedia('(prefers-reduced-motion: reduce)').matches }))" },
    { shot: "analytics" },
  ],
};

const themeOf = async () => {
  const { status, json } = await api("/api/user/preferences");
  if (status !== 200) throw new Error(`GET /api/user/preferences answered ${status}`);
  const prefs = json?.preferences ?? json ?? {};
  return JSON.stringify(Object.fromEntries(Object.entries(prefs).filter(([k]) => /theme|sun|dark/i.test(k))));
};

runCase(async (t) => {
  if (!fs.existsSync(WEB_WALK)) return broken(`${WEB_WALK} is not on disk`);
  let before;
  try { before = await themeOf(); } catch (e) { return cannotRun(e.message); }
  const out = await scratchDir(t, "walk-fan");
  const ran = walkWith(["run", "-", "--out", out], { input: JSON.stringify(WALK) });
  if (ran.error) return broken(`web-walk run did not end: ${ran.error.message}`);
  const answer = parse(lastLine(ran.stdout));
  if (ran.status !== 0 || !answer) return broken(`exit ${ran.status}, last line not an answer: ${lastLine(ran.stdout).slice(0, 160) || firstLine(ran.stderr)}`);
  if (answer.fault?.kind === "app-down") return cannotRun(`the app is down: ${answer.fault.why}`);
  const wrong = [];
  if (answer.ok !== true) wrong.push(`ok ${answer.ok}: ${String(answer.summary).slice(0, 200)}`);
  const keys = Object.keys(answer);
  if (!(keys.indexOf("pictures") >= 0 && keys.indexOf("pictures") < keys.indexOf("shots"))) wrong.push(`pictures does not stand before shots (${keys.join(",")})`);
  if (JSON.stringify([...(answer.variants ?? [])].sort()) !== JSON.stringify(VARIANTS)) wrong.push(`variants ${JSON.stringify(answer.variants)}`);
  if (typeof answer.summary !== "string" || answer.summary.length > 1200) wrong.push(`summary ${answer.summary?.length} chars`);
  for (const v of VARIANTS) {
    const d = answer.read?.drawn?.[v];
    if (!d) { wrong.push(`read.drawn has no ${v}`); continue; }
    if (d.dark !== v.endsWith("/dark") || d.coarse !== v.startsWith("phone/") || d.still !== true) wrong.push(`${v} drawn ${JSON.stringify(d)}`);
  }
  const labels = Object.keys(answer.pictures ?? {});
  const sheet = answer.pictures?.analytics;
  if (labels.length !== 1 || typeof sheet !== "string" || !path.isAbsolute(sheet) || !fs.existsSync(sheet)) wrong.push(`pictures ${JSON.stringify(answer.pictures)}`);
  else if (fs.statSync(sheet).size > PICTURE_BYTES) wrong.push(`the sheet is ${fs.statSync(sheet).size} bytes`);
  const shots = answer.shots?.analytics ?? {};
  const shotFiles = VARIANTS.filter((v) => typeof shots[v] === "string" && fs.existsSync(shots[v]));
  if (shotFiles.length !== 4) wrong.push(`shots.analytics ${JSON.stringify(shots)}`);
  const report = typeof answer.report === "string" && fs.existsSync(answer.report) ? parse(fs.readFileSync(answer.report, "utf8")) : null;
  if (!report || report.ok !== answer.ok || JSON.stringify(report.variants) !== JSON.stringify(answer.variants)) wrong.push(`report ${answer.report} is not the answer`);
  const after = await themeOf();
  if (after !== before) wrong.push(`the stored theme preference moved: ${before} → ${after}`);
  if (wrong.length) return broken(wrong.join("; "));
  return held(`4 variants drawn as named, one sheet of ${fs.statSync(sheet).size} bytes, 4 shots, report ${path.basename(answer.report)}, theme preference unchanged ${before}`);
});
