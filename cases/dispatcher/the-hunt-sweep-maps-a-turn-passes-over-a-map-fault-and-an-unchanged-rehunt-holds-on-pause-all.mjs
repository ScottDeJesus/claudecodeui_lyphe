// `hunt_rule.sweep` (hooks/dispatcher/hunt_rule.py), past its settle and close rules, walks `hunt_turns.order` from the
// first turn. Seam 6: a turn whose pass is open is taken; a turn with no pass is mapped and a pass opened
// (`hunt_map` then `store_hunts.open_pass`); a re-hunt `open_pass` answers None for is passed over; a `MapFault` writes a
// sitting row `ended`/`failed` with no launch and the cause `could not be mapped: <the fault>` and is passed over; none
// left closes the night `nothing left to hunt`. Then the hold: Pause all logs `hunt held — <words>`; else
// `hunt_sitting.start` is handed the turn's pass.
//
// One scratch store, order ["code"], two projects: "Gone", whose folder does not exist (a map fault), then "Proj", a git
// folder of six files. `hunt_sitting.start` is replaced with a recorder BEFORE hunt_rule is imported, so no hunter is
// ever launched and the start the sweep would make is read off the recorder. The pacer context handed is None (the
// house's sweeps take `Context | None`; a pacer that cannot answer is no hold). Pause all is a scratch dial
// (DISPATCHER_EPICS_FLAG_PATH), so the operator's own dial is never read or written.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_rule.py, /home/lyphe/.claude/hooks/dispatcher/hunt_turns.py, /home/lyphe/.claude/hooks/dispatcher/store_hunts.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { exec, rows } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { lastLine, setProjects } from "../lib/hunt_map_house.mjs";
import { FILES, marksHouse } from "../lib/hunt_marks_house.mjs";
import { sittingPy } from "../lib/hunt_sitting_house.mjs";

const SWEEP = `
from dispatcher import hunt_sitting as _hs
STARTS = []
def _start(conn, night, hunt, project, pass_id, *a, **k):
    STARTS.append({"night": night, "hunt": hunt, "project": project, "pass_id": pass_id})
    return f"hunt sitting stub out — {hunt}"
_hs.start = _start
try:
    from dispatcher import hunt_rule
except Exception as exc:
    print(json.dumps({"missing": f"hooks/dispatcher/hunt_rule.py cannot be imported: {type(exc).__name__}: {exc}"}))
    raise SystemExit(0)
from dispatcher import store
conn = store.connect()
try:
    lines = hunt_rule.sweep(conn, None)
    print(json.dumps({"lines": [str(l) for l in (lines or [])], "starts": STARTS}))
except Exception as exc:
    print(json.dumps({"raised": f"{type(exc).__name__}: {exc}", "starts": STARTS}))
`;

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString().replace(/\.\d{3}Z$/, "Z");

async function sweep(house) {
  const ran = await sittingPy(house, SWEEP);
  if (!ran.json) return { fault: `the sweep child printed no answer — ${lastLine(ran)}` };
  if (ran.json.missing) return { fault: ran.json.missing };
  if (ran.json.raised) return { fault: `hunt_rule.sweep raised ${ran.json.raised}` };
  return ran.json;
}

