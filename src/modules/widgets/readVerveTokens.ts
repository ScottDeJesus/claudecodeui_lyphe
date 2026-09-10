/**
 * The Verve design tokens a widget's document is allowed to see, and the live read of them.
 *
 * A widget renders inside a sandboxed frame with an opaque origin, so it cannot reach into the
 * parent's stylesheets to resolve `var(--canvas)` for itself — nothing of the host's CSS crosses
 * that boundary. The tokens are therefore COPIED IN as values: this list of names is the
 * contract, and `readVerveTokens` reads what those names currently resolve to on the real
 * document, so a widget is always dressed in the theme the page is actually wearing.
 *
 * Every name below is declared in `src/shared/ui/verve/tokens.css`. The list is deliberately the
 * whole vocabulary rather than the handful a given widget happens to use: it is also the payload
 * of the `theme` message the host re-posts on a theme flip, so trimming it here would silently
 * narrow what a widget can restyle itself with later.
 */
export const WIDGET_TOKEN_NAMES: readonly string[] = [
  // surfaces, ink and rules
  '--canvas', '--surface', '--surface2',
  '--ink', '--ink-mid', '--ink-muted', '--ink-faint',
  '--border', '--border-strong',
  // accent — one green, actions and focus only
  '--accent', '--accent-deep', '--accent-ink', '--accent-soft', '--on-accent',
  // the five tones, each a soft fill plus a deep ink
  '--neutral-soft', '--neutral-ink',
  '--info-soft', '--info-ink',
  '--pos-soft', '--pos-ink',
  '--warn-soft', '--warn-ink',
  '--danger-soft', '--danger-ink', '--danger',
  // type
  '--font-display', '--font-body', '--font-mono',
  '--text-body', '--text-small', '--text-caption',
  // shape and space
  '--radius-control', '--radius-card', '--radius-pill',
  '--space-1', '--space-2', '--space-3', '--space-4',
];

/**
 * Resolves every widget token against the live document element.
 *
 * A name that resolves to nothing is omitted rather than copied as an empty string, so a widget
 * that falls back with `var(--foo, somedefault)` gets its default instead of an empty value that
 * would win and paint nothing.
 */
export function readVerveTokens(): Record<string, string> {
  const computed = getComputedStyle(document.documentElement);
  const tokens: Record<string, string> = {};

  for (const name of WIDGET_TOKEN_NAMES) {
    const value = computed.getPropertyValue(name).trim();
    if (value) {
      tokens[name] = value;
    }
  }

  return tokens;
}
