# Rail

A long run as a spine of marks, one for each turn: where you are in it, what is in it, and the way to any part of it.

- **Provide** `items`: `{ id, kind, label, tone }`. `kind` is `you` (a tick off the spine), `reply` (a bead on it) or `break` (a gap, where the run was cut or summarised). `label` is the turn's first words: its title, and its name for assistive tech.
- `at` is the id of the turn in view; its mark is lit. `onGo(id)` is a press on a mark: scroll the turn to the top.
- `tone: 'accent'` on a turn that needs you, `'info'` on one still running. Nothing else is coloured.
- It grows from its foot, so stand it over the thing the run belongs to: in a chat, over the core. With many turns the marks close up; they never scroll.
- Leave it out when there is nothing to go to (fewer than four turns), and on a narrow screen.
