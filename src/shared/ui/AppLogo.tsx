import type { CSSProperties } from 'react';

type AppLogoProps = {
  /** The rendered PNG's pixel size — pick the one at least twice the box it is drawn in. */
  size: 32 | 64 | 128 | 256 | 512;
  className?: string;
  style?: CSSProperties;
  alt?: string;
};

/**
 * The app's own mark, in the theme's tile: the white tile in light, the dark one in dark. Both
 * images are `npm run icons` output from the one source (`electron/assets/app-icon-source.png`).
 * The swap is the `dark` class on <html> and nothing else, so the logo follows the theme on the
 * same frame every token does and needs no provider — the auth screens draw it too.
 *
 * Two sibling images rather than a wrapper: a caller may style its glyph as a direct child
 * (the switcher FAB's `.vv-fab__glyph > img`).
 */
export function AppLogo({ size, className = '', style, alt = '' }: AppLogoProps) {
  return (
    <>
      <img src={`/logo-${size}.png`} alt={alt} aria-hidden={alt ? undefined : true} className={`${className} dark:hidden`} style={style} />
      <img src={`/logo-dark-${size}.png`} alt={alt} aria-hidden={alt ? undefined : true} className={`${className} hidden dark:block`} style={style} />
    </>
  );
}
