// protects: /home/lyphe/.claude/hooks/cases/cmd/cure.py, /home/lyphe/.claude/hooks/cases/run.py, /home/lyphe/.claude/hooks/dispatcher/bug_file.py, /home/lyphe/.claude/hooks/dispatcher/bug_end.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py
// writes: none
//
// The night's cure files its own ticket: once `cases cure` has written its walk onto the triage rows it files, through
// `bug_file.file`, a `nightly` ticket at `high` keyed `case:<suite repo>:<case>`, naming the walk, for the suite's repo,
// titled as the cure brief is titled, and prints the ticket's line under `CURING`. A run of that case that holds clears
// the ticket (`run.py` → `bug_end.case_held`). A filing that faults is one stderr line and never the cure's exit code:
// the walk is out either way (INV-78).
//
// A scratch dispatcher home over a scratch suite with two cases, each broken and triaged a regression. The walk door is
// the one thing stood in for (`cases.cure.launch` answers a made-up walk id), so no soul is launched; the verb itself,
// `cases.cmd.cure._cure`, runs whole. The second case's cure runs with the scratch store refusing every ticket insert.

import fs from "node:fs";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bug, rows, said } from "../lib/bug_house.mjs";
import { cases, cureHouse, py, PRELUDE, seedBreak } from "../lib/cure_house.mjs";

const W1 = "chain-cure-case-filed-20261119-000000-0001";
const W2 = "chain-cure-case-fault-20261119-000000-0002";

const CURE = PRELUDE + String.raw`
import argparse, io, contextlib
from cases import cure as cure_mod
from cases.cmd import cure as cmd
name, repo, culprit, walk = sys.argv[1:5]
cure_mod.launch = lambda argv: (walk, "")
out, err = io.StringIO(), io.StringIO()
with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
    code = cmd._cure(argparse.Namespace(names=[name], suite=repo, culprit=[culprit], dry_run=False))
print(json.dumps({"code": code, "out": out.getvalue(), "err": err.getvalue()}))
`;

const REFUSE_TICKETS = PRELUDE + String.raw`
from dispatcher import store
conn = store.connect()
with conn:
    conn.execute("CREATE TRIGGER case_refuses_tickets BEFORE INSERT ON tickets BEGIN SELECT RAISE(ABORT, 'the scratch store refuses tickets'); END")
print(json.dumps({"ok": True}))
`;

function lines(text) {
  return String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
}

