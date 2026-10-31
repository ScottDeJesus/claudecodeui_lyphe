import type { CSSProperties } from 'react';

type AppLogoProps = {
  /** The rendered PNG's pixel size — pick the one at least twice the box it is drawn in. */
  size: 32 | 64 | 128 | 256 | 512;
  className?: string;
  style?: CSSProperties;
  alt?: string;
};

/**
 * Used by the auth, station, settings and app-switcher modules to draw the app's own mark.
 *
 * The app's own mark, in the theme's tile: the white tile in light, the dark one in dark. Both
 * images are `npm run icons` output from the one source (`electron/assets/app-icon-source.png`).
 * The swap is the `dark` class on <html> and nothing else, so the logo follows the theme on the
 * same frame every token does and needs no provider — the auth screens draw it too.
 *
 * Two sibling images rather than a wrapper: a caller may style its glyph as a direct child
 * (the switcher FAB's `.vv-fab__glyph > img`).
 */
export function AppLogo({ size, className = '', style, alt = '' }: AppLogoProps) {
  // `public/` for the default accent, `public/accent/<name>/` under a box's palette. The attribute is
  // the one vite-plugins/accentPalette.js puts on <html>, and only for a palette that exists.
  const accent = document.documentElement.dataset.accent;
  const logoDirectory = accent ? `/accent/${accent}` : '';

  return (
    <>
      <img src={`${logoDirectory}/logo-${size}.png`} alt={alt} aria-hidden={alt ? undefined : true} className={`${className} dark:hidden`} style={style} />
      <img src={`${logoDirectory}/logo-dark-${size}.png`} alt={alt} aria-hidden={alt ? undefined : true} className={`${className} hidden dark:block`} style={style} />
    </>
  );
}
