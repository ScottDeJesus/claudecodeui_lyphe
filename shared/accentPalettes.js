/**
 * The accent palettes a box can wear instead of the app's own green, chosen by `VITE_ACCENT` in that
 * box's git-ignored `.env`. Unset — or any name not listed here — is the green that tokens.css
 * declares, untouched: a palette is an OVERRIDE, never a fork of the token file.
 *
 * One home for each palette, read by two consumers:
 *   - vite-plugins/accentPalette.js writes the ladder below into the page (`accentStyle`);
 *   - electron/scripts/generate-app-icons.js recolours the app's mark from the same ladder, so the tab
 *     icon, the logos and the installed-app icons can never drift from the colours on screen.
 *
 * Only the ACCENT is here. Green that means "healthy" or "success" (`--pos-*`, `--success-dot`) is a
 * different colour with a different meaning and stays green under every palette.
 *
 * Contrast the ladder keeps (the green ladder's own, measured with the WCAG formula; blue is at or
 * above each): white on the light accent fill 5.4:1 (green 3.0); `accent-ink` as text on canvas, card,
 * accent-soft and its hover 7.1 / 7.6 / 6.4 / 5.7 (green 4.8 / 5.1 / 4.5 / 4.1); the dark ink #101116
 * on the dark accent fill 8.8:1 (green 8.6); the dark `accent-ink` on the dark soft ground and its
 * hover 9.9 / 8.0 (green 8.9 / 7.2).
 */

export const ACCENT_PALETTES = {
  // The house's one blue is the launcher's brand (electron/launcher/launcher.css `--brand: #0a66d9`);
  // the light fill is that exact value and everything else is built around it.
  blue: {
    light: {
      accent: '#0a66d9',
      accentDeep: '#0853b3',
      accentInk: '#0750ae',
      accentSoft: '#e1ecfc',
      accentSoftHover: '#cfe0f9',
      onAccent: '#ffffff',
    },
    dark: {
      accent: '#7bb4ff',
      accentDeep: '#9cc3ff',
      accentInk: '#bcd6ff',
      accentSoft: '#15284a',
      accentSoftHover: '#1c3764',
      onAccent: '#101116',
    },
  },
};

/** The palette named `name`, or null for green (unset, or a name this file does not list). */
export function accentPaletteFor(name) {
  const key = String(name || '').trim().toLowerCase();
  return Object.hasOwn(ACCENT_PALETTES, key) ? { name: key, ...ACCENT_PALETTES[key] } : null;
}

/**
 * Where a palette's icon files live, mirroring `public/`: `/accent/<name>/favicon.png`,
 * `/accent/<name>/icons/icon-192x192.png`, `/accent/<name>/manifest.json`. A different URL from the
 * green icon on purpose — a browser keeps a tab icon under its URL for days, so recolouring the same
 * file would leave the old colour in the tab long after the page changed.
 */
export function accentAssetDir(name) {
  return `/accent/${name}`;
}

/**
 * The CSS that puts a palette on the page. Two rules, written with enough specificity to win over
 * tokens.css wherever it is loaded (the dev server injects stylesheets after the HTML, a build links
 * them before): the light ladder on the root, and the dark ladder on the root when it carries `.dark`
 * AND on any `.dark` wrapper below it (the station and the universe force dark on a subtree).
 *
 * `--accent-fixed` / `--accent-fixed-end` are the pair that never flips with the theme (the focus
 * ring's pulse, the default avatar, the failure-screen buttons): the light accent and the dark accent
 * deep. `--chart-1` / `--chart-4` are the accent and its light tint in the chart series.
 */
export function accentStyle(palette) {
  const { name, light, dark } = palette;
  const ladder = (colours) => `--accent:${colours.accent};--accent-deep:${colours.accentDeep};`
    + `--accent-ink:${colours.accentInk};--accent-soft:${colours.accentSoft};`
    + `--accent-soft-hover:${colours.accentSoftHover};--on-accent:${colours.onAccent};`;
  const root = `:root[data-accent="${name}"]`;
  return `${root}{${ladder(light)}--accent-fixed:${light.accent};--accent-fixed-end:${dark.accentDeep};`
    + `--chart-1:${light.accent};--chart-4:${dark.accentDeep};}`
    + `${root}.dark,${root} .dark{${ladder(dark)}}`;
}
