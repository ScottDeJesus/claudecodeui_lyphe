// protects: server/modules/kanban-intake/kanban-intake.routes.ts
// writes: live
//
// The door's two new fields (restorly-users-bug-board, seam A): the caller chooses the lane, Backlog (not_ready) or To do,
// and names the reporter, whose name the door writes ahead of the title because the Bugs view draws a card by its title.
// A body naming neither is the owner's leg as it always was: To do, the title as sent. Files three cards on the live
// Restorly Users board (its switch off, so a To do card starts no work) and archives each with the board's archive verb.

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

runCase(async (t) => {
  const secret = intakeSecret();
  const board = await usersBoard();
  const stamp = `case ${new Date().toISOString()}`;
  const made = [];
  t.defer(() => archiveAll(made));
  const wrong = [];

  const legs = [
    { label: "named", body: { title: `Intake case named ${stamp}`, status: "not_ready", reporter: "  Lupe Marquez  " },
      status: "not_ready", title: `Lupe Marquez: Intake case named ${stamp}` },
    { label: "unnamed", body: { title: `Intake case unnamed ${stamp}` }, status: "todo", title: `Intake case unnamed ${stamp}` },
    { label: "nulls", body: { title: `Intake case nulls ${stamp}`, status: null, reporter: null },
      status: "todo", title: `Intake case nulls ${stamp}` },
  ];
  for (const leg of legs) {
    const out = await file(secret, { boardId: board.id, tags: ["bug"], ...leg.body });
    const card = out.json?.card;
    if (card?.id) made.push(card.id);
    if (out.status !== 201 || !card) { wrong.push(`${leg.label}: answered ${out.status} ${JSON.stringify(out.json)}`); continue; }
    if (card.status !== leg.status) wrong.push(`${leg.label}: status ${card.status}, not ${leg.status}`);
    if (card.title !== leg.title) wrong.push(`${leg.label}: title ${JSON.stringify(card.title)}, not ${JSON.stringify(leg.title)}`);
    if (card.boardId && card.boardId !== board.id) wrong.push(`${leg.label}: landed on ${card.boardId}, not ${board.id}`);
  }
  const left = await archiveAll(made);
  if (left.length) wrong.push(`would not archive ${left.join(", ")}`);
  if (wrong.length) return broken(wrong.join("; "));
  return held(`on ${board.id}: a named report filed not_ready as "Lupe Marquez: <title>", an unnamed one and a null one todo with the title as sent; all three archived`);
});
