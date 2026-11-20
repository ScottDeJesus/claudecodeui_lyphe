// The card take-up ages a waiting card: a queued card rides one priority higher for every age_days whole days
// since it was told, never above high, and within one rank the oldest telling goes first. age_days 0 turns it off.
//
// Four queued cards in a scratch store: a low told 7 days ago (rides high), a low told 4 days ago (rides medium),
// a medium and a high told now. age_days 3: the 7-day low, the high, the 4-day low, the medium. age_days 0: the
// high, the medium, then the two lows oldest first. The sweep is the real one, its launch and holds stood in for
// (lib/card_queue.mjs), so nothing is walked and the operator's store is never opened.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/card_rule.py, /home/lyphe/.claude/hooks/dispatcher/card_age.py, /home/lyphe/.claude/hooks/dispatcher/card_config.py, /home/lyphe/.claude/hooks/dispatcher/cmd/card.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { dispatcher, scratchStore, seed, takeUpOrder } from "../lib/card_queue.mjs";

const HOOKS = ["/home/lyphe/.claude/hooks"];
const AGED = ["c-low-7", "c-high", "c-low-4", "c-medium"];
const UNAGED = ["c-high", "c-medium", "c-low-7", "c-low-4"];

runCase(async (t) => {
  const store = await scratchStore(t, "card-ageing", HOOKS);
  await seed(store, [
    { card: "c-high", priority: "high" },
    { card: "c-medium", priority: "medium" },
    { card: "c-low-4", priority: "low", daysAgo: 4 },
    { card: "c-low-7", priority: "low", daysAgo: 7 },
  ]);
  const wrong = [];
  const three = await dispatcher(store, ["card", "config", "--age-days", "3"]);
  if (three.code !== 0) return broken(`dispatcher card config --age-days 3 exited ${three.code}: ${(three.stdout + three.stderr).trim().split("\n").pop()}`);
  const aged = await takeUpOrder(store);
  if (aged.order.join(",") !== AGED.join(",")) wrong.push(`under age_days 3 the take-up launched ${aged.order.join(", ") || "nothing"} (${aged.lines.join(" | ")}), not ${AGED.join(", ")}`);

  // A second store, the same four cards, ageing off: the order is the board's priority alone.
  const off = await scratchStore(t, "card-ageing-off", HOOKS);
  await seed(off, [
    { card: "c-high", priority: "high" },
    { card: "c-medium", priority: "medium" },
    { card: "c-low-4", priority: "low", daysAgo: 4 },
    { card: "c-low-7", priority: "low", daysAgo: 7 },
  ]);
  const zero = await dispatcher(off, ["card", "config", "--age-days", "0"]);
  if (zero.code !== 0) return broken(`dispatcher card config --age-days 0 exited ${zero.code}: ${(zero.stdout + zero.stderr).trim().split("\n").pop()}`);
  const unaged = await takeUpOrder(off);
  if (unaged.order.join(",") !== UNAGED.join(",")) wrong.push(`under age_days 0 the take-up launched ${unaged.order.join(", ") || "nothing"}, not ${UNAGED.join(", ")}`);

  if (wrong.length) return broken(wrong.join("; "));
  return held(`age_days 3 took up ${AGED.join(", ")}; age_days 0 took up ${UNAGED.join(", ")}`);
});
