// The Gemini budget's cap has no off state: getGeminiPlanCapState() reads a cap file that is missing,
// empty, oversized, negative or not a decimal as the 5.00 default, and a file that says 0 as a cap of 0.
//
// Every file read here is one this case wrote in its own scratch folder, named by GEMINI_PLAN_CAP_FILE
// in this process before each call. The real cap file is never named and never opened.
//
// protects: server/modules/settings/gemini-plan-cap.ts, server/modules/settings/heal-switch.ts
// writes: none

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const DEFAULT_USD = 5;
const FLAG_MAX_BYTES = 256; // heal-switch.ts's bound on a flag file

type CapFile = {
  kind: string;
  /** The file's bytes; null writes no file at all. */
  content: string | null;
  expectedUsd: number;
};

const CAP_FILES: readonly CapFile[] = [
  { kind: "missing", content: null, expectedUsd: DEFAULT_USD },
  { kind: "empty", content: "", expectedUsd: DEFAULT_USD },
  // A decimal the grammar accepts, so only the size bound can turn it away: read at any length it would be 7.
  { kind: "oversized", content: `7.${"0".repeat(FLAG_MAX_BYTES)}\n`, expectedUsd: DEFAULT_USD },
  { kind: "negative", content: "-3\n", expectedUsd: DEFAULT_USD },
  { kind: "non-decimal", content: "five\n", expectedUsd: DEFAULT_USD },
  { kind: "zero", content: "0\n", expectedUsd: 0 },
];

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  // Loaded in the body: a module that will not load ends the case CANNOT RUN, not with a bare exit 1.
  const { getGeminiPlanCapState } = await import("../../server/modules/settings/gemini-plan-cap.ts");
  const folder: string = await scratchDir(t, "gemini-cap");

  const misread: string[] = [];
  for (const { kind, content, expectedUsd } of CAP_FILES) {
    const file = path.join(folder, `${kind}.flag`);
    if (content !== null) await writeFile(file, content);
    // capPath() reads the variable at every call, so each reading is of this file and no other.
    process.env.GEMINI_PLAN_CAP_FILE = file;
    const { usd } = await getGeminiPlanCapState();
    if (usd !== expectedUsd) misread.push(`the ${kind} cap file read ${usd}, not ${expectedUsd}`);
  }

  if (misread.length > 0) return broken(misread.join("; "));
  return held("a missing, an empty, an oversized, a negative and a non-decimal cap file each read 5; a file saying 0 read 0");
});
