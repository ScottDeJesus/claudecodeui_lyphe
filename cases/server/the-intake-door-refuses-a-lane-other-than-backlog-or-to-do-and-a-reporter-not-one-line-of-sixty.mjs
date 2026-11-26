// protects: server/modules/kanban-intake/kanban-intake.routes.ts
// writes: none
//
// The door's refusals for its two new fields (restorly-users-bug-board, seam A), with their exact sentences, and the
// bounds that must still pass. Every body names a board that does not exist, so a body the door accepts meets the card
// service's 404 and no card is ever made: a door that ignored the fields would answer 404 where 400 is owed.

import fs from "node:fs";
import { broken, CannotRun, held, runCase } from "../lib/case.mjs";

const DOOR = "http://127.0.0.1:3011/api/kanban-intake/cards";
const ENV_FILE = "/opt/shadow-connector/.eis_backend.env"; // the door's own secret file (MAN-9985), read here and never printed
const BOARD_NAME = "Restorly Users";

/** The intake secret, read the way the door reads it: the KANBAN_INTAKE_SECRET line of eis_backend's env file. */
function intakeSecret() {
  let text;
  try {
    text = fs.readFileSync(ENV_FILE, "utf8");
  } catch (error) {
    throw new CannotRun(`${ENV_FILE} would not read — ${error.code ?? error.message}`);
  }
  const line = text.split("\n").find((l) => /^\s*(export\s+)?KANBAN_INTAKE_SECRET\s*=/.test(l));
  const value = line ? line.slice(line.indexOf("=") + 1).trim().replace(/^(['"])(.*)\1$/, "$2") : "";
  if (!value) throw new CannotRun(`${ENV_FILE} holds no KANBAN_INTAKE_SECRET`);
  return value;
}

/** One POST through the intake door, carrying the secret. */
async function file(secret, body) {
  let response;
  try {
    response = await fetch(DOOR, {
      method: "POST",
      headers: { "content-type": "application/json", "x-kanban-intake-secret": secret },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new CannotRun(`the intake door did not answer — ${error.message}`);
  }
  return { status: response.status, json: await response.json().catch(() => null) };
}

const NO_BOARD = "case-no-such-board-0000";
const STATUS_SENTENCE = "status must be one of not_ready, todo";
const REPORTER_SENTENCE = "reporter must be one line of at most 60 characters";
const TITLE_SENTENCE = "title must be at most 200 characters";

runCase(async () => {
  const secret = intakeSecret();
  const wrong = [];
  const refused = [
    ["status done", { status: "done" }, STATUS_SENTENCE],
    ["status Backlog", { status: "Backlog" }, STATUS_SENTENCE],
    ["status a number", { status: 1 }, STATUS_SENTENCE],
    ["reporter of 61", { reporter: "L".repeat(61) }, REPORTER_SENTENCE],
    ["reporter of two lines", { reporter: "Lupe\nMarquez" }, REPORTER_SENTENCE],
    ["reporter blank", { reporter: "   " }, REPORTER_SENTENCE],
    ["reporter a number", { reporter: 7 }, REPORTER_SENTENCE],
    ["title of 201 with a reporter", { title: "t".repeat(201), reporter: "Lupe Marquez" }, TITLE_SENTENCE],
  ];
  for (const [label, extra, sentence] of refused) {
    const out = await file(secret, { boardId: NO_BOARD, title: "Intake refusal case", ...extra });
    if (out.status !== 400 || out.json?.error !== sentence) {
      wrong.push(`${label}: ${out.status} ${JSON.stringify(out.json)}, not 400 "${sentence}"`);
    }
  }
  const passed = [
    ["status padded not_ready", { status: " not_ready " }],
    ["status todo", { status: "todo" }],
    ["reporter of 60", { reporter: "L".repeat(60) }],
    ["both null", { status: null, reporter: null }],
  ];
  for (const [label, extra] of passed) {
    const out = await file(secret, { boardId: NO_BOARD, title: "Intake refusal case", ...extra });
    if (out.status !== 404) wrong.push(`${label}: ${out.status} ${JSON.stringify(out.json)}, not the board's 404`);
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held("eight bad bodies answered 400 with their sentences; four good ones passed the fields to the board's 404");
});
