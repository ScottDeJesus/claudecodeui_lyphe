// `hooks/dispatcher/hunt_config.py` is a leaf in `card_config.py`'s shape: it never raises, and a missing or bad value
// reads its default with one stderr line. Over the seam's four projects, `project_of(path)` gives a file to the listed
// project whose folder holds it most closely — The house's map leaves out CloudCLI's folder, which sits inside it — and
// answers no project for a file under none. A lens with no `include` takes every file; `ui` keeps its four globs. A
// file holding `turns = "weekly"` and `minutes = 9000` reads `project` and 120 with a line each, and one that is not
// TOML reads the defaults. Read through a scratch HUNTS_CONFIG_PATH by a child Python importing the leaf.
//
// The leaf's reader and its lens read are found by the names a card_config-shaped leaf would give them (`read`,
// `load`, `config`; `include(kind)`, `lens(kind)`, `lenses[kind]`): a review may teach this case another spelling, never
// another check.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_config.py
// writes: none

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { SEAM_TOML, huntHouse } from "../lib/hunt_house.mjs";

const PROBE = String.raw`
import json, sys
from dispatcher import hunt_config as h

def reader():
    for name in ("read", "load", "config"):
        fn = getattr(h, name, None)
        if callable(fn):
            return fn
    raise SystemExit("NO-READER")

def val(obj, key):
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)

def name_of(p):
    if p is None or isinstance(p, str):
        return p
    return val(p, "name")

def include(cfg, kind):
    for get in (lambda: cfg.include(kind), lambda: cfg.lens(kind), lambda: cfg.lenses[kind], lambda: val(cfg, "lens")[kind]):
        try:
            got = get()
        except Exception:
            continue
        inc = got if got is None or isinstance(got, (list, tuple)) else val(got, "include")
        return "every" if not inc or list(inc) in (["**"], ["**/*"]) else list(inc)
    return "NO-LENS-READ"

cfg = reader()()
out = {"kinds": list(getattr(h, "KINDS", ())), "turns_words": list(getattr(h, "TURNS", ())),
       "minutes": val(cfg, "minutes"), "turns": val(cfg, "turns")}
if sys.argv[1] == "full":
    out["of"] = {p: name_of(cfg.project_of(p)) for p in sys.argv[2:]}
    out["ui"] = include(cfg, "ui")
    out["security"] = include(cfg, "security")
print(json.dumps(out))
`;

function probe(house, args) {
  return new Promise((resolve) => {
    const env = { ...house.env, PYTHONPATH: "/home/lyphe/.claude/hooks" };
    const child = spawn("python3", ["-c", PROBE, ...args], { env, cwd: house.dir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { err += b; });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, out, err: `${err}${e.message}` }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      let json = null;
      try { json = JSON.parse(out.trim().split("\n").pop()); } catch { /* left null */ }
      resolve({ code, out, err, json });
    });
  });
}

const FILES = {
  "/home/lyphe/.claude/claudecodeui_lyphe/server/index.js": "CloudCLI",
  "/home/lyphe/.claude/hooks/dispatcher/store.py": "The house",
  "/opt/shadow-connector/core/llm.py": "Restorly connector",
  "/opt/eis-app/src/main.tsx": "Restorly app",
  "/etc/hosts": null,
};

runCase(async (t) => {
  const house = await huntHouse(t, "hunt-config-leaf");
  const wrong = [];

  const full = await probe(house, ["full", ...Object.keys(FILES)]);
  if (!full.json) return broken(`the leaf could not be read over the seam's file — exit ${full.code}: ${(full.err || full.out).trim().split("\n").pop()?.slice(0, 200)}`);
  const j = full.json;
  if (JSON.stringify(j.kinds) !== JSON.stringify(["security", "behaviour", "ui", "data", "code"])) wrong.push(`KINDS reads ${JSON.stringify(j.kinds)}`);
  if (JSON.stringify(j.turns_words) !== JSON.stringify(["project", "hunter", "nightly"])) wrong.push(`TURNS reads ${JSON.stringify(j.turns_words)}`);
  for (const [file, want] of Object.entries(FILES)) {
    if ((j.of?.[file] ?? null) !== want) wrong.push(`project_of(${file}) answered ${JSON.stringify(j.of?.[file])}, not ${JSON.stringify(want)}`);
  }
  if (JSON.stringify(j.ui) !== JSON.stringify(["**/*.tsx", "**/*.jsx", "**/*.css", "**/*.html"])) wrong.push(`lens ui reads ${JSON.stringify(j.ui)}`);
  if (j.security !== "every") wrong.push(`lens security (no include) reads ${JSON.stringify(j.security)}, not every file`);

  fs.writeFileSync(house.config, SEAM_TOML.replace('turns = "project"', 'turns = "weekly"').replace("minutes = 120", "minutes = 9000"));
  const bad = await probe(house, ["globals"]);
  const lines = bad.err.split("\n").filter((l) => l.trim());
  if (bad.json?.turns !== "project" || bad.json?.minutes !== 120) wrong.push(`turns weekly and minutes 9000 read ${JSON.stringify(bad.json)}, not project and 120`);
  if (!lines.some((l) => /turns/.test(l)) || !lines.some((l) => /minutes/.test(l))) wrong.push(`the bad values said ${JSON.stringify(lines)}, not a line for turns and one for minutes`);

  fs.writeFileSync(house.config, "this is [not toml\n");
  const broke = await probe(house, ["globals"]);
  if (broke.code !== 0 || broke.json?.minutes !== 120 || broke.json?.turns !== "project") wrong.push(`a file that is not TOML answered exit ${broke.code} with ${JSON.stringify(broke.json)}: ${broke.err.trim().split("\n").pop()?.slice(0, 160)}`);

  fs.rmSync(house.config);
  const gone = await probe(house, ["globals"]);
  if (gone.code !== 0 || gone.json?.minutes !== 120) wrong.push(`a missing file answered exit ${gone.code} with ${JSON.stringify(gone.json)}`);

  if (wrong.length) return broken(wrong.join("; "));
  return held(`project_of gave CloudCLI's file to CloudCLI, the hooks' to The house and /etc/hosts to none; ui kept its globs, security took every file; bad turns and minutes read project and 120 with a line each; a broken and a missing file read the defaults (${path.basename(house.config)} scratch)`);
});
