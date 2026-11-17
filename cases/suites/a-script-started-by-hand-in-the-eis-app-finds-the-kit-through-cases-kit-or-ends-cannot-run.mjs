// A case of the EIS app started by hand still ends on a verdict. A read-only script on the EIS app's
// cases/lib/case.mjs, started from the EIS repo with no CASES_KIT:
//   - with `cases` on its PATH (a hand's shell), finds the kit through `cases kit` and ends on its own
//     verdict line, exit 0;
//   - with no `cases` on its PATH (cron's), ends `CANNOT RUN: the case kit was not found — …`, exit 2.
// Never exit 1 with no line: that is BROKEN's code, and a reader would file a missing kit as a finding.
//
// The scripts are written in a scratch folder and import the helper by its path; they reach no service.
//
// To see it fail: CASE_SUITE_HELPER=<the helper as git held it before it became the door> reads BROKEN
// (that helper carries its own copy of the contract and ends HELD with no kit at all).
//
// protects: /opt/eis-app/cases/lib/case.mjs, /home/lyphe/.claude/hooks/cases/kit/node/door.mjs, /home/lyphe/.claude/hooks/cases/cmd/kit.py, /home/lyphe/.claude/hooks/cases/kit_env.py, /home/lyphe/.claude/scripts/cases
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";
import { bareEnv, describe, handEnv, helperOf, repoOf, runScript, writeScript } from "../lib/suite_helper.mjs";

const SUITE = "eis-app";
const OWN_VERDICT = "HELD: the body ran";
const NO_KIT = "CANNOT RUN: the case kit was not found — run this case with ~/.claude/scripts/cases run <name>";
const SOURCE = `runCase(async () => held("the body ran"));`;

runCase(async (t) => {
  const helper = await helperOf(SUITE);
  const repo = await repoOf(SUITE);
  const dir = await scratchDir(t, "suite-helper-hand");
  const file = writeScript(dir, "by-hand.mjs", { helper, source: SOURCE });

  const byHand = await runScript(file, { env: handEnv(), cwd: repo });
  if (byHand.code !== 0 || byHand.last !== OWN_VERDICT) {
    return broken(`started from ${repo} with no CASES_KIT and cases on its PATH, a script on ${helper} should end "${OWN_VERDICT}" with exit 0: it ${describe(byHand)}`);
  }

  const noKit = await runScript(file, { env: bareEnv(), cwd: repo });
  if (noKit.code !== 2 || noKit.last !== NO_KIT) {
    return broken(`started from ${repo} with no CASES_KIT and no cases on its PATH, a script on ${helper} should end "${NO_KIT}" with exit 2: it ${describe(noKit)}`);
  }
  return held(`from ${repo} with no CASES_KIT, a script on ${helper} ended "${OWN_VERDICT}" (exit 0) through cases kit, and with no cases on its PATH ended "the case kit was not found" (exit 2)`);
});
