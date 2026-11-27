// protects: deploy/dev-supervisor/README.md, deploy/dev-supervisor/supervisor.mjs, deploy/systemd/cloudcli-client-prod.service, deploy/systemd/cloudcli-server-dev.service, /home/lyphe/.claude/README.md
// writes: none
//
// Nothing the house reads names the two removed dev watchdogs: no tracked or unignored file of the repo, not the house README, not the
// docstore rows MAN-553, MAN-558, MAN-849 nor the rows that govern the supervisor's files; the client unit files say nothing of a
// watchdog re-asserting their drops; and one docstore row names the four keeper checks with the two deploy/heal scripts. Read only.
// The removed names are joined at run time so this file is not one of the files that names them.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const HOME_README = path.join(os.homedir(), ".claude", "README.md");
const DOCSTORE = path.join(os.homedir(), ".claude", "scripts", "docstore");
const NAMES = ["cloudcli-dev", "eis-dev", "eis-app-dev"].map((name) => name + "-watch" + "dog"); // the units' names and the scripts'
const NAMING = new RegExp(NAMES.join("|"));
const ROWS = ["MAN-553", "MAN-558", "MAN-849"];
const GOVERNED = ["deploy/dev-supervisor/README.md", "deploy/dev-supervisor/supervisor.mjs", "deploy/systemd/cloudcli-server-dev.service"];
const KEEPERS = ["cloudcli/dev-client.compiles", "cloudcli/prod-client.ok", "cloudcli/bridge.dropped", "eis-app/dev.compiles", "dev-unit.sh", "bridge-drop.sh"];

function run(command, args) {
  try {
    return { code: 0, out: execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60000, stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (error) {
    return { code: typeof error.status === "number" ? error.status : -1, out: String(error.stdout ?? ""), err: String(error.stderr ?? error.message) };
  }
}
/** A row's plain text, or null when the store refuses it (retired or unknown: then it names nothing). */
const rowText = (token) => { const got = run(DOCSTORE, ["get", token, "--text"]); return got.code === 0 ? got.out : null; };
const tokensOf = (text) => text.split("\n").map((line) => line.split(" ")[0]).filter((word) => /^(MAN|INV)-\d+$/.test(word));

runCase(async () => {
  const wrong = [];
  const grep = run("git", ["-C", REPO, "grep", "-l", "--untracked", "-I", "-E", NAMES.join("|")]);
  if (grep.code === 0) wrong.push("repo files name them: " + grep.out.trim().split("\n").slice(0, 5).join(", "));
  else if (grep.code !== 1) return cannotRun("git grep would not run: " + (grep.err ?? "").split("\n")[0]);
  if (NAMING.test(fs.readFileSync(HOME_README, "utf8"))) wrong.push(HOME_README + " names them");
  const unitDir = path.join(REPO, "deploy", "systemd");
  for (const file of fs.readdirSync(unitDir).filter((name) => /^cloudcli-client-.*\.service$/.test(name))) {
    const said = fs.readFileSync(path.join(unitDir, file), "utf8").split("\n").filter((line) => /watchdog/i.test(line));
    if (said.length) wrong.push(file + " still speaks of a watchdog: " + said[0].trim().slice(0, 80));
  }
  const tokens = new Set(ROWS);
  for (const file of GOVERNED) {
    const governed = run(DOCSTORE, ["govern", path.join(REPO, file), "--touch", "write", "--limit", "30", "--text"]);
    if (governed.code !== 0) return cannotRun("docstore govern " + file + " would not answer: " + (governed.err ?? "").split("\n")[0]);
    for (const token of tokensOf(governed.out)) tokens.add(token);
  }
  for (const token of tokens) {
    const text = rowText(token);
    if (text === null) continue;
    if (/^\S+ probe\b/.test(text.split("\n")[0])) continue; // a probe row quotes its ground; its own review retires it
    if (NAMING.test(text)) wrong.push(token + " names them");
  }
  // Two searches of the row's own words: the four keys alone rank the rows that name one key each above the row naming all four.
  let hits = [];
  for (const words of [KEEPERS.join(" "), "Cerberus keepers " + KEEPERS.slice(4).join(" ")]) {
    const search = run(DOCSTORE, ["search", words]);
    try { for (const token of (JSON.parse(search.out).rows ?? []).map((row) => row.token).slice(0, 8)) if (!hits.includes(token)) hits.push(token); } catch {}
  }
  const listing = hits.find((token) => { const text = rowText(token) ?? ""; return KEEPERS.every((word) => text.includes(word)); });
  if (!listing) wrong.push("no docstore row found by its words names all four keeper checks with dev-unit.sh and bridge-drop.sh (searched: " + (hits.join(" ") || "none") + ")");
  if (wrong.length) return broken(wrong.slice(0, 4).join("; ") + (wrong.length > 4 ? "; and " + (wrong.length - 4) + " more" : ""));
  return held("nothing in the repo, the house README, the client units or " + tokens.size + " docstore rows names the removed watchdogs, and " + listing + " lists the four keepers and both scripts");
});
