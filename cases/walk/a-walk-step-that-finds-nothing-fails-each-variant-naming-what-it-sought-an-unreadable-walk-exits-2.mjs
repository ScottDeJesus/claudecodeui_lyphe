// A step that finds nothing ends its variant and only its variant: at phone and desktop a see step naming a thing
// no screen draws leaves one failed row per variant, each saying what it sought, a picture labelled "failed: <step>",
// and no shot after it; the command still prints its one answer line and exits 0. A walk file that is not JSON is
// the other ending: exit 2 with why on stderr, and no answer.
//
// protects: /home/lyphe/.claude/hooks/web_walk/node/, walk/app.mjs, walk/screens.toml
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

const SOUGHT = "Athena sought this and no screen draws it 7f3a";
const WALK = { app: "cloudcli", sizes: ["phone", "desktop"], timeout_ms: 100000, steps: [{ open: "analytics" }, { see: SOUGHT }, { shot: "after" }] };

runCase(async (t) => {
  if (!fs.existsSync(WEB_WALK)) return broken(`${WEB_WALK} is not on disk`);
  await api("/api/user/preferences"); // the server answers, or the case CANNOT RUN
  const out = await scratchDir(t, "walk-fails");
  const ran = walkWith(["run", "-", "--out", out], { input: JSON.stringify(WALK) });
  if (ran.error) return broken(`web-walk run did not end: ${ran.error.message}`);
  const answer = parse(lastLine(ran.stdout));
  if (ran.status !== 0 || !answer) return broken(`exit ${ran.status}, last line not an answer: ${lastLine(ran.stdout).slice(0, 160) || firstLine(ran.stderr)}`);
  if (answer.fault?.kind === "app-down") return cannotRun(`the app is down: ${answer.fault.why}`);
  const wrong = [];
  if (answer.ok !== false) wrong.push(`ok ${answer.ok}`);
  const failed = answer.failed ?? [];
  const variants = answer.variants ?? [];
  if (variants.length !== 2) wrong.push(`variants ${JSON.stringify(variants)}`);
  for (const v of variants) {
    const row = failed.find((f) => f.variant === v);
    if (!row) wrong.push(`no failed row for ${v}`);
    else if (row.kind !== "see" || !String(row.why).includes(SOUGHT)) wrong.push(`${v} failed ${JSON.stringify(row).slice(0, 200)}`);
  }
  const failedPictures = Object.keys(answer.pictures ?? {}).filter((k) => k.startsWith("failed: "));
  if (failedPictures.length === 0) wrong.push(`no "failed: <step>" picture among ${JSON.stringify(Object.keys(answer.pictures ?? {}))}`);
  if (answer.shots?.after) wrong.push("the shot after the failed step was taken");
  const bad = path.join(out, "unreadable.json");
  fs.writeFileSync(bad, "{ this is not json");
  const refused = walkWith(["run", bad, "--out", out]);
  const refusedAnswer = parse(lastLine(refused.stdout));
  if (refused.status !== 2 || !refused.stderr.trim() || (refusedAnswer && "ok" in refusedAnswer)) wrong.push(`an unreadable walk: exit ${refused.status}, stderr "${firstLine(refused.stderr)}", last line ${lastLine(refused.stdout).slice(0, 80)}`);
  if (wrong.length) return broken(wrong.join("; "));
  return held(`both variants failed at the see step naming what it sought, picture "${failedPictures[0]}", no later shot; the unreadable walk exit 2: ${firstLine(refused.stderr).slice(0, 100)}`);
});
