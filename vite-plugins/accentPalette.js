// Puts this box's accent colour on the page, from `VITE_ACCENT` in its git-ignored `.env`.
//
// Unset, or a name shared/accentPalettes.js does not list, changes nothing: the page is today's
// green. A listed name (`blue`) does three things to index.html, so the colour is there at the first
// paint and not after a script ran:
//   - `data-accent="<name>"` on <html> (CSS and AppLogo key on it);
//   - an inline <style> carrying the palette's ladder, which overrides tokens.css's accent tokens;
//   - `%ACCENT_ASSETS%` in the icon, apple-touch and manifest links becomes `/accent/<name>`, where
//     `npm run icons` wrote that palette's recoloured copies of every icon (empty for green).
//
// Dev server and build alike: both run the HTML through transformIndexHtml. The production client
// on :5184 picks the change up on its next build, which `.env` already triggers.

import { accentAssetDir, accentPaletteFor, accentStyle } from '../shared/accentPalettes.js'

const ASSETS_PLACEHOLDER = '%ACCENT_ASSETS%'
const HTML_OPEN_TAG = /<html(?=[\s>])/

export default function accentPalette(requestedName) {
  const palette = accentPaletteFor(requestedName)

  return {
    name: 'accent-palette',
    configResolved(config) {
      // A typo in .env must not be a silent green. Same stance as VITE_DOCSPACE_EMBED_ORIGIN: the
      // default stands and the log says why.
      if (requestedName && !palette) {
        config.logger.warn(`[accent-palette] VITE_ACCENT="${requestedName}" is not a palette; the default accent stays.`)
      }
    },
    transformIndexHtml: {
      // Before Vite's own HTML pass, which would otherwise try to resolve the placeholder as a path.
      order: 'pre',
      handler(html) {
        const withAssets = html.replaceAll(ASSETS_PLACEHOLDER, palette ? accentAssetDir(palette.name) : '')
        if (!palette) return withAssets
        return {
          html: withAssets.replace(HTML_OPEN_TAG, `<html data-accent="${palette.name}"`),
          tags: [{ tag: 'style', attrs: { id: 'accent-palette' }, children: accentStyle(palette), injectTo: 'head-prepend' }],
        }
      },
    },
  }
}
