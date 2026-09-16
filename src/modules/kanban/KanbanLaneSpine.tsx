/**
 * A LANE THE READER PUT AWAY: its title and its count, at the width of a spine.
 *
 * The kit's lane has no collapsed state — a lane is cards and a header, and hiding them is not a
 * prop it takes — so a collapsed lane is drawn as this instead of as a `KanbanLane`. It carries the
 * two things a reader collapses a lane TO KEEP: which lane it is, and how much is in it.
 *
 * IT IS ITS OWN RE-OPEN CONTROL, and deliberately the whole of it: a lane collapsed because it is
 * empty has no card to click, and a spine that only a menu row could open would be a lane the
 * reader cannot get back. `data-lane-id` and `aria-expanded` are what the rail's ←/→ walk and a
 * screen reader read it by — the same attribute the kit's lane root carries, so the board sees one
 * kind of lane either way.
 */

type KanbanLaneSpineProps = {
  /** The opaque id the board's policy gave the lane. The kit never compares it to a literal. */
  laneId: string;
  /** Already translated. */
  title: string;
  /** Server-side total, or `null` while the lane counts have not landed. Never `0` as a stand-in. */
  count: number | null;
  /** What collapses the lane in the other direction. */
  onExpand: () => void;
};

/** Rendered by KanbanPanel in place of a lane the reader collapsed. Nothing else mounts it. */
export function KanbanLaneSpine({ laneId, title, count, onExpand }: KanbanLaneSpineProps) {
  return (
    <button
      type="button"
      data-lane-id={laneId}
      aria-expanded={false}
      onClick={onExpand}
      // Vertical writing: the title reads top-to-bottom in a column a tenth the lane's width, so a
      // second lane stays visible on a phone rather than being pushed off by a collapsed one.
      className="vv-lane flex w-10 shrink-0 flex-col items-center gap-2 rounded-md border border-border py-3 text-foreground hover:bg-accent"
    >
      <span className="vv-tabular text-xs text-muted-foreground">{count ?? '—'}</span>
      <span className="text-sm font-medium [writing-mode:vertical-rl]">{title}</span>
    </button>
  );
}
