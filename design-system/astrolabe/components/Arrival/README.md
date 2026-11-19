# Arrival

How anything that was not on screen comes onto it and leaves it: mounted when it becomes true, settled away when it stops.

- **Provide** `when` (true while the thing is true) and `from`, the place that caused it: `object` (the thing it belongs to), `dock` (the foot), `core` (the companion) or `center`.
- `spring`: `lock` (default; `ease-lock` over `duration-lock`) for anything arriving at a place; `lobe` (`ease-lobe` over `duration-lobe`) only for what the companion draws out of itself: its words, its footprint, a prepared action.
- `linger`: milliseconds it stays still after `when` turns false, so a glance can catch it. Pass `duration-linger` (2400) for something that resolved on its own; leave 0 for something you dismissed.
- It leaves on `ease-settle` over `duration-settle`, shrinking back the way it came, then calls `onGone`. Keep rendering it with `when={false}` until then.
- Most things do not arrive at all: an object that is already on screen changes instead. Use Arrival for the few things with no object of their own: a control for what just started, the companion's words, a plate.
- Under reduced motion it only fades. Nothing pops in, slides in from off-screen, or animates for attention.
