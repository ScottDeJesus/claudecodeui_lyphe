// A key is one defect: however many detectors' calls carry it at the same moment, one open ticket holds it. Two open
// tickets on one key are a ticket nothing ever closes — a clearing ends the newest, and the other stays open on its
// card for good.
//
// In a scratch dispatcher home, from a scratch git folder: eight `bug file --source cerberus --key <k>` started at once,
// five rounds with a new key each, leave exactly one open ticket holding each key and exactly one `FILED` line per
// round; every other call answers `ALREADY FILED`. While filing reads the open ticket outside the write lock, some
// rounds file two or more.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_file.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/cmd/bug.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, rows, said } from "../lib/bug_house.mjs";

const ROUNDS = 5;
const AT_ONCE = 8;

runCase(async (t) => {
  const house = await bugHouse(t, "bug-key-at-once");
  const warm = await bug(house, ["list"]); // the store's tables exist before the race, so the race is the filing's alone
  if (warm.code !== 0) return broken(`bug list in a fresh home failed — ${said(warm)}`);

  const seen = [];
  for (let round = 1; round <= ROUNDS; round += 1) {
    const key = `check:node/at-once-${round}`;
    const runs = await Promise.all(Array.from({ length: AT_ONCE }, (_, i) =>
      bug(house, ["file", "--title", `Check ${round} is red`, "--key", key, "--source", "cerberus"],
        { input: `red, call ${i + 1}\n` })));
    const bad = runs.find((r) => r.code !== 0 || !/^(FILED|ALREADY FILED) ticket \d+/.test(r.out.trim()));
    if (bad) return broken(`round ${round}: a filing answered neither FILED nor ALREADY FILED — ${said(bad)}`);
    const filed = runs.filter((r) => r.out.trim().startsWith("FILED ticket")).length;
    const [{ n }] = await rows(house,
      "SELECT COUNT(DISTINCT t.id) AS n FROM tickets t JOIN ticket_keys k ON k.ticket_id = t.id "
      + "WHERE k.key = ? AND t.state IN ('filed', 'placed', 'unplaced')", [key]);
    seen.push(`${filed}/${n}`);
    if (filed !== 1 || n !== 1) {
      return broken(`round ${round} of ${AT_ONCE} filings at once of ${key}: ${filed} FILED lines and ${n} open tickets holding the key, not 1 and 1 (rounds so far, FILED/open: ${seen.join(" ")})`);
    }
  }
  return held(`${ROUNDS} rounds of ${AT_ONCE} filings at once of one key each filed once and left one open ticket (FILED/open: ${seen.join(" ")})`);
});