runCase(async (t) => {
  const h = await cureHouse(t, "cure-files-ticket", ["filed-one", "fault-one"]);
  await seedBreak(h, "filed-one");
  await seedBreak(h, "fault-one");
  const wrong = [];

  // 1. The cure files its ticket under its CURING line.
  const first = await py(h, CURE, ["filed-one", h.repo, h.culprit, W1]);
  if (first.code !== 0 || !first.json) return cannotRun(`the cure verb could not be driven: ${said(first)}`);
  const out1 = lines(first.json.out);
  if (first.json.code !== 0) return cannotRun(`the cure of filed-one exited ${first.json.code}: ${first.json.out} ${first.json.err}`);
  const curing = out1.findIndex((l) => l.startsWith("CURING filed-one — walk " + W1));
  const filedAt = out1.findIndex((l) => /^FILED ticket \d+ — /.test(l));
  if (curing < 0) wrong.push(`the cure printed no CURING line for ${W1}: ${JSON.stringify(out1)}`);
  if (filedAt < 0) wrong.push(`the cure printed no FILED ticket line: ${JSON.stringify(out1)}`);
  else if (curing >= 0 && filedAt < curing) wrong.push("the FILED line came before the CURING line, not under it");

  const tickets = await rows(h, "SELECT * FROM tickets ORDER BY id");
  const keys = await rows(h, "SELECT ticket_id, key FROM ticket_keys ORDER BY key");
  const ticket = tickets[0];
  if (tickets.length !== 1 || !ticket) {
    wrong.push(`the store holds ${tickets.length} ticket(s) after one cure, not 1`);
  } else {
    const want = { source: "nightly", priority: "high", walk: W1, path: h.repo, state: "filed" };
    for (const [k, v] of Object.entries(want)) if (ticket[k] !== v) wrong.push(`the ticket's ${k} is ${JSON.stringify(ticket[k])}, not ${JSON.stringify(v)}`);
    const keyed = keys.filter((k) => k.ticket_id === ticket.id).map((k) => k.key);
    if (JSON.stringify(keyed) !== JSON.stringify([h.key("filed-one")])) wrong.push(`the ticket's keys are ${JSON.stringify(keyed)}, not ["${h.key("filed-one")}"]`);
    const brief = (out1.find((l) => l.startsWith("CURING")) || "").split(" — brief ").pop();
    const title = brief && fs.existsSync(brief) ? (fs.readFileSync(brief, "utf8").split("\n")[0] || "").replace(/^#\s*/, "") : null;
    if (title === null) wrong.push(`the CURING line names no brief on disk (${brief})`);
    else if (ticket.title !== title) wrong.push(`the ticket's title is ${JSON.stringify(ticket.title)}, not the brief's ${JSON.stringify(title)}`);
    if (!String(ticket.words).includes("filed-one")) wrong.push("the ticket's words do not carry the brief's case section (no case name in them)");
    if (/^## Start here/m.test(String(ticket.words))) wrong.push("the ticket's words carry the brief's Start here section, not only its Goal and cases");
  }

  // 2. A held run of the case clears that ticket.
  const caseDir = path.join(h.repo, "cases", "scratch");
  fs.mkdirSync(caseDir, { recursive: true });
  fs.writeFileSync(path.join(caseDir, "filed-one.mjs"), 'console.log("HELD: the scratch case holds");\n');
  const run = await cases(h, ["run", "filed-one", "--suite", h.repo, "--trigger", "hand"]);
  const [runRow] = await rows(h, "SELECT r.word FROM case_runs r JOIN intents i ON i.id = r.intent_id WHERE i.name = 'filed-one' ORDER BY r.id DESC LIMIT 1");
  if (!runRow || runRow.word !== "held") return cannotRun(`the scratch case did not record a held run: ${said(run)}`);
  if (ticket) {
    const [after] = await rows(h, "SELECT state, ended_at FROM tickets WHERE id = ?", [ticket.id]);
    if (!after || after.state !== "cleared" || !after.ended_at) wrong.push(`after a held run of filed-one its ticket reads ${JSON.stringify(after)}, not cleared`);
  }

  // 3. A filing that faults is one stderr line, and the cure still answers 0.
  const refused = await py(h, REFUSE_TICKETS);
  if (refused.code !== 0) return cannotRun(`the scratch store would not take its refusing trigger: ${said(refused)}`);
  const second = await py(h, CURE, ["fault-one", h.repo, h.culprit, W2]);
  if (second.code !== 0 || !second.json) return cannotRun(`the second cure could not be driven: ${said(second)}`);
  const errLines = lines(second.json.err);
  const faultLine = `cases: cure fault-one: walk ${W2} is out; its ticket was not filed — `;
  if (second.json.code !== 0) wrong.push(`a cure whose ticket could not be filed exited ${second.json.code}, not 0: ${JSON.stringify(second.json.out)}`);
  if (!lines(second.json.out).some((l) => l.startsWith("CURING fault-one — walk " + W2))) wrong.push(`the faulted cure printed no CURING line: ${JSON.stringify(second.json.out)}`);
  if (errLines.length !== 1 || !errLines[0].startsWith(faultLine)) wrong.push(`its stderr is ${JSON.stringify(errLines)}, not the one line ${JSON.stringify(faultLine + "<why>")}`);
  const [cure2] = await rows(h, "SELECT t.cure FROM case_triage t JOIN intents i ON i.id = t.intent_id WHERE i.name = 'fault-one'");
  if (!cure2 || cure2.cure !== W2) wrong.push(`the faulted cure's walk was not recorded on its triage row (${JSON.stringify(cure2)})`);

  if (wrong.length) return broken(wrong.join("; "));
  return held("the cure printed CURING then FILED, its ticket nightly/high/keyed/walked/titled as the brief, a held run cleared it, and a refused filing was one stderr line at exit 0");
});
