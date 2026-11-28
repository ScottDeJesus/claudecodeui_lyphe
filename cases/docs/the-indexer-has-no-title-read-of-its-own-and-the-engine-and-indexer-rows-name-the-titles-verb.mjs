// The indexer has no title read of its own (rust-transcript-engine, interface 5 and the docs of phase 2): the title rows
// come from the engine through readTitleRows and pickSessionTitle chooses among them; the whole-file read and
// extractSessionTitle are gone from the tree; the engine's titles.rs takes absolute paths and spells no directory; the
// engine's row (MAN-10329, read with its parts) states the titles verb, and MAN-9468's indexer lines name the new home and not the old.
//
// protects: server/modules/providers/list/claude/claude-session-synchronizer.provider.ts, rust/transcript-engine/src/titles.rs, server/modules/transcript-engine/MANUAL.md
// writes: none

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOCSTORE = path.join(os.homedir(), ".claude/scripts/docstore");
const SYNCHRONIZER = path.join(REPO, "server/modules/providers/list/claude/claude-session-synchronizer.provider.ts");
const TITLES_RS = path.join(REPO, "rust/transcript-engine/src/titles.rs");

const row = (token) => {
  const run = spawnSync(DOCSTORE, ["get", token, "--text"], { encoding: "utf8", timeout: 30000 });
  return run.status === 0 && run.stdout.trim() ? run.stdout : null;
};

runCase(async () => {
  const wrong = [];
  const synchronizer = fs.readFileSync(SYNCHRONIZER, "utf8");
  if (/\breadFile\b/.test(synchronizer)) wrong.push("the synchronizer still names readFile");
  if (!/readTitleRows\s*\(/.test(synchronizer)) wrong.push("the synchronizer never calls readTitleRows");
  if (!/pickSessionTitle\s*\(/.test(synchronizer)) wrong.push("the synchronizer has no pickSessionTitle");

  const grep = spawnSync("git", ["grep", "-n", "extractSessionTitle", "--", "server", "src", "rust"], { cwd: REPO, encoding: "utf8" });
  if (grep.status === 0) wrong.push("extractSessionTitle is still named: " + grep.stdout.trim().split("\n").slice(0, 3).join(" | ").slice(0, 240));
  else if (grep.status !== 1) return cannotRun("git grep exited " + grep.status + ": " + String(grep.stderr).trim());

  if (!fs.existsSync(TITLES_RS)) wrong.push("rust/transcript-engine/src/titles.rs is not on disk");
  else {
    const spelled = fs.readFileSync(TITLES_RS, "utf8").match(/"[^"\n]*(\.claude|projects)[^"\n]*"/);
    if (spelled) wrong.push("titles.rs spells a directory: " + spelled[0]);
  }

  const parent = row("MAN-10329");
  const parts = parent === null ? [] : ((/^parts: (.+)$/m.exec(parent) || [])[1] || "").split(/,\s*/).map((token) => token.trim()).filter(Boolean);
  const partRows = parts.map(row);
  const engineRow = parent === null || partRows.includes(null) ? null : [parent, ...partRows].join("\n");
  const indexRow = row("MAN-9468");
  if (engineRow === null || indexRow === null) return cannotRun("docstore get did not answer for " + (engineRow === null ? "MAN-10329" : "MAN-9468"));
  if (!/\btitles\b/.test(engineRow) || !engineRow.includes("\"files\"")) wrong.push("MAN-10329 does not state the titles verb's {\"files\":[…]} job");
  for (const word of ["custom-title", "ai-title", "last-prompt"]) if (!engineRow.includes(word)) wrong.push("MAN-10329 never names " + word);
  for (const word of ["readTitleRows", "pickSessionTitle"]) if (!indexRow.includes(word)) wrong.push("MAN-9468 never names " + word);
  if (indexRow.includes("extractSessionTitle")) wrong.push("MAN-9468 still names extractSessionTitle");

  if (wrong.length) return broken(wrong.join("; "));
  return held("the synchronizer calls readTitleRows and pickSessionTitle and names no readFile; nothing in server/ src/ rust/ names extractSessionTitle; titles.rs spells no directory; MAN-10329 states the titles verb and its three row types; MAN-9468 names the new home only");
});
