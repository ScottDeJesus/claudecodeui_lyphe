# BufferGauge

How much is queued ahead of the voice, as a row of 24 cells.

- **Provide** `value` (0–1) or `filled` (a count), optional `cells`, `caption`, `label`.
- Filled cells are `accent`, empty ones `track`, `space-2` apart.
- The caption is a sentence of units: "31 ph · 9 tok · 0.84 s ahead".
- It opens from the part it measures, or arrives while audio is queued and settles when the queue is empty.
