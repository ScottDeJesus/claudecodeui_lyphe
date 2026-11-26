// protects: server/modules/kanban-intake/kanban-intake.routes.ts
// writes: live
//
// cardTitle's cut (restorly-users-bug-board, seam A): "<reporter>: <title>" that runs past TITLE_MAX_CHARS (200) is cut
// so that, with a closing "…", it is exactly 200 long; one that fits exactly is left whole. Files two cards on the live
// Restorly Users board (switch off) and archives both.

import fs from "node:fs";
import { api } from "../lib/app.mjs";
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

/** The live Restorly Users board with its switch off: a todo card filed on a self-running board would start work. */
async function usersBoard() {
  const out = await api("/api/kanban/boards");
  if (out.status !== 200) throw new CannotRun(`GET /api/kanban/boards answered ${out.status}`);
  const boards = Array.isArray(out.json) ? out.json : (out.json?.boards ?? []);
  const board = boards.find((b) => b.name === BOARD_NAME && !b.archived && b.autonomy === false);
  if (!board) throw new CannotRun(`no live ${BOARD_NAME} board with its switch off stands — nowhere safe to file`);
  return board;
}

/** Archive the cards this case made: the board has no hard delete (MAN-9984). Answers the ids that would not archive. */
async function archiveAll(ids) {
  const left = [];
  while (ids.length) {
    const id = ids.shift();
    const out = await api(`/api/kanban/cards/${encodeURIComponent(id)}/archive`, { method: "POST" });
    if (out.status >= 300) left.push(`${id} (${out.status})`);
  }
  return left;
}

const PREFIX = "Lupe Marquez: ";
const pad = (head, length) => (head + " " + "a".repeat(length)).slice(0, length);

runCase(async (t) => {
  const secret = intakeSecret();
  const board = await usersBoard();
  const stamp = `Intake cut case ${Date.now()}`;
  const made = [];
  t.defer(() => archiveAll(made));
  const wrong = [];
  const long = pad(stamp, 199);
  const fit = pad(stamp, 200 - PREFIX.length);
  const legs = [
    { label: "past 200", title: long, want: (PREFIX + long).slice(0, 199) + "…" },
    { label: "exactly 200", title: fit, want: PREFIX + fit },
  ];
  for (const leg of legs) {
    const out = await file(secret, { boardId: board.id, title: leg.title, status: "not_ready", reporter: "Lupe Marquez" });
    const card = out.json?.card;
    if (card?.id) made.push(card.id);
    if (out.status !== 201 || !card) { wrong.push(`${leg.label}: answered ${out.status} ${JSON.stringify(out.json)}`); continue; }
    if (card.title !== leg.want) {
      wrong.push(`${leg.label}: title of ${card.title.length} ending ${JSON.stringify(card.title.slice(-12))}, not ${leg.want.length} ending ${JSON.stringify(leg.want.slice(-12))}`);
    }
  }
  const left = await archiveAll(made);
  if (left.length) wrong.push(`would not archive ${left.join(", ")}`);
  if (wrong.length) return broken(wrong.join("; "));
  return held(`on ${board.id}: a title past 200 was cut to 200 ending in …, one of exactly 200 stood whole; both archived`);
});
