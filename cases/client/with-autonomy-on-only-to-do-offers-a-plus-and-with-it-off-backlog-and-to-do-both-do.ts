// The board's `+` is drawn on a lane whose spec says canAdd, and lanePolicy.ts is the one place that says
// it. With autonomy on, To Do is the only lane that offers `+`: a self-running board takes its work in
// To Do, where the dispatcher is told of it. With autonomy off, Backlog and To Do both offer it, as they
// did before.
//
// protects: src/modules/kanban/utils/lanePolicy.ts
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";

runCase(async () => {
  // Loaded in the body: a module that will not load ends the case CANNOT RUN, not with a bare exit 1.
  const { kanbanLanes } = await import("../../src/modules/kanban/utils/lanePolicy.ts");
  const adding = (autonomy: boolean): string[] =>
    kanbanLanes(autonomy)
      .filter((lane: { canAdd: boolean }) => lane.canAdd)
      .map((lane: { id: string }) => lane.id)
      .sort();

  const on = adding(true);
  const off = adding(false);
  const wrong: string[] = [];
  if (on.join(",") !== "todo") wrong.push(`with autonomy on, the lanes offering + are [${on.join(", ")}], not To Do alone`);
  if (off.join(",") !== "not_ready,todo") wrong.push(`with autonomy off, the lanes offering + are [${off.join(", ")}], not Backlog and To Do`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("autonomy on: only To Do offers +; autonomy off: Backlog and To Do do");
});
