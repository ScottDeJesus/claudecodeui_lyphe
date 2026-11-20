// A key is how a detector says "this again": a filing whose key an OPEN ticket already holds is that ticket, never a
// second one, and a key it lacks is added to it. A filing with no key (a chat's or a soul's own words) is always new.
//
// In a scratch dispatcher home, from a scratch git folder: `bug file --title T --key a` prints `FILED ticket <id> — T —
// for <folder>`; `bug file --title T2 --key a --key b` prints `ALREADY FILED ticket <the same id>`, writes no ticket,
// keeps the title T and leaves the ticket holding a and b once each; two keyless filings of the same words are two
// tickets.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_file.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/cmd/bug.py, /home/lyphe/.claude/scripts/bug
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, rows, said } from "../lib/bug_house.mjs";

const FILED = /^FILED ticket (\d+) — (.*) — for (.*)$/;
const ALREADY = /^ALREADY FILED ticket (\d+) — /;

runCase(async (t) => {
  const house = await bugHouse(t, "bug-key-already");

  const first = await bug(house, ["file", "--title", "The first title", "--key", "case:a"], { input: "what I ran, and what it printed\n" });
  const m1 = first.out.trim().match(FILED);
  if (first.code !== 0 || !m1) return broken(`the first keyed filing did not print FILED ticket … — ${said(first)}`);
  if (m1[2] !== "The first title" || m1[3] !== house.repo) {
    return broken(`FILED named title ${JSON.stringify(m1[2])} for ${JSON.stringify(m1[3])}, not "The first title" for ${house.repo}`);
  }
  const id = Number(m1[1]);

  const again = await bug(house, ["file", "--title", "Another title", "--key", "case:a", "--key", "case:b"], { input: "the same thing again\n" });
  const m2 = again.out.trim().match(ALREADY);
  if (again.code !== 0 || !m2) return broken(`a filing whose key an open ticket holds did not print ALREADY FILED — ${said(again)}`);
  if (Number(m2[1]) !== id) return broken(`ALREADY FILED named ticket ${m2[1]}, not ${id}`);

  const tickets = await rows(house, "SELECT id, title FROM tickets ORDER BY id");
  if (tickets.length !== 1) return broken(`after a filing and its repeat the store holds ${tickets.length} tickets, not 1`);
  if (tickets[0].title !== "The first title") return broken(`the repeat rewrote the ticket's title to ${JSON.stringify(tickets[0].title)}`);
  const keys = (await rows(house, "SELECT key FROM ticket_keys WHERE ticket_id = ? ORDER BY key", [id])).map((r) => r.key);
  if (JSON.stringify(keys) !== JSON.stringify(["case:a", "case:b"])) {
    return broken(`the ticket holds the keys ${JSON.stringify(keys)}, not case:a and case:b once each`);
  }

  const words = "the same keyless words\n";
  const loose1 = await bug(house, ["file", "--title", "No key"], { input: words });
  const loose2 = await bug(house, ["file", "--title", "No key"], { input: words });
  const ids = [loose1, loose2].map((r) => r.out.trim().match(FILED)?.[1]);
  if (loose1.code !== 0 || loose2.code !== 0 || ids.some((x) => !x) || ids[0] === ids[1]) {
    return broken(`two keyless filings were not two new tickets — ${said(loose1)} / ${said(loose2)}`);
  }
  return held(`FILED ticket ${id}; the repeat with a new key was ALREADY FILED ticket ${id}, holding case:a and case:b, one ticket; two keyless filings were tickets ${ids.join(" and ")}`);
});
