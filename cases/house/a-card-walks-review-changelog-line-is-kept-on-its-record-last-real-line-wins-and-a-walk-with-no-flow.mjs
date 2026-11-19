// The CHANGELOG line a card walk ends with is the reviewer's, read off her account after each round and kept on the
// walk's record as `chain["changelog"]`, the line the card's settle writes. The LAST real line wins: the brief's own
// placeholder (`CHANGELOG: <one sentence …>`) echoed back is not a line, a markdown-bold line is, and a later round
// that writes no line keeps the earlier round's. A missing line never refuses a round. A walk with no `flow` (a phase,
// an /inline, a heal) records nothing.
//
// A scratch dispatcher home and plan-runner state; a bug card walk's record with a round-1 review whose account holds
// the placeholder, a draft line and a bold final line, and a round-2 review with none; `chain_card_rounds.refuses` for
// round 1 then round 2, then the record read back off disk; and the same round-1 review handed to a record with no
// flow.
//
// protects: /home/lyphe/.claude/hooks/plan_runner/solo/chain_card_rounds.py, /home/lyphe/.claude/hooks/plan_runner/solo/chain_card_changelog.py, /home/lyphe/.claude/hooks/plan_runner/solo/chain_card_words.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bugHouse } from "../lib/bug_house.mjs";
import { python } from "../lib/house_live.mjs";

const FINAL = "Typing in the search box keeps the cursor in it while results load.";
const ROUND1 = [
  "## Findings",
  "None standing.",
  "",
  "CHANGELOG: <one sentence in plain words: what a person using it now sees; no file names, no ids>",
  "CHANGELOG: An early draft of the line.",
  "DOCS NEEDED: no",
  `- **CHANGELOG:** ${FINAL}`,
  "",
].join("\n");
const ROUND2 = ["## Findings", "None standing.", "", "DOCS NEEDED: no", ""].join("\n");

const PY = String.raw`
import json, os, sys
from plan_runner.solo import chain_card_rounds, chain_state
repo, r1, r2, empty = sys.argv[1:5]
def record(chain_id, flow):
    chain = chain_state.blank(chain_id, chain_id.replace("chain-", ""), agent="hephaestus", cwd=repo, add_dirs=[],
                              docs=False, pause=False, brief="b")
    if flow:
        chain["flow"] = flow
    os.makedirs(chain_state.dir_for(chain_id), exist_ok=True)
    return chain
card = record("chain-case-changelog-kept", "bug")
card["stages"] = [{"name": "athena-1", "findings": empty, "text": r1, "stage_done": True}]
refused1 = chain_card_rounds.refuses(card, 1)
after1 = card.get("changelog")
card["stages"].append({"name": "athena-2", "findings": empty, "text": r2, "stage_done": True})
refused2 = chain_card_rounds.refuses(card, 2)
with open(chain_state.path_for(card["id"], "chain.json"), encoding="utf-8") as fh:
    on_disk = json.load(fh).get("changelog")
plain = record("chain-case-changelog-noflow", None)
plain["stages"] = [{"name": "athena-1", "findings": empty, "text": r1, "stage_done": True}]
refused_plain = chain_card_rounds.refuses(plain, 1)
print(json.dumps({"refused1": refused1, "after1": after1, "refused2": refused2, "on_disk": on_disk,
                  "flags": card.get("flags"), "refused_plain": refused_plain, "plain_has": "changelog" in plain}))
`;

runCase(async (t) => {
  const house = await bugHouse(t, "changelog-kept");
  const r1 = path.join(house.dir, "review-1.md");
  const r2 = path.join(house.dir, "review-2.md");
  const empty = path.join(house.dir, "findings-empty.md");
  fs.writeFileSync(r1, ROUND1);
  fs.writeFileSync(r2, ROUND2);
  fs.writeFileSync(empty, "");
  const ran = python(PY, [house.repo, r1, r2, empty], { cwd: house.dir, env: house.env });
  const last = ran.stdout.trim().split("\n").pop() || "";
  let got;
  try { got = JSON.parse(last); } catch { got = null; }
  if (ran.status !== 0 || !got) return cannotRun(`the rounds could not be driven: exit ${ran.status}: ${(ran.stderr.trim().split("\n").pop() || last).slice(0, 240)}`);

  const wrong = [];
  if (got.after1 !== FINAL) wrong.push(`after round 1 the record keeps ${JSON.stringify(got.after1)}, not the last real line`);
  if (got.on_disk !== FINAL) wrong.push(`after round 2, which wrote no line, the record on disk keeps ${JSON.stringify(got.on_disk)}`);
  if (got.refused1 !== false || got.refused2 !== false) wrong.push(`a round was refused (round 1 ${got.refused1}, round 2 ${got.refused2}) with no case of its own unheld`);
  const skipped = (got.flags || []).filter((f) => /skipped/.test(String(f)));
  if (skipped.length > 0) wrong.push(`the round's bookkeeping faulted: ${String(skipped[0]).slice(0, 160)}`);
  if (got.refused_plain !== false || got.plain_has) wrong.push(`a walk with no flow was refused (${got.refused_plain}) or kept a changelog (${got.plain_has})`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`the walk kept ${JSON.stringify(FINAL)} through a round with no line, past the echoed placeholder and a draft, and a flowless walk kept none`);
});
