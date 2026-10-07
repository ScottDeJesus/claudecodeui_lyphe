import { cva } from 'class-variance-authority';

/**
 * Every badge in the app, on three axes.
 *
 * `tone` is the new one and the one that matters: `.vv-badge` reads `var(--tone-soft)` /
 * `var(--tone-ink)` and the `[data-tone]` blocks in tokens.css decide what those are, so a
 * sixth badge colour is a token block rather than an edit here (doctrine §5).
 *
 * `kind` is tone's twin for IDENTITY — what a card IS rather than how it stands. `.vv-badge[data-kind]`
 * reads `var(--kind-soft)` / `var(--kind-ink)`, which the `[data-kind]` blocks in tokens.css swap in, and
 * a kind badge carries no `data-tone` at all: a kind is never one of the five tones. It is the caller's
 * to give the badge its glyph and its word (a kind is never colour alone, doctrine §6).
 *
 * `variant` is the legacy one, kept because 24 call sites pass it and three of them depend on
 * looking DIFFERENT from each other in the same panel. Each variant emits a marker class whose
 * paint lives in controls.css beside the rest — never a colour utility, which is the second
 * paint mechanism D2 forbids.
 *
 * `badgeVariants` is exported for the one toned fact that has to be a CONTROL — the dispatcher's
 * `StatusFlow` nodes are buttons, which `as` does not draw — so it wears the badge's paint and
 * `data-tone` rather than a second spelling of them.
 */
export const badgeVariants = cva('vv-badge inline-flex items-center');
