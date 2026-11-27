// protects: deploy/systemd/install.sh, deploy/heal/dev-unit.sh, deploy/heal/bridge-drop.sh
// writes: none
//
// The two dev watchdogs are gone from the box once Cerberus keeps the dev units: no unit file, no script, no state directory, and
// systemd has nothing of them loaded; the storybook watchdog, which this work does not replace, is still installed. Read only:
// systemctl list-unit-files and show, and the filesystem. The removed names are joined at run time so this file names none of them.

import { execFileSync } from "node:child_process";
import fs from "node:fs";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const WORD = "watch" + "dog";
const GONE_UNITS = ["cloudcli-dev", "eis-app-dev"].flatMap((name) => [".service", ".timer"].map((kind) => name + "-" + WORD + kind));
const GONE_PATHS = [
  ...GONE_UNITS.map((unit) => "/etc/systemd/system/" + unit),
  "/usr/local/bin/cloudcli-dev-" + WORD + ".sh",
  "/usr/local/bin/eis-dev-" + WORD + ".sh",
  "/run/cloudcli-dev-" + WORD,
];
const STAYING_UNITS = ["eis-app-storybook-" + WORD + ".service", "eis-app-storybook-" + WORD + ".timer"];
const STAYING_SCRIPT = "/usr/local/bin/eis-storybook-" + WORD + ".sh";

const systemctl = (args) => execFileSync("systemctl", args, { encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] });

runCase(async () => {
  let listed;
  try {
    listed = systemctl(["list-unit-files", "--no-legend", "--no-pager"]);
  } catch (error) {
    return cannotRun("systemctl list-unit-files would not answer: " + String(error?.message).split("\n")[0]);
  }
  const named = listed.split("\n").map((line) => line.trim().split(/\s+/)[0]).filter((unit) => unit && unit.toLowerCase().includes(WORD)).sort();
  const wrong = [];
  if (JSON.stringify(named) !== JSON.stringify([...STAYING_UNITS].sort())) wrong.push("the unit files naming " + WORD + " are " + JSON.stringify(named));
  for (const gone of GONE_PATHS) if (fs.existsSync(gone)) wrong.push(gone + " still exists");
  for (const unit of GONE_UNITS) {
    let load = "";
    try { load = systemctl(["show", unit, "-p", "LoadState", "--value"]).trim(); } catch (error) { load = "(show failed)"; }
    if (load !== "not-found") wrong.push(unit + " is " + load + " in systemd");
  }
  if (!fs.existsSync(STAYING_SCRIPT)) wrong.push(STAYING_SCRIPT + " is gone");
  if (wrong.length) return broken(wrong.slice(0, 4).join("; ") + (wrong.length > 4 ? "; and " + (wrong.length - 4) + " more" : ""));
  return held("only the storybook " + WORD + " pair is installed, the two dev " + WORD + "s' units, scripts and state directory are gone and not loaded, and the storybook script stands");
});
