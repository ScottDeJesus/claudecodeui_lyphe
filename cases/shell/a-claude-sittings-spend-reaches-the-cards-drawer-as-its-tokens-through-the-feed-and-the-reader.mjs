// A card walk's sitting on the Claude subscription is paid nothing (`cost_usd` 0, `costs.result_cost`): its spend is its
// TOKENS (`src/shared/spend.ts`: "a record on the subscription — no `$`, never `$0.00`"). The drawer offers each
// stage's spend, so the tokens have to survive every hop from the walk's record to the sitting's row:
//   1. the feed — `hooks/dispatcher/report_cards.py:_stages`, read here on the newest real chain record whose stages
//      carry `tokens_in`;
//   2. the server's reader — `server/modules/dispatcher/dispatcher-card.reader.ts:cardOf`, which keeps only the keys it
//      names;
//   3. the board — `useKanbanWalks`'s stage, drawn by `DrawerStepStages` through `spendText`, read at 390x844 off a feed
//      answered by lib/kanban_feed.mjs (whose stage carries the tokens the feed is to carry).
// Each hop that drops them is named. Nothing is written: the chain record is read, the reader is run on a made-up card.
//
// protects: src/modules/kanban/hooks/useKanbanWalks.ts, src/shared/types.ts, server/modules/dispatcher/dispatcher-card.reader.ts, src/modules/kanban/card-drawer/DrawerStepStages.tsx, /home/lyphe/.claude/hooks/dispatcher/report_cards.py
// writes: none

import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { withPage } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { CARDS, openBoard, openDrawer } from "../lib/kanban_board.mjs";
import { feedCards, stage, walk } from "../lib/kanban_feed.mjs";

const PHONE = { width: 390, height: 844 };
const WAIT_MS = 15000;
const HOME = os.homedir();
const READER = path.join(HOME, ".claude", "claudecodeui_lyphe", "server", "modules", "dispatcher", "dispatcher-card.reader.ts");
const TOKENS = { tokens_in: 16332101, tokens_out: 156783 };
const CARD = CARDS.change;

// The newest chain record holding a sitting with tokens, its record's figures and the feed's rows for it.
const FEED_PY = `
import glob, json, os, sys
sys.path.insert(0, os.path.expanduser("~/.claude/hooks"))
from dispatcher import report_cards
from plan_runner.solo import chain_state
for path in sorted(glob.glob(os.path.expanduser("~/.claude/state/dispatch-chains/*/chain.json")), key=os.path.getmtime, reverse=True):
    chain_id = os.path.basename(os.path.dirname(path))
    try:
        record = chain_state.load(chain_id)
    except Exception:
        continue
    spent = [s for s in record.get("stages") or [] if (s.get("tokens_in") or 0) > 0]
    if spent:
        print(json.dumps({"chain": chain_id, "record": [s.get("name") for s in spent], "rows": report_cards._stages(chain_id)}))
        break
else:
    print(json.dumps(None))
`;

const READER_JS = `import { cardOf } from ${JSON.stringify(READER)};
const card = cardOf(JSON.parse(process.argv[1]));
console.log(JSON.stringify(card.stages[0]));`;

runCase(async (t) => {
  const wrong = [];

  let feed;
  try {
    feed = JSON.parse(execFileSync("python3", ["-c", FEED_PY], { encoding: "utf8", timeout: 60000, cwd: HOME }));
  } catch (error) {
    return cannotRun(`the feed's stage rows could not be read: ${String(error?.message ?? error).split("\n")[0]}`);
  }
  if (feed === null) return cannotRun("no chain record on this box carries a sitting's tokens — never a finding");
  const dropped = feed.rows.filter((row) => feed.record.includes(row.name) && (typeof row.tokens_in !== "number" || typeof row.tokens_out !== "number"));
  if (dropped.length > 0) {
    wrong.push(`the feed (report_cards._stages) drops the tokens of ${dropped.map((row) => row.name).join(", ")} on ${feed.chain}, whose record carries them: ${JSON.stringify(dropped[0])}`);
  }

  const sample = walk({ card: CARD.id, stages: [{ ...stage("builder", "hephaestus", "case-launch-builder-0001", "done"), ...TOKENS }] });
  let read;
  try {
    const tsx = path.join(HOME, ".claude", "scripts", "cloudcli-tsx");
    read = JSON.parse(execFileSync(tsx, ["--input-type=module", "-e", READER_JS, JSON.stringify(sample)], { encoding: "utf8", timeout: 120000, cwd: os.tmpdir() }));
  } catch (error) {
    return cannotRun(`the server's card reader could not be run: ${String(error?.message ?? error).split("\n")[0]}`);
  }
  if (read.tokens_in !== TOKENS.tokens_in || read.tokens_out !== TOKENS.tokens_out) {
    wrong.push(`the server's reader (cardOf) drops the stage's tokens: ${JSON.stringify(read)}`);
  }

  const page = await withPage(t, { viewport: PHONE });
  await openBoard(page);
  await feedCards(page, [walk({
    card: CARD.id, title: CARD.title, state: "walking", flow: "change",
    stages: [{ ...stage("builder", "hephaestus", "case-launch-builder-0001", "done"), ...TOKENS }],
  })]);
  await openBoard(page);
  // The card is a mark on its ring since the board's redraw to the design system (2026-11-20): it opens from the keyboard.
  const drawer = await openDrawer(page, CARD.id);
  await drawer.waitFor({ timeout: WAIT_MS });
  const row = drawer.locator('[data-stage="builder"]').first();
  if (!(await row.waitFor({ timeout: WAIT_MS }).then(() => true, () => false))) {
    return cannotRun(`the drawer of "${CARD.title}" drew no builder sitting to read a spend off`);
  }
  const text = await row.innerText();
  if (!/\bin\b[\s\S]*\bout\b/.test(text)) {
    wrong.push(`the drawer's builder sitting, fed tokens_in ${TOKENS.tokens_in} and tokens_out ${TOKENS.tokens_out} at cost_usd 0, prints no token spend: ${JSON.stringify(text)}`);
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`the feed carried the tokens of ${feed.record.join(", ")} on ${feed.chain}, the reader kept them, and the drawer printed ${JSON.stringify(text.split("\n").find((line) => /\bin\b/.test(line)) ?? text)}`);
});
