// The Proposed features face reads its route on mount, on a change of scope or state, and on each new
// `dispatcher_state` frame (`useProposals`, the frame `useBugDashboard` reads on too). That frame is the server's
// dispatcher lane (`createDispatcherWatcher`): poked by the store watch for every write the board counter counts, it
// reads `dispatcher status --json` and speaks only when the picture moved, `generated_at` and every `runtime_s` set
// aside (`changeOf`). A proposal written outside the face (a hunter's `bug propose` at night, a `bug proposal dismiss`
// from a chat, another tab's press) must therefore move that picture, or an open face goes on drawing a proposal the
// store no longer holds as it is drawn, with its tab count, until something unrelated moves.
//
// Measured on the live box 2026-11-20 (Athena, bug-hunters phase 16): `bug propose` moved `board_version` 4167 → 4168
// and left the picture unchanged; the open face kept the dismissed proposal `open`, its tab count 1, with no read in
// 30 s.
//
// The lane is the server's own, built here with its real comparison over a scratch dispatcher home
// (lib/bug_house.mjs), with no backstop and nothing broadcast but into this case. Each write is followed by one poke,
// as the store watch gives one.
//
// protects: server/modules/dispatcher/dispatcher-watcher.service.ts, server/shared/polled-lane.service.ts, src/modules/kanban/proposed/useProposals.ts, /home/lyphe/.claude/hooks/dispatcher/report.py, /home/lyphe/.claude/hooks/dispatcher/store_proposals.py, /home/lyphe/.claude/hooks/dispatcher/bug_propose.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, dispatcher, said } from "../lib/bug_house.mjs";

const LAND_MS = 60000;

runCase(async (t) => {
  const house = await bugHouse(t, "proposal-frame");
  const { createDispatcherWatcher } = await import("../../server/modules/dispatcher/dispatcher-watcher.service.ts");

  // The store is made by its first connect; a picture of a home with no store is not this case's question.
  const first = await dispatcher(house, ["status", "--json"]);
  if (first.code !== 0) return broken(`dispatcher status --json did not answer in the scratch home — ${said(first)}`);

  const frames: unknown[] = [];
  const faults: string[] = [];
  const lane = createDispatcherWatcher({
    backstopMs: null,
    snapshot: async () => {
      const ran = await dispatcher(house, ["status", "--json"]);
      if (ran.code !== 0) throw new Error(`dispatcher status --json — ${said(ran)}`);
      return JSON.parse(ran.out);
    },
    broadcast: (frame: unknown) => frames.push(frame),
    logError: (message: string) => faults.push(message),
  });

  const readAfter = async (poke: boolean) => {
    if (poke) lane.poke();
    // A poke's read is out once the lane says it landed; give a remembered poke its tick too.
    await lane.whenLanded(LAND_MS);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await lane.whenLanded(LAND_MS);
  };

  lane.start();
  try {
    await readAfter(false);
    if (faults.length > 0) return broken(`the lane could not read the scratch home: ${faults[0]}`);
    const atStart = frames.length;

    const made = await bug(house, ["propose", "--title", "One reader for the night", "--kind", "design"], { input: "The night has two readers." });
    if (made.code !== 0 || !made.out.startsWith("PROPOSED proposal 1")) return broken(`bug propose did not propose — ${said(made)}`);
    await readAfter(true);
    const afterPropose = frames.length - atStart;

    const ended = await bug(house, ["proposal", "dismiss", "1", "--reason=the case dismisses it"]);
    if (ended.code !== 0) return broken(`bug proposal dismiss 1 did not dismiss — ${said(ended)}`);
    await readAfter(true);
    const afterDismiss = frames.length - atStart - afterPropose;

    if (faults.length > 0) return broken(`the lane faulted: ${faults[0]}`);
    if (afterPropose < 1 || afterDismiss < 1) {
      return broken(`a proposal filed then dismissed sent ${afterPropose} and ${afterDismiss} dispatcher_state frames after their pokes, not one each: the Proposed features face, which reads on that frame, never hears either`);
    }
    return held(`a proposal filed then dismissed each sent a dispatcher_state frame (${afterPropose}, ${afterDismiss}) after its poke`);
  } finally {
    lane.stop();
  }
});
