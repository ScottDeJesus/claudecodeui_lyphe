// scratch.mjs — the kit's scratch folder, handed on to this suite's cases by name.
//
//   import { scratchDir } from "../lib/scratch.mjs";
//   const dir = await scratchDir(t, "cap-file");      // <tmp>/case-cap-file-XXXXXX, removed when the case ends
//
// A case imports nothing of the kit by its path: the door (case.mjs) says where the kit is, and this file
// asks it for the one helper a case that must write a file needs. The helper, its removal and the test that
// guards the removal are the kit's (node/scratch.mjs), written once for every suite.
//
// The kit's file is loaded at the call, inside the case's body, and not at the top: one that will not load
// ends the case CANNOT RUN through `runCase`, where a failed top-level import would exit 1 with no line.

import { pathToFileURL } from "node:url";

import { KIT } from "./case.mjs";

/** scratchDir — the kit's `scratchDir(t, label)`: its arguments, its folder, its deferred removal. */
export async function scratchDir(t, label) {
  const kit = await import(pathToFileURL(`${KIT}/node/scratch.mjs`).href);
  return kit.scratchDir(t, label);
}
