// `dispatcher hunt overdue SITTING` (hooks/dispatcher/cmd/hunt_night_acts.py → hunt_sitting.stop) is the hunt sitting's
// cap: the transient unit `hunt_sitting.start` arms runs it at the deadline plus grace, a deadline counted from the
// moment the row was written. A launch the runner holds back for the box's CPU (`plan_runner.pacer.cpu_wait`: its
// marker stands under `<pacer home>/cpu-wait/`, its wrapper alive) has not started its soul, and the house rule is that
// the CPU hold "does not count toward any agent's hour cap or a chain's stage timeout". So an overdue of a sitting whose
// launch still waits for CPU must signal nothing and leave the sitting out: its time has not begun.
//
// The launch is a stand-in this case starts in a session of its own (hunt_sitting_house.mjs `standIn`), carrying the
// launch's identity, with its CPU marker written where `cpu_marker.waiting` reads it in the scratch home; the case
// ends every process it started.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_sitting.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt_night_acts.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { exec, rows, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { hunt } from "../lib/hunt_house.mjs";
import { addPass, addSitting, FILES, logPathOf } from "../lib/hunt_marks_house.mjs";
import { alive, endStandIn, sittingHouse, sittingPy, standIn, writePids } from "../lib/hunt_sitting_house.mjs";

const MARKER = `
from plan_runner.pacer import cpu_marker
print(json.dumps({"path": cpu_marker._marker_path(sys.argv[1])}))
`;

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString().replace(/\.\d{3}Z$/, "Z");

runCase(async (t) => {
  const house = await sittingHouse(t, "hunt-overdue-cpu");
  const { passId } = await addPass(house, "code", FILES);
  const launch = "dispatch-hunter-case-cpu-1";
  const id = await addSitting(house, { hunt: "code", passId, launchId: launch });
  // Its limit and grace are past: written 80 minutes ago with a 60-minute deadline, as the armed unit would fire now.
  await exec(house, "UPDATE hunt_sittings SET started_at = ?, deadline = ? WHERE id = ?", [iso(-80 * 60000), iso(-20 * 60000), id]);
  const proc = standIn(house, launch);
  try {
    const kid = await proc.grandchild;
    if (!Number.isInteger(kid)) return broken("the stand-in did not start its sleep — the case cannot judge");
    await writePids(house, launch, proc.pid);
    const where = (await sittingPy(house, MARKER, [launch])).json?.path;
    if (!where) return broken("cpu_marker gave no marker path — the case cannot judge");
    // The child pid file is the launcher's until a soul exists; a held launch has no child.pid.
    fs.rmSync(path.join(path.dirname(await logPathOf(house, launch)), "child.pid"), { force: true });
    fs.mkdirSync(path.dirname(where), { recursive: true });
    fs.writeFileSync(where, JSON.stringify({ launch, label: "hunter hephaestus", since: Date.now() / 1000 - 80 * 60, words: "waiting for CPU", pid: proc.pid }));

    const ran = await hunt(house, ["overdue", String(id)]);
    await new Promise((r) => setTimeout(r, 1500));
    const row = (await rows(house, "SELECT state, cause FROM hunt_sittings WHERE id = ?", [id]))[0];
    const wrong = [];
    if (!alive(proc.pid)) wrong.push(`overdue ended the launcher that was still waiting for CPU (${said(ran)})`);
    if (row.state !== "out") wrong.push(`the sitting reads ${row.state}, not out`);
    if (row.cause) wrong.push(`the sitting carries the stop's cause ${JSON.stringify(row.cause)}, so its settle will read stopped`);
    if (wrong.length) return broken(wrong.join("; "));
    return held(`overdue of a CPU-held launch signalled nothing (${said(ran)}); the launcher lives and the sitting stays out with no stop written`);
  } finally {
    await endStandIn(proc);
  }
});
