// A list card's row names a file as it was written. Her "uncommitted work" card (git-reads.ts statusAnswer, a `list` card) writes
// one row per changed file through `git-lines.ts` `fileLine`, which puts each path in a code span; the rows here are fileLine's own
// output, run through `~/.claude/scripts/cloudcli-tsx`, never retyped. A Python package file's name,
// `__init__.py`, must read as `__init__.py` on the station, not as a bold "init.py" (kaylee-cards-markdown).
//
// The card is added to the page's own GET /api/companion answer, so nothing is written; the station opens with the card
// as its focus, at 1440x900, and the row is read as the browser lays it out.
//
// protects: src/modules/station/cardBodies.tsx, server/modules/companion/eyes/git-lines.ts
// writes: none

import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { withPage } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const DESKTOP = { width: 1440, height: 900 };
const NOTE_ID = 990002;
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const TSX = path.join(os.homedir(), ".claude/scripts/cloudcli-tsx");
const FILES = [
  { path: "eis_backend/scheduling_report/__init__.py", state: "modified", staged: true },
  { path: "core/job_stage/rules.py", state: "untracked", staged: false },
];
/** The rows exactly as `fileLine` writes them today, one per file, read off the real module rather than retyped. */
function writtenRows() {
  const script = `import { fileLine } from ${JSON.stringify(path.join(REPO, "server/modules/companion/eyes/git-lines.ts"))}; process.stdout.write(JSON.stringify(${JSON.stringify(FILES)}.map((file) => fileLine(file, false))));`;
  return JSON.parse(execFileSync(TSX, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 60000 }));
}

runCase(async (t) => {
  let rows;
  try { rows = writtenRows(); } catch (error) { return cannotRun(`fileLine could not be run through cloudcli-tsx — ${String(error.message).split("\n")[0]}`); }
  const TEXT = ["2 files are uncommitted.", ...rows].join("\n");
  // What a reader sees: the written row with its code span's backticks gone (the path inside is drawn as written, as a file chip).
  const ROW = rows[0].replace(/`/g, "");
  const page = await withPage(t, { viewport: DESKTOP });
  await page.route(/\/api\/companion$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const answer = await route.fetch();
    const picture = await answer.json();
    picture.notes = [...(picture.notes ?? []), { id: NOTE_ID, at: new Date().toISOString(), title: "case status card", text: TEXT, kind: "list", ref: null, pinned: false }];
    return route.fulfill({ response: answer, json: picture });
  });
  await page.evaluate((id) => {
    localStorage.setItem("kaylee-station", JSON.stringify({ focus: { kind: "note", id, label: "case status card" }, stack: [], scroll: {}, prefs: {} }));
    localStorage.setItem("companion-voice", "off");
  }, NOTE_ID);
  await page.goto(new URL("/station", page.url()).href, { waitUntil: "domcontentloaded" });
  const row = page.locator('[data-station-note-body="list"] [data-list-row]').nth(1);
  await row.waitFor({ timeout: 60000 });
  const read = await row.evaluate((el) => ({ text: el.innerText.trim(), bold: el.querySelectorAll("strong, b").length }));
  if (read.text !== ROW || read.bold !== 0) {
    return broken(`the row reads "${read.text}" with ${read.bold} bold run(s), not "${ROW}" as written`);
  }
  return held(`the row reads "${ROW}" as written, no bold`);
});
