// `hooks/dispatcher/hunt_turns.py`'s `order` under the `nightly` rule: the hunts of `order` walked from tonight's
// lead, each with its projects in config order, then the re-hunts as under every rule. Tonight's lead is the hunt of
// THIS night's first sitting when it has one; else the hunt after the one that led (sat first on) the newest earlier
// night that had a sitting, wrapping from the last of `order` to the first; else the first of `order`. Each step below
// carries a distractor: tonight's LAST sitting is another hunt, a newer earlier night has no sitting, an older one was
// led by another hunt, and the newest one's second sitting is another hunt, so only the rule as written passes.
// "After" is after in the config's `order`, the list the operator reorders: `order` here is security, code,
// behaviour, whose cycle runs opposite to hunt_config.KINDS', so a rotation walked over KINDS gives another lead.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_turns.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { lastLine } from "../lib/hunt_map_house.mjs";
import { sayList, turnsHouse, turnsPy } from "../lib/hunt_turns_house.mjs";

const SCRIPT = String.raw`
T = "2026-11-20"
def step(name, seed):
    reset()
    night(T, "open")
    seed()
    try:
        out[name] = order("nightly", T)
    except Exception as e:
        out[name] = f"raised {type(e).__name__}: {e}"

def tonight_has_a_sitting():
    night("2026-11-19")
    sitting("2026-11-19", "code", "Zulu", "pass done")
    sitting(T, "code", "Alpha", "wound down")
    sitting(T, "behaviour", "Zulu", "stopped")
    pass_("code", "Alpha", 1, "done", "2026-11-01T00:00:00Z")

def an_earlier_night_led():
    for d in ("2026-11-19", "2026-11-18", "2026-11-10"):
        night(d)
    sitting("2026-11-18", "security", "Zulu", "pass done")
    sitting("2026-11-18", "behaviour", "Alpha", "wound down")
    sitting("2026-11-10", "code", "Zulu", "pass done")

def the_last_of_order_led():
    night("2026-11-18")
    sitting("2026-11-18", "behaviour", "Zulu", "pass done")
    sitting("2026-11-18", "code", "Alpha", "wound down")

def no_night_had_a_sitting():
    night("2026-11-19")

step("tonight", tonight_has_a_sitting)
step("earlier", an_earlier_night_led)
step("wrap", the_last_of_order_led)
step("none", no_night_had_a_sitting)
print(json.dumps(out))
`;

const FROM_SECURITY = ["security·Zulu", "security·Alpha", "code·Zulu", "code·Alpha", "behaviour·Zulu", "behaviour·Alpha"];
const WANT = {
  tonight: ["code·Zulu", "behaviour·Zulu", "behaviour·Alpha", "security·Zulu", "security·Alpha", "code·Alpha"],
  earlier: ["code·Zulu", "code·Alpha", "behaviour·Zulu", "behaviour·Alpha", "security·Zulu", "security·Alpha"],
  wrap: FROM_SECURITY,
  none: FROM_SECURITY,
};
const SAID = {
  tonight: "tonight's first sitting (code) led, not its last (behaviour) nor the hunt after last night's lead; code·Alpha's done pass came last",
  earlier: "with no sitting tonight code, the hunt after security in order (security sat first on 2026-11-18, the newest night with a sitting), led",
  wrap: "after behaviour, the last of order, the lead wrapped to security, the first of order",
  none: "with no sitting on any night the first of order led",
};

runCase(async (t) => {
  const house = await turnsHouse(t, "turns-lead", {
    projects: [{ name: "Zulu" }, { name: "Alpha" }], order: ["security", "code", "behaviour"], turns: "nightly",
  });
  const got = await turnsPy(house, SCRIPT);
  if (!got.json) return broken(`hunt_turns.order could not be run — ${lastLine(got)}`);
  if (got.json.import_error) return broken(`dispatcher.hunt_turns does not import — ${got.json.import_error}`);
  const wrong = Object.keys(WANT)
    .filter((step) => JSON.stringify(got.json[step]) !== JSON.stringify(WANT[step]))
    .map((step) => `${step}: ${SAID[step].split(",")[0]} should hold, but the turns read ${sayList(got.json[step], WANT[step])}`);
  if (wrong.length) return broken(wrong.join("; "));
  return held(Object.values(SAID).join("; "));
});
