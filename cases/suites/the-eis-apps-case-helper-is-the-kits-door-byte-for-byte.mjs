// The EIS app's suite keeps no copy of the ending contract: its cases/lib/case.mjs is byte for byte the
// kit's node/door.mjs, the same bytes this suite's own cases/lib/case.mjs holds. A helper that has drifted
// from the door is a second copy of the rules, and the EIS app's cases end by words the kit no longer holds.
//
// To see it fail: CASE_SUITE_HELPER=<the helper as git held it before it became the door> reads BROKEN.
//
// protects: /opt/eis-app/cases/lib/case.mjs, /home/lyphe/.claude/hooks/cases/kit/node/door.mjs, cases/lib/case.mjs
// writes: none

import fs from "node:fs";

import { broken, held, runCase } from "../lib/case.mjs";
import { helperOf, KIT_DOOR, OWN_HELPER } from "../lib/suite_helper.mjs";

const SUITE = "eis-app";

/** A file's bytes; null when no file is there. */
function bytesOf(file) {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

/** Where two buffers first differ, as a 1-based line number. */
function firstDifferentLine(one, other) {
  const end = Math.min(one.length, other.length);
  let line = 1;
  for (let at = 0; at < end; at += 1) {
    if (one[at] !== other[at]) return line;
    if (one[at] === 0x0a) line += 1;
  }
  return line;
}

runCase(async () => {
  const helper = await helperOf(SUITE);
  const door = bytesOf(KIT_DOOR);
  if (door === null) return broken(`the kit holds no door at ${KIT_DOOR}`);
  const held_ = bytesOf(helper);
  if (held_ === null) return broken(`the ${SUITE} suite has no helper at ${helper}`);
  if (!held_.equals(door)) {
    return broken(`${helper} is not the bytes of the kit's door ${KIT_DOOR}: ${held_.length} bytes against ${door.length}, first different at line ${firstDifferentLine(held_, door)}`);
  }
  const own = bytesOf(OWN_HELPER);
  if (own === null || !own.equals(door)) return broken(`${helper} is the kit's door, but this suite's own ${OWN_HELPER} is not: the two suites end by different rules`);
  return held(`${helper} is the kit's door ${KIT_DOOR} byte for byte (${door.length} bytes), as this suite's own helper is`);
});
