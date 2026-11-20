// `hooks/dispatcher/hunt_turns.py`'s `order` holds a turn only for a hunt of the config's `order` and a project; a
// data turn of a project that names no database is never one, and neither is a turn that already has a sitting ended
// `failed` in THIS night (a first pass or a re-hunt alike). A failure on another night bars nothing tonight, and a
// sitting that ended any other way (here `stopped`) bars nothing. `security`, a kind left out of `order`, never
// appears. The night is a plain date: one with no hunt_nights row (2026-11-21) is read as any other.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_turns.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { lastLine } from "../lib/hunt_map_house.mjs";
import { sayList, turnsHouse, turnsPy } from "../lib/hunt_turns_house.mjs";

const SCRIPT = String.raw`
reset()
night("2026-11-19")
night("2026-11-20", "open")
sitting("2026-11-19", "data", "Zulu", "failed")
sitting("2026-11-20", "code", "Zulu", "failed")
sitting("2026-11-20", "code", "Alpha", "stopped")
pass_("code", "Zulu", 1, "done", "2026-11-01T00:00:00Z")
for key, rule, date in (("tonight", "project", "2026-11-20"), ("tonight_hunter", "hunter", "2026-11-20"),
                        ("next_night", "project", "2026-11-21")):
    try:
        out[key] = order(rule, date)
    except Exception as e:
        out[key] = f"raised {type(e).__name__}: {e}"
print(json.dumps(out))
`;

const WANT = {
  tonight: ["data·Zulu", "code·Alpha"],
  tonight_hunter: ["data·Zulu", "code·Alpha"],
  next_night: ["data·Zulu", "code·Alpha", "code·Zulu"],
};

runCase(async (t) => {
  const house = await turnsHouse(t, "turns-bars", {
    projects: [{ name: "Zulu", databases: ["zdb"] }, { name: "Alpha" }], order: ["data", "code"],
  });
  const got = await turnsPy(house, SCRIPT);
  if (!got.json) return broken(`hunt_turns.order could not be run — ${lastLine(got)}`);
  if (got.json.import_error) return broken(`dispatcher.hunt_turns does not import — ${got.json.import_error}`);
  const wrong = Object.keys(WANT)
    .filter((key) => JSON.stringify(got.json[key]) !== JSON.stringify(WANT[key]))
    .map((key) => `${key} reads ${sayList(got.json[key], WANT[key])}`);
  const all = Object.values(got.json).flat().join(" ");
  if (/security·/.test(all)) wrong.push("security, a hunt left out of order, took a turn");
  if (/data·Alpha/.test(all)) wrong.push("Alpha names no database and was given a data turn");
  if (wrong.length) return broken(wrong.join("; "));
  return held("on 2026-11-20 code·Zulu (failed that night, a re-hunt) and data·Alpha (no database) were not turns, data·Zulu (failed the night before) and code·Alpha (stopped) were; on 2026-11-21 code·Zulu came back as the re-hunt; security never appeared");
});
