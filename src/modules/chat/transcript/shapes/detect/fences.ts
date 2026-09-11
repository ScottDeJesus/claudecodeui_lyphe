/**
 * Fences: what a fenced block's body is — a row of stat tiles, a diff, or output long enough to
 * fold. Re-exported by `shapes/detect.ts` — import it from there.
 */

export type StatTile = { label: string; value: string; delta: string | null };
export type DeltaTone = 'positive' | 'danger' | 'neutral';

/**
 * A `stats` fence: one tile per non-blank line, `label | value` or `label | value | delta`.
 * A single malformed line voids the WHOLE fence rather than dropping one tile — a four-cell line
 * is almost always a markdown table someone pasted, and half-drawing it loses a column silently.
 *
 * Two or three cells means two or three VALUES. One TRAILING empty cell is forgiven, because
 * `Latency | 42ms |` is the pipe habit every markdown writer has; a LEADING one is not, because
 * forgiving both would quietly turn `| Errors | 3 | -2 |` — a pasted table row, the four-cell case
 * this function exists to reject — into a tile that looks right and has lost its first column.
 */
export function parseStatsFence(body: string): StatTile[] | null {
  const tiles: StatTile[] = [];
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length > 2 && cells[cells.length - 1] === '') cells.pop();
    if (cells.length < 2 || cells.length > 3) return null;
    // An empty label or value is a slot the author left open, not a tile: drawing it renders a
    // headless number, and `deltaTone('')` would paint an absent delta as a real neutral one.
    if (!cells[0] || !cells[1]) return null;
    tiles.push({ label: cells[0], value: cells[1], delta: cells[2] || null });
  }
  // An empty fence is not a row of tiles; it is an empty fence, and it renders as one.
  return tiles.length > 0 ? tiles : null;
}

/** The tone of a delta string. Sign only: the shape never guesses whether "up" is good. */
export function deltaTone(delta: string | null): DeltaTone {
  const first = (delta ?? '').trim().charAt(0);
  if (first === '+') return 'positive';
  if (first === '-' || first === '−') return 'danger';
  return 'neutral';
}

/** Which kind of diff line this is. `+++`/`---` are tested first, or a header reads as a change. */
export function splitDiffLine(line: string): 'add' | 'remove' | 'hunk' | 'meta' | 'context' {
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta';
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'meta';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'remove';
  return 'context';
}

/** Line count over which a plain fence folds, and how much of it stays visible when it does. */
export const LONG_OUTPUT_LINES = 25;
export const LONG_OUTPUT_PREVIEW_LINES = 12;
