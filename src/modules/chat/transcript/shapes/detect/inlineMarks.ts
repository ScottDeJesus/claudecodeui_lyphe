/**
 * Inline marks: what an inline code span may be drawn as instead of code — a colour swatch or a
 * row of keycaps. Re-exported by `shapes/detect.ts` — import it from there.
 */

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** The whole text is a hex colour, so an inline code span can carry a swatch. */
export function parseHexColor(text: string): string | null {
  const trimmed = text.trim();
  return HEX_COLOR_RE.test(trimmed) ? trimmed : null;
}

const NAMED_KEYS = [
  'Ctrl', 'Cmd', 'Alt', 'Opt', 'Option', 'Shift', 'Meta', 'Super', 'Fn', 'Enter', 'Esc', 'Escape',
  'Tab', 'Space', 'Backspace', 'Delete', 'Up', 'Down', 'Left', 'Right', 'PgUp', 'PgDn', 'Home', 'End',
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
];
// Canonical spelling by lower-cased name, so `ctrl+c` and `Ctrl+C` draw the same keycaps.
const KEY_SPELLING = new Map(NAMED_KEYS.map((key) => [key.toLowerCase(), key]));
const MODIFIERS = new Set(['ctrl', 'cmd', 'alt', 'opt', 'option', 'shift', 'meta', 'super', 'fn']);

/**
 * A keyboard shortcut, or null. At least one MODIFIER is required, which is the only thing
 * standing between keycaps and arithmetic: `a + b` and `1 + 2` are two keys by every other test.
 */
export function parseKeyCombo(text: string): string[] | null {
  const parts = text.trim().split('+').map((part) => part.trim());
  if (parts.length < 2) return null;
  const keys: string[] = [];
  let hasModifier = false;
  for (const part of parts) {
    const spelled = KEY_SPELLING.get(part.toLowerCase());
    if (spelled) {
      if (MODIFIERS.has(spelled.toLowerCase())) hasModifier = true;
      keys.push(spelled);
      continue;
    }
    if (part.length !== 1) return null;
    keys.push(part);
  }
  return hasModifier ? keys : null;
}
