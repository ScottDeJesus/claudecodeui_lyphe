# Badge

One or two words of status in one of five tones, always with its glyph so it survives greyscale.

- **Provide** `tone` — `neutral` (·), `info` (i), `positive` (✓), `warn` (▲), `danger` (✕) — and the words as `children`. `glyph={false}` only where the word already carries the state.
- Tones are states, never decoration. Warn is gold so it is never read as the live amber; danger is for destructive or denied only.
- The fill is the tone's `*-soft`, the words its `*-ink` (4.5:1 in both themes), the glyph its `*-dot`.
- A badge is a state in words, so it belongs where words are: an Opening's title row, a line of a Trace. On an object the state is carried by the object itself, never by a badge beside it.
