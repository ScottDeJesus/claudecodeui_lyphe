// protects: /home/lyphe/.claude/hooks/dispatcher/cmd/status.py, /home/lyphe/.claude/hooks/dispatcher/keeper.py, /home/lyphe/.claude/hooks/dispatcher/keeper_files.py, /home/lyphe/.claude/hooks/dispatcher/cmd/keep.py
// writes: none
//
// An unknown name is {"error": "no plan <name>"} and exit 1 on both JSON faces, the kept read and --derived
// (pollers-hooks--incremental-status, phase 7): a card asking for a plan the store never held gets the one refusal, never
// a kept picture of other plans, never a usage error.
import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { keptHouse, leafDiff, readJson, said } from "../lib/kept_status_house.mjs";

const HOOKS = "/home/lyphe/.claude/hooks";

const NAME = "no-such-plan-zz";

runCase(async (t) => {
  const house = await keptHouse(t, "kept-unknown", HOOKS);
  const wrong = [];
  for (const argv of [["status", "--json", NAME], ["status", "--json", "--derived", NAME]]) {
    const ran = await house.dispatcher(argv);
    let answer = null;
    try { answer = JSON.parse(ran.out.trim()); } catch { /* judged below */ }
    if (ran.code !== 1 || JSON.stringify(answer) !== JSON.stringify({ error: "no plan " + NAME })) {
      wrong.push(argv.join(" ") + " " + said(ran) + " | stdout " + JSON.stringify(ran.out.trim().slice(0, 80)));
    }
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held("both JSON faces of an unknown plan printed {\"error\": \"no plan " + NAME + "\"} and exited 1");
});
