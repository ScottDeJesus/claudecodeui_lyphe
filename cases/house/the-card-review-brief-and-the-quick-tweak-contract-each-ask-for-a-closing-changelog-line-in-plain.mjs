// Every finished card walk leaves a plain-words line for the board's changelog and the reporter's word back, and the
// line is asked for where the walk's last account is written: the card review's checks (bug and change) ask for a
// closing `CHANGELOG: <one sentence in plain words: what a person using it now sees; no file names, no ids>` line in
// the same item as the `DOCS NEEDED:` line, and the quick tweak's sitting brief carries it among its contract lines.
//
// A scratch plan-runner state; a bug and a change card walk's record handed to `chain_card_briefs.review_asks` for
// round 1, and a tweak walk's record to `chain_card_tweak_brief.tweak_brief`; the briefs' text read for the ask.
//
// protects: /home/lyphe/.claude/hooks/plan_runner/solo/chain_card_briefs.py, /home/lyphe/.claude/hooks/plan_runner/solo/chain_card_tweak_brief.py
// writes: none

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bugHouse } from "../lib/bug_house.mjs";
import { python } from "../lib/house_live.mjs";

const ASK = "CHANGELOG: <one sentence in plain words: what a person using it now sees; no file names, no ids>";

const PY = String.raw`
import json, sys
from plan_runner.solo import chain_card_briefs, chain_card_tweak_brief, chain_state
repo = sys.argv[1]
def record(flow):
    chain = chain_state.blank(f"chain-case-ask-{flow}", f"case-ask-{flow}", agent="hephaestus", cwd=repo, add_dirs=[],
                              docs=False, pause=False, brief="b")
    chain["flow"] = flow
    return chain
out = {flow: chain_card_briefs.review_asks(record(flow), 1) for flow in ("bug", "change")}
out["tweak"] = chain_card_tweak_brief.tweak_brief(record("tweak"), None)
print(json.dumps(out))
`;

runCase(async (t) => {
  const house = await bugHouse(t, "changelog-ask");
  const ran = python(PY, [house.repo], { cwd: house.dir, env: house.env });
  const last = ran.stdout.trim().split("\n").pop() || "";
  let got;
  try { got = JSON.parse(last); } catch { got = null; }
  if (ran.status !== 0 || !got) return cannotRun(`the briefs could not be written: exit ${ran.status}: ${(ran.stderr.trim().split("\n").pop() || last).slice(0, 240)}`);

  const wrong = [];
  for (const flow of ["bug", "change"]) {
    const items = String(got[flow]).split("\n").filter((l) => /^\d+\. /.test(l));
    const docsItem = items.find((l) => l.includes("DOCS NEEDED:"));
    if (!docsItem) wrong.push(`the ${flow} review's checks hold no DOCS NEEDED item`);
    else if (!docsItem.includes(ASK)) wrong.push(`the ${flow} review's DOCS NEEDED item does not ask for ${ASK.slice(0, 40)}…: ${docsItem.slice(0, 160)}`);
  }
  if (!String(got.tweak).includes(ASK)) wrong.push("the quick tweak's brief does not carry the CHANGELOG line among its contract lines");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("the bug and change reviews ask for the CHANGELOG line beside DOCS NEEDED, and the quick tweak's contract carries it");
});
