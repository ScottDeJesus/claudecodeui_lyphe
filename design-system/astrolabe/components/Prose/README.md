# Prose

What the session wrote, read as markdown and set to be read. One size, one measure, and no frames: a heading is a weight, a list is a dash or a figure, a table is rules between rows, code sits between two rules.

- **Provide** `text`: the markdown. Headings, paragraphs, bold, italic, struck, links, code, lists (nested, numbered, tasks), quotations, rules, tables, fenced code and pictures are read.
- The forms a reply reaches for each get one quiet shape, and only once the text has settled:
  - a line ending in a colon above a list or a table is its head, and folds it;
  - `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` is a callout: one rule in the tone, and its word;
  - `VERDICT: PASS — B:0 H:0 M:2 L:1` is a verdict: the word, then the four counts, toned only when they are not zero;
  - a `stats` fence (`Label | value | delta`) is a row of numbers; a `diff` fence is coloured by line; a fence of 25 lines or more shows 12 and offers the rest;
  - lines of `**Label:** value` are a KeyValueList; a list of tasks carries its count; a list of ✓ and ✗ carries its passes and failures.
- `streaming` is for text still arriving. Everything before the last blank line has settled and takes its forms; the block still being written stays plain, because a half-arrived list must never be read as a shape. A small working loop rides at the end, and the copy waits until it is whole.
- `onFile` makes a path in a code span (`src/rules.ts:43`) a link; it is given `{ path, line }`. `breaks` keeps single line breaks, for words a person typed. `quiet` sets it back, for a thought. `copy` adds one button under it that copies the markdown.
- **Your own markup**: the rules are on the class. Put `ast-prose reading` on the container of markdown you render yourself and its headings, lists, tables, quotations and code are dressed the same.
- Never frame a list or tint a heading. If a form needs more than one rule and one tone, it is not prose: it belongs on the panel.
