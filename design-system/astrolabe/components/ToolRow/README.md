# ToolRow

One thing the session did, folded to a line: its mark, its name, what it acted on, and how it came out. The whole line opens it. Nothing it wrote is on screen until you ask.

- **Provide** `label` (the tool's name), `icon` (`terminal`, `file`, `pencil`, `search`, `globe`, `thought`, `question`; `tool` when it has none) and `title`: what it acted on, in the session's own words when it gave any. `mono` sets a title that is a command or a path in the instrument's figures.
- `state` is said at the end of the line only when it is not ordinary, in the words a session's state is said in everywhere: `running` is "Working", `error` "Failed", `waiting` "Needs you", `denied` "Denied", `allowed` "Allowed by you". A row that `finished` says nothing.
- A finished turn's work is one row: `label: 'Work'`, `count` the tools it used, `diff` what they changed in all, the tools' names as its title, and the rows themselves as its children. While the turn runs, each row is its own line, and the one it is on is wrapped in a Reticle (`locked`, `sweep: false`).
- `command` and `output` are what a run opens to: the command after a `$`, then what came back, scrolling past 320px. The count of lines shows while it is folded. `copy` adds a copy button that appears on hover; under a finger it is inside what the row opens to, and the line is `size-control` tall.
- `diff` (`{ added, removed }`) rides beside the name of an edit. `children` is whatever else it opens to: an Excerpt of the change, a thought as Prose.
- `count` marks a run of the same tool, and its `children` are then the rows themselves. `onTitle` makes the title a link (a file that opens) while the rest of the line still folds.
- A thought is the same row: `icon: 'thought'`, `label: 'Thinking'`, its first line as the title.
- A row with nothing to open is not a button. Never show what it wrote by default: `defaultOpen` is for a run you were asked to show.
