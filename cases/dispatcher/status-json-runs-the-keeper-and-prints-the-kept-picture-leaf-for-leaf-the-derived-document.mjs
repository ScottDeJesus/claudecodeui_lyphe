// protects: /home/lyphe/.claude/hooks/dispatcher/cmd/status.py, /home/lyphe/.claude/hooks/dispatcher/keeper.py, /home/lyphe/.claude/hooks/dispatcher/keeper_files.py, /home/lyphe/.claude/hooks/dispatcher/cmd/keep.py
// writes: none
//
// The JSON face is the kept read (pollers-hooks--incremental-status, phase 7): status --json runs keeper.refresh(wait=True) and
// prints keeper.document(name). On a scratch home the keeper runs in the reading process itself, so after one read the
// picture stands under <home>/status; the bytes it printed are the picture's, the whole derivation (--derived) is the
// same document leaf for leaf (INV-11778), and a name narrows the plans with the head whole.
import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { keptHouse, leafDiff, readJson, said } from "../lib/kept_status_house.mjs";

const HOOKS = "/home/lyphe/.claude/hooks";

runCase(async (t) => {
  const house = await keptHouse(t, "kept-read", HOOKS);
  const kept = await house.dispatcher(["status", "--json"]);
  if (kept.code !== 0) return broken("status --json " + said(kept));
  let doc;
  try { doc = JSON.parse(kept.out); } catch { return broken("status --json printed no JSON: " + kept.out.slice(0, 120)); }
  const index = readJson(path.join(house.home, "status", "index.json"));
  if (!index) return broken("status --json left no status/index.json under the scratch home: the read ran no keeper");
  const names = (doc.plans ?? []).map((p) => p.name);
  if (!["kept-done", "kept-open"].every((n) => names.includes(n))) return broken("the document's plans are " + JSON.stringify(names));
  const indexed = (index.plans ?? []).map((e) => e.name);
  if (JSON.stringify(indexed) !== JSON.stringify(names)) return broken("index.json names " + JSON.stringify(indexed) + " but the read printed " + JSON.stringify(names));
  const printed = await house.dispatcher(["keep", "--print"]);
  if (printed.code !== 0) return broken("keep --print " + said(printed));
  if (printed.out.trim() !== kept.out.trim()) return broken("keep --print does not print the bytes status --json printed (" + printed.out.length + " vs " + kept.out.length + " chars)");
  const derived = await house.dispatcher(["status", "--json", "--derived"]);
  if (derived.code !== 0) return broken("status --json --derived " + said(derived));
  const apart = leafDiff(doc, JSON.parse(derived.out));
  if (apart.length) return broken("the kept read and the derivation differ at " + apart.join(", "));
  const one = await house.dispatcher(["status", "--json", "kept-open"]);
  if (one.code !== 0) return broken("status --json kept-open " + said(one));
  const narrowed = JSON.parse(one.out);
  const oneNames = (narrowed.plans ?? []).map((p) => p.name);
  if (JSON.stringify(oneNames) !== '["kept-open"]') return broken("the narrowed read carries " + JSON.stringify(oneNames));
  const headApart = leafDiff({ ...narrowed, plans: null }, { ...doc, plans: null });
  if (headApart.length) return broken("the narrowed read's head differs from the whole one's at " + headApart.join(", "));
  return held("status --json kept " + names.length + " plans in index.json, keep --print printed its bytes, --derived matched leaf for leaf, the narrowed read held one plan under the same head");
});
