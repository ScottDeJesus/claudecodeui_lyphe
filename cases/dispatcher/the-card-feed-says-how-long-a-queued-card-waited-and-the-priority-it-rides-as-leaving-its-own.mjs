// The card feed (`dispatcher status --json`, what the board draws) says how a queued card rides: waited_days, whole
// days since it was told, and rides_as, the priority the take-up takes it at. The board's own priority is never
// rewritten: `dispatcher cards --json` still reads it as told. A card not queued carries neither.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/report_cards.py, /home/lyphe/.claude/hooks/dispatcher/card_age.py, /home/lyphe/.claude/hooks/dispatcher/card_config.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { dispatcher, feed, scratchStore, seed } from "../lib/card_queue.mjs";

const HOOKS = ["/home/lyphe/.claude/hooks"];
const ROWS = [
  { card: "c-low", priority: "low", daysAgo: 7 },
  { card: "c-medium", priority: "medium" },
  { card: "c-gone", priority: "high", state: "withdrawn", daysAgo: 7 },
];

const said = (c) => (c ? `waited_days ${JSON.stringify(c.waited_days)}, rides_as ${JSON.stringify(c.rides_as)}` : "no row");

runCase(async (t) => {
  const store = await scratchStore(t, "card-feed-age", HOOKS);
  await seed(store, ROWS);
  const wrong = [];
  await dispatcher(store, ["card", "config", "--age-days", "3"]);
  const aged = await feed(store);
  if (aged["c-low"]?.waited_days !== 7 || aged["c-low"]?.rides_as !== "high") wrong.push(`the low card told 7 days ago read ${said(aged["c-low"])}, not 7 and "high"`);
  if (aged["c-medium"]?.waited_days !== 0 || aged["c-medium"]?.rides_as !== "medium") wrong.push(`the medium told now read ${said(aged["c-medium"])}, not 0 and "medium"`);
  const gone = aged["c-gone"];
  if (gone && (gone.waited_days != null || gone.rides_as != null)) wrong.push(`the withdrawn card read ${said(gone)}, not neither`);

  const rows = await dispatcher(store, ["cards", "--json"]);
  const low = JSON.parse(rows.stdout || "[]").find((r) => r.card === "c-low");
  if (low?.priority !== "low") wrong.push(`dispatcher cards --json reads the low card's priority ${JSON.stringify(low?.priority)}, not "low"`);

  await dispatcher(store, ["card", "config", "--age-days", "0"]);
  const off = await feed(store);
  if (off["c-low"]?.waited_days !== 7 || off["c-low"]?.rides_as !== "low") wrong.push(`under age_days 0 the low card read ${said(off["c-low"])}, not 7 and "low"`);

  if (wrong.length) return broken(wrong.join("; "));
  return held(`age_days 3: low ${said(aged["c-low"])}, medium ${said(aged["c-medium"])}, its priority still low; age_days 0: low ${said(off["c-low"])}`);
});
