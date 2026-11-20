// A quick tweak sitting's CHANGELOG line describes HIS edit. When the card goes the full way instead — he said
// `RESULT: MOVED` (he edited nothing), or the walk's checks refused the edit and it was taken back out — that line
// describes nothing that is in. A full-flow review that writes no line keeps the earlier one (`chain_card_rounds`),
// so a line kept from the sitting would settle on the card and in the reporter's word. The record must hold no
// changelog from the sitting once the walk moves on.
//
// A scratch plan-runner state; a tweak walk's record; `chain_card_tweak.run` with its sitting stood in for (the
// stage door, the done test, the account's path, the snapshot), the move's next walk (`chain_card.run`) stood in by a
// reader of the record, and, for the taken-back edit, the two checks stood in by a refusal. Nothing is launched.
//
// protects: /home/lyphe/.claude/hooks/plan_runner/solo/chain_card_tweak.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bugHouse } from "../lib/bug_house.mjs";
import { python } from "../lib/house_live.mjs";

const LINE = "The save button is now bigger.";
const MOVED = `Located it on two screens.\nRESULT: MOVED\nMOVE: change — drawn on two screens\nCHANGELOG: ${LINE}\n`;
const DONE = `Edited it.\nRESULT: DONE\nCHANGELOG: ${LINE}\nEDITED: /nowhere/a.tsx\nDOCS: none\n`
  + ["a", "b", "c", "d"].map((s) => `SHOT: /nowhere/${s}.png`).join("\n") + "\n";

const PY = String.raw`
import json, os, sys
from plan_runner.solo import chain_state, chain_walk, chain_loop
from plan_runner.solo import chain_card_tweak as T
import plan_runner.solo.chain as door
import plan_runner.solo.chain_card as card
repo, moved, done = sys.argv[1:4]
door.run_stage = lambda *a, **k: {}
chain_walk._done = lambda chain, name: True
chain_loop._before = lambda chain, dirs: {}
seen = {}
def walk(account, key):
    chain = chain_state.blank("chain-case-" + key, "case-" + key, agent="hephaestus", cwd=repo, add_dirs=[],
                              docs=False, pause=False, brief="b")
    chain["flow"] = "tweak"
    os.makedirs(chain_state.dir_for(chain["id"]), exist_ok=True)
    chain_state.save(chain)
    chain_walk._text_of = lambda c, n: account
    card.run = lambda c: seen.__setitem__(key, {"flow": c.get("flow"), "changelog": c.get("changelog")})
    T.run(chain)
walk(moved, "moved")
T._refusal = lambda chain, before, dirs: ("the area's cases refused it: x read broken — y", "")
walk(done, "undone")
print(json.dumps(seen))
`;

runCase(async (t) => {
  const house = await bugHouse(t, "tweak-changelog-moved");
  const moved = path.join(house.dir, "tweak-moved.txt");
  const done = path.join(house.dir, "tweak-done.txt");
  fs.writeFileSync(moved, MOVED);
  fs.writeFileSync(done, DONE);
  const ran = python(PY, [house.repo, moved, done], { cwd: house.dir, env: house.env });
  const last = ran.stdout.trim().split("\n").pop() || "";
  let got;
  try { got = JSON.parse(last); } catch { got = null; }
  if (ran.status !== 0 || !got) return cannotRun(`the tweak walk could not be driven: exit ${ran.status}: ${(ran.stderr.trim().split("\n").pop() || last).slice(0, 240)}`);
  if (!got.moved || !got.undone) return cannotRun(`the walk did not go the full way for both sittings: ${last.slice(0, 200)}`);

  const wrong = [];
  if (got.moved.changelog) wrong.push(`after a MOVED sitting the ${got.moved.flow} walk keeps ${JSON.stringify(got.moved.changelog)}`);
  if (got.undone.changelog) wrong.push(`after the edit was taken back the ${got.undone.flow} walk keeps ${JSON.stringify(got.undone.changelog)}`);
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`a MOVED sitting and a taken-back edit each went on as ${got.moved.flow}/${got.undone.flow} keeping no changelog from the sitting`);
});
