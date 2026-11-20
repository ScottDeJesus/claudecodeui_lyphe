// `hooks/dispatcher/hunt_turns.py`'s `order(conn, config, night)` is seam 6's one place the order of turns is decided.
// FIRST PASSES BEFORE ANY RE-HUNT: first every turn whose pass 1 is not done (no pass yet, or pass 1 open), walked by
// the config's `turns` word — `project`: each project in config order, each hunt of `order` within it; `hunter`: each
// hunt of `order`, each project within it. Then the re-hunts (the last pass done), the one whose LAST pass ended
// longest ago first. The store below is seeded so the three readings of the re-hunt key a builder could take (the
// last pass's done_at, the first pass's, the walk's own order) give three different answers, and the projects and
// hunts are in no alphabetical order, so a sort by name cannot pass for the config's order.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_turns.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { lastLine } from "../lib/hunt_map_house.mjs";
import { sayList, turnsHouse, turnsPy } from "../lib/hunt_turns_house.mjs";

const SCRIPT = String.raw`
reset()
T = "2026-11-20"
night(T, "open")
pass_("code", "Zulu", 1, "done", "2026-11-05T00:00:00Z")
pass_("security", "Alpha", 1, "done", "2026-11-01T00:00:00Z")
pass_("behaviour", "Alpha", 1, "done", "2026-10-01T00:00:00Z")
pass_("behaviour", "Alpha", 2, "done", "2026-11-15T00:00:00Z")
pass_("behaviour", "Zulu", 1, "open")
for rule in ("project", "hunter"):
    try:
        out[rule] = order(rule, T)
    except Exception as e:
        out[rule] = f"raised {type(e).__name__}: {e}"
print(json.dumps(out))
`;

const REHUNTS = ["security·Alpha", "code·Zulu", "behaviour·Alpha"];
const WANT = {
  project: ["security·Zulu", "behaviour·Zulu", "code·Alpha", ...REHUNTS],
  hunter: ["code·Alpha", "security·Zulu", "behaviour·Zulu", ...REHUNTS],
};

runCase(async (t) => {
  const house = await turnsHouse(t, "turns-walk", {
    projects: [{ name: "Zulu" }, { name: "Alpha" }], order: ["code", "security", "behaviour"],
  });
  const got = await turnsPy(house, SCRIPT);
  if (!got.json) return broken(`hunt_turns.order could not be run — ${lastLine(got)}`);
  if (got.json.import_error) return broken(`dispatcher.hunt_turns does not import — ${got.json.import_error}`);
  const wrong = [];
  for (const rule of ["project", "hunter"]) {
    if (JSON.stringify(got.json[rule]) !== JSON.stringify(WANT[rule])) wrong.push(`under ${rule} the turns read ${sayList(got.json[rule], WANT[rule])}`);
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held("under project the first passes walked Zulu's then Alpha's hunts in order, under hunter each hunt's projects; both then took the re-hunts by their last pass's done_at, oldest first (security·Alpha, code·Zulu, behaviour·Alpha)");
});
