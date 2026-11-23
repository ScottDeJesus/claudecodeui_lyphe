// The rule for Restorly's walk folder is served where a writer looks: docstore govern on walk/screens.toml and on
// walk/app.mjs both name one live row, and its body says a change that moves a screen updates screens.toml in the same
// change.
//
// protects: /opt/eis-app/walk/screens.toml, /opt/eis-app/walk/app.mjs
// writes: none

import { execFile } from "node:child_process";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const DOCSTORE = "/home/lyphe/.claude/scripts/docstore";
const FILES = ["/opt/eis-app/walk/screens.toml", "/opt/eis-app/walk/app.mjs"];
const SAYS = [/mov\w* a screen/i, /screens\.toml/, /same change/i];

const docstore = (args) => new Promise((resolve) => {
  execFile(DOCSTORE, args, { encoding: "utf8", timeout: 30000 }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
});
const json = (text) => { try { return JSON.parse(text); } catch { return null; } };

runCase(async () => {
  const tokens = [];
  for (const file of FILES) {
    const got = await docstore(["govern", file]);
    const rows = json(got.stdout)?.rows;
    if (!Array.isArray(rows)) return cannotRun("docstore govern " + file + " gave no rows: " + (got.stderr || got.stdout).trim().split("\n")[0]);
    tokens.push(rows.map((row) => row.token));
  }
  const shared = tokens[0].filter((token) => tokens[1].includes(token));
  for (const token of shared) {
    const row = json((await docstore(["get", token])).stdout)?.row;
    if (row && SAYS.every((words) => words.test(row.title + "\n" + row.body))) {
      return held(token + " governs both files and says a change that moves a screen updates screens.toml in the same change");
    }
  }
  return broken("no row governing both " + FILES.join(" and ") + " says it; rows they share: " + (shared.join(", ") || "none"));
});
