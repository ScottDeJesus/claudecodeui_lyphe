// case.mjs — the door to the shared case kit, the same bytes in every suite's cases/lib/.
//
// A case imports its verdict helpers from here, and they come from the one kit every suite shares:
//
//   import { runCase, held, broken } from "../lib/case.mjs";
//
// The runner (`cases run`) says where the kit is in CASES_KIT. A case started by hand
// (`node cases/<area>/<name>.mjs`) asks `cases kit`, found on PATH. This file therefore names no
// directory, and a kit that moves or changes never changes it.
//
// With no kit, one that will not load, or one that lacks a name this door hands on, the case ends as
// the contract's CANNOT RUN — the line last on stdout, exit 2. A failed top-level import, or a call of
// a helper that is not there, would otherwise exit 1, BROKEN's code, with no line.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const KIT_ASK_TIMEOUT_MS = 30000;
const SAW_LIMIT = 400;
const STDOUT = 1;
const CANNOT_RUN_EXIT = 2;
const HANDED_ON = ["runCase", "held", "broken", "cannotRun", "CannotRun"]; // the export line at the foot, name for name
// Every break a line-splitting reader honours, so the reason can never make the verdict two lines.
const LINE_BREAKS = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/g;

const firstLine = (error) => String(error?.message ?? error).split(LINE_BREAKS)[0];

/** End the case CANNOT RUN. Written synchronously: the exit must not outrun the line. Never returns. */
function cannotRunNow(why) {
  try {
    fs.writeSync(STDOUT, `CANNOT RUN: ${String(why).replace(LINE_BREAKS, " ").slice(0, SAW_LIMIT)}\n`);
  } finally {
    process.exit(CANNOT_RUN_EXIT); // a reader that closed the pipe changes nothing: 2 either way, never 1
  }
}

/** The kit's directory: the runner's word, else `cases kit`'s; "" when neither says. */
function kitDirectory() {
  const fromRunner = process.env.CASES_KIT;
  if (fromRunner?.trim()) return fromRunner;
  try {
    return execFileSync("cases", ["kit"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      timeout: KIT_ASK_TIMEOUT_MS,
    }).trim();
  } catch (error) {
    console.error(`cases kit did not answer: ${firstLine(error)}`);
    return "";
  }
}

const found = kitDirectory();
if (!found) cannotRunNow("the case kit was not found — run this case with ~/.claude/scripts/cases run <name>");

const kit = await import(pathToFileURL(`${found}/node/case.mjs`).href).catch((error) =>
  cannotRunNow(`the case kit at ${found} would not load — ${firstLine(error)}`),
);
// A missing export destructures to undefined without a word: this copy of the door and the kit disagree.
const absent = HANDED_ON.find((name) => !(name in kit));
if (absent) cannotRunNow(`the case kit at ${found} has no ${absent}`);

export const KIT = found;
export const { runCase, held, broken, cannotRun, CannotRun } = kit;
