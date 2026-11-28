// protects: server/modules/dispatcher/dispatcher-state.transport.ts, server/modules/dispatcher/dispatcher-kept.reader.ts, /home/lyphe/.claude/hooks/dispatcher/keeper_files.py, /home/lyphe/.claude/hooks/dispatcher/cmd/keep.py
// writes: none
//
// The chat server's status lane reads the kept picture from its files (pollers-hooks--incremental-status): while
// <home>/status/index.json stands, readDispatcherDocument assembles the document from the index and the plan files and
// execs no dispatcher at all; with no index it runs `dispatcher keep` once and reads again. `dispatcher status --json`
// is never the lane's read. The binary the lane is handed is a stand-in that records each argv, then runs the real one.
import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { keptHouse, leafDiff, said } from "../lib/kept_status_house.mjs";

const HOOKS = "/home/lyphe/.claude/hooks";
const NOTHING_IGNORED = new Set<string>();

runCase(async (t: any) => {
  const house: any = await keptHouse(t, "kept-lane", HOOKS);
  const made = await house.dispatcher(["keep"]);
  if (made.code !== 0) return broken("dispatcher keep on the scratch home " + said(made));
  const calls = path.join(house.dir, "calls.log");
  const bin = path.join(house.dir, "dispatcher-recorder");
  fs.writeFileSync(bin, "#!/bin/sh\necho \"$*\" >> '" + calls + "'\nexec env PYTHONPATH='" + HOOKS + "' python3 -m dispatcher \"$@\"\n", { mode: 0o755 });
  const ran = (): string[] => (fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").split("\n").filter(Boolean) : []);
  const printed = await house.dispatcher(["keep", "--print"]);
  if (printed.code !== 0) return broken("keep --print " + said(printed));
  const want = JSON.parse(printed.out);
  const { readDispatcherDocument } = await import("../../server/modules/dispatcher/dispatcher-state.transport.ts");
  const got: any = await readDispatcherDocument(bin, 60000, house.env);
  if (ran().length) return broken("with a kept picture standing the lane ran the dispatcher: " + ran().join(" | "));
  const apart = leafDiff(got, want, NOTHING_IGNORED);
  if (apart.length) return broken("the lane's document and keep --print differ at " + apart.join(", "));
  fs.rmSync(path.join(house.home, "status", "index.json"));
  const again: any = await readDispatcherDocument(bin, 60000, house.env);
  const after = ran();
  if (after.length !== 1 || after[0] !== "keep") return broken("with no index the lane ran " + JSON.stringify(after) + ", not keep once");
  const names = (again?.plans ?? []).map((p: any) => p.name);
  if (!["kept-done", "kept-open"].every((n) => names.includes(n))) return broken("the read after keep carries plans " + JSON.stringify(names));
  return held("the lane read the kept files with no exec, matched keep --print leaf for leaf, and with no index ran keep once and read " + names.length + " plans");
});
