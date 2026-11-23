// A screen reached through a parent that carries a parameter is reached under the parameter its own open names, even
// when the page already stands on a sibling reached through that parent under another value. Under a scratch registry
// whose cloudcli row names a scratch copy of walk/screens.toml with a parent seeded from {who} and two screens reached
// from it, a walk opens the first child with who=AAA, then the second with who=BBB, and reads the seeded value after
// each. Only the scratch folder is written; told is answered by a stand-in python3, so no walk is recorded.
//
// protects: /home/lyphe/.claude/hooks/web_walk/node/, /home/lyphe/.claude/hooks/web_walk/apps.toml
// writes: none

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const WEB_WALK = "/home/lyphe/.claude/scripts/web-walk";
const REGISTRY = "/home/lyphe/.claude/hooks/web_walk/apps.toml";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DICTIONARY = path.join(REPO, "walk", "screens.toml");
const MENU = '{ role = "button", name = "Menu", exact = true }';
const EXTRA = `
[screen.case-parent]
says = "a parent screen seeded from a parameter"
seed = { local = { "case-who" = "{who}" } }
needs = ["who"]
landmark = ${MENU}

[screen.case-one]
says = "the first screen reached from the parent"
from = "case-parent"
steps = [{ wait = ${MENU} }]
landmark = ${MENU}

[screen.case-two]
says = "the second screen reached from the parent"
from = "case-parent"
steps = [{ wait = ${MENU} }]
landmark = ${MENU}
`;
const READ = "async ({page}) => page.evaluate(() => localStorage.getItem('case-who'))";
const parse = (line) => { try { return JSON.parse(line); } catch { return null; } };

runCase(async (t) => {
  if (!fs.existsSync(WEB_WALK)) return broken(`${WEB_WALK} is not on disk`);
  const registry = fs.readFileSync(REGISTRY, "utf8");
  if (!registry.includes(DICTIONARY)) return broken(`the registry does not name ${DICTIONARY}`);
  const dir = await scratchDir(t, "walk-resume-params");
  const dictionary = path.join(dir, "screens.toml");
  const apps = path.join(dir, "apps.toml");
  const bin = path.join(dir, "bin");
  fs.writeFileSync(dictionary, fs.readFileSync(DICTIONARY, "utf8") + EXTRA);
  fs.writeFileSync(apps, registry.split(DICTIONARY).join(dictionary));
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "python3"), "#!/bin/sh\ncat >/dev/null; exit 0\n", { mode: 0o755 });
  const walk = { app: "cloudcli", sizes: ["desktop"], themes: ["light"], steps: [
    { open: "case-one", with: { who: "AAA" } }, { step: "first", run: READ },
    { open: "case-two", with: { who: "BBB" } }, { step: "second", run: READ },
  ] };
  const base = { ...process.env };
  delete base.WEB_WALK_OUT; delete base.WEB_WALK_PICTURE_BYTES;
  const ran = spawnSync(WEB_WALK, ["run", "-", "--out", path.join(dir, "out")], {
    input: JSON.stringify(walk), encoding: "utf8", timeout: 110000, maxBuffer: 64 << 20,
    env: { ...base, WEB_WALK_APPS: apps, PATH: `${bin}:${base.PATH}` },
  });
  if (ran.error) return cannotRun(`web-walk run: ${ran.error.message}`);
  const answer = parse(ran.stdout.trim().split("\n").pop() ?? "");
  if (ran.status !== 0 || !answer) return cannotRun(`web-walk run exit ${ran.status}: ${(ran.stderr || ran.stdout).trim().split("\n")[0]}`);
  if (answer.fault) return cannotRun(`the walk's fault: ${answer.fault.kind} — ${answer.fault.why}`);
  if (answer.read?.first !== "AAA") return cannotRun(`the parent's seed did not take on the first open: read ${JSON.stringify(answer.read)}; failed ${JSON.stringify(answer.failed).slice(0, 300)}`);
  if (answer.read?.second !== "BBB") return broken(`the second screen, opened with who=BBB, stood under who=${answer.read?.second}: the parent it shares with the first was not reached again under the new parameter`);
  return held("the first screen read who=AAA and the second, opened through the same parent with who=BBB, read BBB");
});
