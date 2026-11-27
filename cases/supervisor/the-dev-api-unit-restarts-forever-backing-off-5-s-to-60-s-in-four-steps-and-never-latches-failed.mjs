// protects: deploy/systemd/cloudcli-server-dev.service, deploy/systemd/install.sh
// writes: none
// The dev API's unit never latches failed: no start limit, Restart=always backing off from 5 s to 60 s in four steps, and its
// comments name no watchdog. Judged on the file and on the unit systemd has loaded (systemctl show), read only.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const UNIT_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../deploy/systemd/cloudcli-server-dev.service");
const PROPERTIES = ["LoadState", "Restart", "RestartUSec", "RestartSteps", "RestartMaxDelayUSec", "StartLimitIntervalUSec", "StartLimitBurst"];

runCase(async () => {
  const text = fs.readFileSync(UNIT_FILE, "utf8");
  const sections = {};
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[(\w+)\]$/);
    if (header) { current = header[1]; sections[current] ??= []; continue; }
    if (current) sections[current].push(line.replace(/\s*=\s*/, "="));
  }
  const has = (section, line) => (sections[section] ?? []).includes(line);
  const wrong = [];
  if (!has("Unit", "StartLimitIntervalSec=0")) wrong.push("[Unit] lacks StartLimitIntervalSec=0");
  for (const section of Object.keys(sections)) {
    for (const line of sections[section]) {
      if (/^StartLimitBurst=/.test(line) || /^StartLimitInterval(Sec)?=(?!0$)/.test(line)) wrong.push("[" + section + "] still says " + line);
    }
  }
  for (const line of ["Restart=always", "RestartSec=5", "RestartSteps=4", "RestartMaxDelaySec=60"]) {
    if (!has("Service", line)) wrong.push("[Service] lacks " + line);
  }
  const naming = text.split("\n").filter((line) => /watchdog/i.test(line)).length;
  if (naming) wrong.push(naming + " line(s) of the file name a watchdog");

  let shown;
  try {
    shown = execFileSync("systemctl", ["show", "cloudcli-server-dev", ...PROPERTIES.flatMap((name) => ["-p", name])], { encoding: "utf8", timeout: 10000 });
  } catch (error) {
    return cannotRun("systemctl show would not run: " + String(error?.message ?? error).split("\n")[0]);
  }
  const live = Object.fromEntries(shown.trim().split("\n").map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  if (live.LoadState !== "loaded") return cannotRun("cloudcli-server-dev is " + (live.LoadState || "unknown") + " on this box");
  if (live.Restart !== "always") wrong.push("systemd has Restart=" + live.Restart);
  if (live.RestartUSec !== "5s") wrong.push("systemd has RestartUSec=" + live.RestartUSec);
  if (live.RestartSteps !== "4") wrong.push("systemd has RestartSteps=" + (live.RestartSteps ?? "(none)"));
  if (!/^(1min|60s)$/.test(live.RestartMaxDelayUSec ?? "")) wrong.push("systemd has RestartMaxDelayUSec=" + (live.RestartMaxDelayUSec ?? "(none)"));
  if (!/^(0|infinity)$/.test(live.StartLimitIntervalUSec ?? "")) wrong.push("systemd has StartLimitIntervalUSec=" + live.StartLimitIntervalUSec + " (StartLimitBurst=" + live.StartLimitBurst + ")");
  const said = PROPERTIES.slice(1).map((name) => name + "=" + live[name]).join(" ");
  return wrong.length ? broken(wrong.join("; ") + " | " + said) : held("file and loaded unit agree: " + said);
});