runCase(async (t) => {
  const house = await marksHouse(t, "hunt-sweep-turns", { files: FILES });
  const gone = path.join(house.dir, "no-such-folder");
  setProjects(house, [{ name: "Gone", path: gone }, { name: "Proj", path: house.repo }]);
  fs.writeFileSync(house.config, fs.readFileSync(house.config, "utf8").replace(/^order = \[.*\]$/m, 'order = ["code"]'));
  const dial = path.join(house.dir, "epics.flag");
  house.env.DISPATCHER_EPICS_FLAG_PATH = dial;
  const wrong = [];
  const passes = () => rows(house, "SELECT id, project, number, state FROM hunt_passes ORDER BY id");
  const faults = () => rows(house, "SELECT state, outcome, launch_id, cause FROM hunt_sittings WHERE project = ?", [gone]);

  // 1. Gone faults and is passed over; Proj is mapped, pass 1 opened, and start is handed it.
  const first = await sweep(house);
  if (first.fault) return broken(`the first sweep: ${first.fault}`);
  const f1 = await faults();
  if (f1.length !== 1 || f1[0].state !== "ended" || f1[0].outcome !== "failed" || f1[0].launch_id !== null
      || !String(f1[0].cause ?? "").startsWith("could not be mapped: ")) {
    wrong.push(`the map fault wrote ${JSON.stringify(f1)}, not one sitting ended/failed with no launch and "could not be mapped: …"`);
  }
  const p1 = await passes();
  const proj = p1.filter((p) => p.project === house.repo);
  if (p1.some((p) => p.project === gone)) wrong.push(`the map fault wrote a pass: ${JSON.stringify(p1)}`);
  if (proj.length !== 1 || proj[0].number !== 1 || proj[0].state !== "open") wrong.push(`Proj's passes read ${JSON.stringify(proj)}, not one open pass 1`);
  const units = proj.length ? (await rows(house, "SELECT count(*) AS n FROM hunt_units WHERE pass_id = ?", [proj[0].id]))[0].n : 0;
  if (units !== FILES.length) wrong.push(`Proj's pass 1 holds ${units} units, not its ${FILES.length} files`);
  const passId = proj[0]?.id ?? null;
  const want = JSON.stringify([{ night: house.night, hunt: "code", project: house.repo, pass_id: passId }]);
  if (JSON.stringify(first.starts) !== want) wrong.push(`the first sweep started ${JSON.stringify(first.starts)}, not ${want}`);

  // 2. A second sweep takes the same open pass; Gone, failed tonight, is not mapped again.
  const second = await sweep(house);
  if (second.fault) wrong.push(`the second sweep: ${second.fault}`);
  else if (JSON.stringify(second.starts) !== want) wrong.push(`the second sweep started ${JSON.stringify(second.starts)}, not the same pass: ${want}`);
  if ((await passes()).length !== p1.length) wrong.push(`the second sweep made another pass: ${JSON.stringify(await passes())}`);
  if ((await faults()).length !== 1) wrong.push(`the second sweep mapped Gone again: ${JSON.stringify(await faults())}`);

  // 3. Pause all: `hunt held — …` and no start.
  fs.writeFileSync(dial, "paused yes\n");
  const paused = await sweep(house);
  fs.rmSync(dial, { force: true });
  if (paused.fault) wrong.push(`the paused sweep: ${paused.fault}`);
  else {
    if (paused.starts.length) wrong.push(`with Pause all on the sweep started ${JSON.stringify(paused.starts)}`);
    if (!paused.lines.some((l) => l.startsWith("hunt held — "))) wrong.push(`with Pause all on the sweep said ${JSON.stringify(paused.lines)}, no "hunt held — …" line`);
  }

  // 4. Pass 1 done, every unit covered, nothing changed: no pass 2, the night closes `nothing left to hunt`.
  if (passId !== null) {
    await exec(house, "UPDATE hunt_units SET state = 'covered', note = 'read it', marked_at = ? WHERE pass_id = ?", [iso(-60000), passId]);
    await exec(house, "UPDATE hunt_passes SET state = 'done', done_at = ? WHERE id = ?", [iso(-60000), passId]);
    const last = await sweep(house);
    if (last.fault) wrong.push(`the last sweep: ${last.fault}`);
    else if (last.starts.length) wrong.push(`with nothing changed the sweep started ${JSON.stringify(last.starts)}`);
    if ((await passes()).length !== p1.length) wrong.push(`an unchanged re-hunt made a pass: ${JSON.stringify(await passes())}`);
    const n = (await rows(house, "SELECT state, why FROM hunt_nights WHERE night = ?", [house.night]))[0];
    if (n.state !== "closed" || n.why !== "nothing left to hunt") wrong.push(`with nothing left the night reads ${JSON.stringify(n)}, not closed "nothing left to hunt"`);
    if ((await faults()).length !== 1) wrong.push(`the last sweep mapped Gone again: ${JSON.stringify(await faults())}`);
  }

  if (wrong.length) return broken(wrong.join("; "));
  return held(`Gone: one failed sitting "${f1[0].cause.slice(0, 80)}"; Proj: pass 1 of ${units} units handed to start, twice; Pause all: "${paused.lines.find((l) => l.startsWith("hunt held — "))}"; unchanged re-hunt: no pass 2, night closed "nothing left to hunt"`);
});
