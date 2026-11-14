// scratch.mjs — the kit's scratch folder, handed on to this suite's cases by name.
//
//   import { scratchDir } from "../lib/scratch.mjs";
//   const dir = await scratchDir(t, "cap-file");      // <tmp>/case-cap-file-XXXXXX, removed when the case ends
//
// A case imports nothing of the kit by its path: the door (case.mjs) says where the kit is, and this file
// asks it for the one helper a case that must write a file needs. The helper, its removal and the test that
// guards the removal are the kit's (node/scratch.mjs), written once for every suite.

import { pathToFileURL } from "node:url";

import { KIT } from "./case.mjs";

export const { scratchDir } = await import(pathToFileURL(`${KIT}/node/scratch.mjs`).href);
