// A list card whose text holds a markdown table draws a table on the station's stage, as her floating panel draws the
// same card (kaylee-cards-markdown). A kanban card read onto her panel is a `list` card (kanban-reads.ts, LIST_ABOUT_NOTHING)
// whose text is the card's facts, "Description:" and the description whole, and real descriptions carry tables (c-410).
//
// The card is added to the page's own GET /api/companion answer, so nothing is written; the station opens with the card
// as its focus, at 1440x900, and the list body is read as the browser lays it out.
//
// protects: src/modules/station/cardBodies.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

const DESKTOP = { width: 1440, height: 900 };
const NOTE_ID = 990001;
const TEXT = [
  "c-410 · To Do · high",
  "Description:",
  "**The finding:** the flag reads three tables nobody writes.",
  "",
  "| table | rows |",
  "|---|---:|",
  "| `thoth_pdf_extractions` | 790 |",
  "| `thoth_monday_extractions` | 834 |",
].join("\n");

runCase(async (t) => {
  const page = await withPage(t, { viewport: DESKTOP });
  await page.route(/\/api\/companion$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const answer = await route.fetch();
    const picture = await answer.json();
    picture.notes = [...(picture.notes ?? []), { id: NOTE_ID, at: new Date().toISOString(), title: "case table card", text: TEXT, kind: "list", ref: null, pinned: false }];
    return route.fulfill({ response: answer, json: picture });
  });
  await page.evaluate((id) => {
    localStorage.setItem("kaylee-station", JSON.stringify({ focus: { kind: "note", id, label: "case table card" }, stack: [], scroll: {}, prefs: {} }));
    localStorage.setItem("companion-voice", "off");
  }, NOTE_ID);
  await page.goto(new URL("/station", page.url()).href, { waitUntil: "domcontentloaded" });
  const body = page.locator('[data-station-note-body="list"]');
  await body.waitFor({ timeout: 60000 });
  const read = await body.evaluate((el) => ({
    tables: el.querySelectorAll("table").length,
    pipes: el.innerText.split("\n").filter((line) => /^\s*\|.*\|\s*$/.test(line)).length,
  }));
  if (read.tables !== 1 || read.pipes !== 0) {
    return broken(`the station draws the list card's table as ${read.tables} table(s) and ${read.pipes} line(s) of literal pipes`);
  }
  return held("the station draws the list card's markdown table as one table, no line of literal pipes");
});
