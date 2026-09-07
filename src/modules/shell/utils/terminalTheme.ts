import type { ITheme } from '@xterm/xterm';

/**
 * The terminal's colours, read from the Verve tokens live on `<html>`.
 *
 * xterm.js keeps a snapshot of whatever colours it was handed, so this is a READ, not a
 * constant: it is called once when the terminal is built and again after every theme flip,
 * and both times it returns whatever `tokens.css` is currently declaring. Hard-coding the
 * ground here would be a second palette, and two palettes drift.
 */

/**
 * The eight light-ground ANSI colours Verve has no word for.
 *
 * Blue and magenta are not roles the palette names — a page has no "blue" the way it has a
 * danger ink — and the eight `bright` variants are each their base one step deeper, because on
 * a light page the emphatic version of a colour is the darker one. Each is the DARK set's own
 * hue at the same saturation, darkened until it clears the floor, so `\x1b[34m` is still
 * recognisably blue.
 *
 * These stay literals on purpose: inventing a `--terminal-blue` token would put a colour into
 * the app's palette that no part of the app paints, to serve a protocol the app does not own.
 * The eight that DO have a role are read from `tokens.css` below, never copied.
 */
const INVENTED_LIGHT_ANSI = {
  blue: '#226dbf',
  magenta: '#ad3aad',
  brightRed: '#902c30',
  brightGreen: '#155c3e',
  brightYellow: '#654a17',
  brightBlue: '#194f8b',
  brightMagenta: '#7f2b7f',
  brightCyan: '#1a5763',
} as const;

/** The order the 256-colour cube carries these sixteen roles in. */
const ANSI_ORDER = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const;

/**
 * The sixteen ANSI colours for a LIGHT ground, and why they exist at all.
 *
 * A terminal's ground and its ANSI palette are one system. The app's default palette is VS
 * Code's dark-terminal set, tuned against a `#1e1e1e` ground; laid on `--surface2` light
 * (`#f0f0f4`) ten of its sixteen fall under 3:1 and four fall under 1.2:1 — `yellow` measures
 * 1.19, `brightYellow` 1.03. Any program that colours its own output (`git`, `npm`, a CLI's
 * banners) then prints text nobody can read, in the app's DEFAULT theme.
 *
 * So the ground moved and the palette had to move with it. Eight of the sixteen are ROLES the
 * palette already names, and those are READ from it — not transcribed. A hex copy of
 * `--warn-ink` would leave the terminal behind the next time that token changed, which is the
 * drift this file's opening paragraph refuses.
 *
 * Measured against `#f0f0f4`: every entry ≥ 4.46:1, fourteen of sixteen ≥ 4.5:1 (AA text);
 * worst `brightBlack` 4.46, best `black`/`brightWhite` 15.59. Those two share `--ink` because
 * the token ladder holds three greys that clear the floor and both of them mean "as much ink
 * as this page has"; nothing else in the set collapses.
 *
 * The DARK set is untouched and stays in `useShellTerminal`'s `TERMINAL_OPTIONS`: on
 * `--surface2` dark it measures 2.65–15.21, which is the ground it was drawn for. (ANSI
 * `black` reads 1.38 there, as it does on every dark terminal ever shipped — that is what the
 * colour means, not a defect this file can cure.)
 */
function readLightAnsi(token: (name: string) => string | undefined): ITheme {
  return {
    black: token('--ink'),
    red: token('--danger-ink'),
    green: token('--pos-ink'),
    yellow: token('--warn-ink'),
    cyan: token('--info-ink'),
    white: token('--ink-mid'),
    brightBlack: token('--ink-muted'),
    // Both mean "as much ink as this page has"; `white` sits a clear step lighter, so the
    // emphasis a program asks for with brightWhite still reads.
    brightWhite: token('--ink'),
    ...INVENTED_LIGHT_ANSI,
  };
}

/** WCAG relative luminance, enough of it to tell a light ground from a dark one. */
function isLightGround(color: string): boolean {
  const value = color.trim().replace('#', '');
  if (value.length !== 6) return false;

  const channel = (offset: number) => {
    const raw = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4) > 0.5;
}

export function readTerminalGround(): ITheme {
  const root = getComputedStyle(document.documentElement);

  // A token that has not resolved yields '' rather than a colour. Returning `undefined` for
  // it leaves xterm on its own default instead of painting an empty string, so a stylesheet
  // that has not loaded yet degrades to a readable terminal rather than an invisible one.
  const token = (name: string): string | undefined => root.getPropertyValue(name).trim() || undefined;

  const background = token('--surface2');

  const ground: ITheme = {
    background,
    foreground: token('--ink-mid'),
    cursor: token('--accent'),
    // The ink drawn INSIDE a block cursor: the ground it sits on, so the glyph under the
    // cursor stays legible instead of matching the cursor itself.
    cursorAccent: background,
    selectionBackground: token('--accent-soft'),
    // A selection needs both halves. tokens.css pairs `--accent-soft` with `--accent-ink` for
    // the app's own `::selection`; this is that same pairing carried inside the terminal,
    // where the previous hard-coded white would have vanished on the pale light-mode fill.
    selectionForeground: token('--accent-ink'),
  };

  // The palette follows the GROUND, not the theme flag — measure what the terminal is
  // actually being painted on and hand it the set drawn for it. A later change to
  // `--surface2` therefore still gets the right sixteen without touching this file.
  if (!background || !isLightGround(background)) {
    return ground;
  }

  const ansi = readLightAnsi(token);

  // The first sixteen slots of the 256-colour cube carry the same sixteen roles in the same
  // order, and six of the app's defaults fail on a light ground for the same reason (`#ffff00`
  // measures 1.06). One root, one cure: the indexed palette is the named one. It is only
  // handed over COMPLETE — a token that did not resolve leaves the whole indexed block on
  // xterm's default rather than shipping a palette with holes in it.
  const indexed = ANSI_ORDER.map((name) => ansi[name]).filter((value): value is string => Boolean(value));

  return indexed.length === ANSI_ORDER.length
    ? { ...ansi, extendedAnsi: indexed, ...ground }
    : { ...ansi, ...ground };
}
