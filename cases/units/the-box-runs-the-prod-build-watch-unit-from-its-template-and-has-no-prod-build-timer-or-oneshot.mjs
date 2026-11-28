// protects: deploy/systemd/cloudcli-client-prod-build-watch.service, deploy/systemd/install.sh, deploy/prod-client-watch/watch-build.mjs
// writes: none
//
// The box runs the production client's build watcher as a unit and nothing else rebuilds that client on a clock:
// cloudcli-client-prod-build-watch.service is install.sh's rendering of its template, enabled and active, restarting
// always with KillMode=mixed; cloudcli-client-prod-build.timer and its oneshot are gone from the box and the repo.
// Read only through systemctl and the filesystem.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(new URL("../..", import.meta.url).pathname);
const UNIT = "cloudcli-client-prod-build-watch.service";
const GONE = ["cloudcli-client-prod-build.timer", "cloudcli-client-prod-build.service"];
const UNITS_DIR = "/etc/systemd/system";

function show(unit, props) {
  const text = execFileSync("systemctl", ["show", unit, "-p", props.join(",")], { encoding: "utf8" });
  const facts = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) facts[line.slice(0, at)] = line.slice(at + 1);
  }
  return facts;
}

runCase(async () => {
  const template = path.join(REPO, "deploy", "systemd", UNIT);
  if (!fs.existsSync(template)) return broken("deploy/systemd has no " + UNIT + " template");
  const unit = show(UNIT, ["LoadState", "UnitFileState", "ActiveState", "Restart", "KillMode", "ExecStart", "FragmentPath"]);
  if (unit.LoadState !== "loaded") return broken(UNIT + " is " + unit.LoadState + ", not loaded");
  if (unit.UnitFileState !== "enabled") return broken(UNIT + " is " + unit.UnitFileState + ", not enabled");
  if (unit.ActiveState !== "active") return broken(UNIT + " is " + unit.ActiveState + ", not active");
  if (unit.Restart !== "always" || unit.KillMode !== "mixed") return broken(UNIT + " has Restart=" + unit.Restart + " KillMode=" + unit.KillMode);
  const watcher = path.join(REPO, "deploy", "prod-client-watch", "watch-build.mjs");
  if (!unit.ExecStart.includes("/usr/bin/node") || !unit.ExecStart.includes(watcher)) return broken(UNIT + " runs " + unit.ExecStart.slice(0, 160));
  const rendered = fs.readFileSync(template, "utf8").split("__REPO__").join(REPO).split("__HOME__").join(os.homedir()).split("__USER__").join(os.userInfo().username);
  const installedPath = path.join(UNITS_DIR, UNIT);
  if (unit.FragmentPath !== installedPath) return broken(UNIT + " loads from " + unit.FragmentPath);
  if (fs.readFileSync(installedPath, "utf8") !== rendered) return broken(installedPath + " is not install.sh's rendering of the repo's template");
  for (const name of GONE) {
    if (fs.existsSync(path.join(UNITS_DIR, name))) return broken(path.join(UNITS_DIR, name) + " is still on the box");
    const load = show(name, ["LoadState"]).LoadState;
    if (load !== "not-found") return broken(name + " is still " + load);
    if (fs.existsSync(path.join(REPO, "deploy", "systemd", name))) return broken("deploy/systemd still carries " + name);
  }
  const timers = execFileSync("systemctl", ["list-timers", "--all", "--no-legend"], { encoding: "utf8" });
  if (timers.includes("cloudcli-client-prod-build")) return broken("list-timers still names a cloudcli-client-prod-build timer");
  return held(UNIT + " enabled and active from its rendered template; no prod-build timer or oneshot on the box or in the repo");
});
