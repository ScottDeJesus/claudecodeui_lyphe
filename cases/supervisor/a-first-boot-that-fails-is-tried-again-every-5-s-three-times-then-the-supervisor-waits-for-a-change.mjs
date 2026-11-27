// protects: deploy/dev-supervisor/supervisor.mjs, deploy/dev-supervisor/heal.mjs, deploy/dev-supervisor/child.mjs
// writes: none
// A boot that fails with nothing serving is tried again by the supervisor itself, 5 s later, three times in a row, and then it
// waits for the next change instead of looping. The whole supervisor runs as a child process over a stand-in API that dies before
// READY on every boot, in a scratch repo (lib/dev_supervisor_rig.mjs).

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { startRig } from "../lib/dev_supervisor_rig.mjs";

const BOOT = /\[supervisor\] boot: pid \d+/;
const HEAL = /heal (\d+) of 3, booting again in 5 s/;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t) => {
  const rig = await startRig(t, { standIn: "failing" });
  const first = await rig.waitFor(/boot failed — no previous server/, 20000);
  if (!first) return cannotRun("the stand-in's first boot never failed: " + rig.tail());
  const waiting = await rig.waitFor(/it died 3 times on this code, waiting for the next change/, 40000, first.index + 1);
  if (!waiting) return broken("after the first failed boot: " + rig.tail(first.index + 1));
  await pause(8000);
  const wrong = [];
  const boots = rig.lines.filter((line) => BOOT.test(line.text));
  const heals = rig.lines.filter((line) => HEAL.test(line.text));
  const numbers = heals.map((line) => line.text.match(HEAL)[1]).join(",");
  if (numbers !== "1,2,3") wrong.push("the heal lines numbered " + (numbers || "none") + ", wanted 1,2,3");
  if (boots.length !== 4) wrong.push(boots.length + " boots, wanted 4 (the first and three heals)");
  const gaps = heals.map((heal) => {
    const boot = boots.find((line) => rig.lines.indexOf(line) > rig.lines.indexOf(heal));
    return boot ? boot.at - heal.at : null;
  });
  for (const gap of gaps) if (gap === null || gap < 4500) wrong.push("a heal's next boot came " + (gap === null ? "never" : gap + " ms") + " after it, wanted at least 4500 ms");
  return wrong.length
    ? broken(wrong.join("; ") + " | " + rig.tail(first.index))
    : held("4 boots; heal 1, 2, 3 of 3 each booting again " + gaps.join("/") + " ms later; then it died 3 times on this code, waiting for the next change, and no fifth boot in 8 s");
});
