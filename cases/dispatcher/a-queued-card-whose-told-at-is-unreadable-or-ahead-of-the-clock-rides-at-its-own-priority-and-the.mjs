// A told_at the take-up cannot age by never stops the pass: a medium stamped a day ahead of the clock and a low
// whose stamp is not a stamp each ride at their own priority, waited_days 0, and every queued card is still
// launched in order. One unreadable row must not fail the whole take-up step (card_rule guards a step whole, so a
// key that raises would launch nothing at all) nor the feed the board reads.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/card_age.py, /home/lyphe/.claude/hooks/dispatcher/card_rule.py, /home/lyphe/.claude/hooks/dispatcher/report_cards.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { dispatcher, feed, scratchStore, seed, takeUpOrder } from "../lib/card_queue.mjs";

const HOOKS = ["/home/lyphe/.claude/hooks"];
const ORDER = ["c-low-7", "c-high", "c-medium-ahead", "c-low-bad"];

runCase(async (t) => {
  const store = await scratchStore(t, "card-age-odd-stamps", HOOKS);
  await seed(store, [
    { card: "c-high", priority: "high" },
    { card: "c-medium-ahead", priority: "medium", daysAgo: -1 },
    { card: "c-low-bad", priority: "low", toldAt: "not a stamp" },
    { card: "c-low-7", priority: "low", daysAgo: 7 },
  ]);
  await dispatcher(store, ["card", "config", "--age-days", "3"]);
  const wrong = [];
  const cards = await feed(store);
  const ahead = cards["c-medium-ahead"];
  const bad = cards["c-low-bad"];
  if (ahead?.waited_days !== 0 || ahead?.rides_as !== "medium") wrong.push(`the medium told a day ahead read waited_days ${ahead?.waited_days} rides_as ${ahead?.rides_as}, not 0 and "medium"`);
  if (bad?.waited_days !== 0 || bad?.rides_as !== "low") wrong.push(`the low with an unreadable told_at read waited_days ${bad?.waited_days} rides_as ${bad?.rides_as}, not 0 and "low"`);
  const { order, lines } = await takeUpOrder(store);
  if (order.join(",") !== ORDER.join(",")) wrong.push(`the take-up launched ${order.join(", ") || "nothing"} (${lines.join(" | ")}), not ${ORDER.join(", ")}`);

  if (wrong.length) return broken(wrong.join("; "));
  return held(`the feed read the ahead medium and the unreadable low at waited_days 0, riding medium and low; the take-up launched ${ORDER.join(", ")}`);
});
