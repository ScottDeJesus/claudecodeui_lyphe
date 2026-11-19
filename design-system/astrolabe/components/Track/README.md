# Track

One thing's course as a line you read along: its steps, how far it has got and what it is doing, in one object.

- **Provide** `steps`, each `{ id, label, state }` with `done`, `live`, `next`, `failed` or `waiting`; a `label` for the whole course; and `onOpen(step, point)`. `value` keeps one step named.
- It is lit to where it has got, in `ink-quiet`: finished work is settled, not loud. The step being worked crawls `accent` dashes behind a bead. A failed step stops in `danger-dot`. A step waiting on you holds an open `accent` ring.
- **No words until you point.** Move along it and each step names itself on a plate, with its number; click one and it opens.
- It is `size-control` tall and as wide as its container. It reads from four steps to forty.
- Use it wherever a list of steps would otherwise sit on screen. Steps is the list that opens when you click.
