# Verve Design System

**Verve** ("design that feels alive") is the design system for **Servpro** web apps — specifically **eis-app**, the operator console for a property-restoration business (water/fire/mold damage). One "job" = one damaged building; the operator juggles ~40 live jobs, an insurance carrier who pays, and field technicians. The app's job is to make every job's state legible at a glance and to be honest about what software did automatically vs. what the human still must do.

Tagline pair: Instrument Serif + Schibsted Grotesk · accent #2fa876 · v1.

## CONTENT FUNDAMENTALS
- **Plain English, always.** No internal token, code, or ID ever reaches the screen as a label. Rung names like `auto_with_undo` map to sentences: "Drafts are prepared automatically — you can undo."
- **Honest, calm, first-person-to-you.** Copy addresses the operator as "you" ("You review and confirm each line"), the software speaks about itself in passive/plain voice. Understating automation is always safe; overstating never is.
- **"We don't know" never looks like "zero".** A missing reading is a bare em-dash `—` (no % sign), never `0%`. Blank means unknown.
- **Only positive evidence renders.** Nothing is inferred from absence.
- **Sentence case everywhere**; UPPERCASE only for 12px tracking-.14em eyebrows/metadata ("ALSO ON FILE · 3").
- **Middot `·` joins facts**: `Day 1 · 82%`, `Crawford & Co · Note #14`, `12 tasks · updated today`.
- **Microcopy teaches**: helper lines explain consequences ("Shown to the carrier on every export", "Leave blank if not measured — blank means unknown, never zero").
- **Empty states**: one italic-serif line ("Nothing here yet"), one quiet sentence, one clear action. Fallbacks are neutral grey, never amber/red ("This note has no message text" is information, not an error).
- **No emoji** in product copy. A few unicode glyphs serve as functional marks (✓ ✕ ▲ ▼ ● ↳ ✦ —).
- Serif italic accent word in headings: "New *reading*", "Good morning, *you*".

## VISUAL FOUNDATIONS
- **Color**: cool-neutral grays (#f7f7f9 canvas → #17181d ink) with ONE green accent #2fa876 used sparingly — actions and focus only. Orange #e0713a is a garnish, never a wall. Full dark mode via `body.vv-dark`.
- **Five tones** (neutral / info / positive / warn / danger), one recipe: soft fill + deep ink. **Errors are amber; red is reserved for destructive or denied.** Warn is the most common tone so it stays calm. Color never carries a signal alone — always a mark/word too.
- **Type**: Instrument Serif for display + headings, italic for emphasis, **never bold**. Schibsted Grotesk 400/500/700 for everything else. Body 15.5px/1.65. Captions 12px uppercase .14em. Tabular numerals wherever numbers stack.
- **Spacing**: 4px grid, airy — 8 inside controls, 16 related, 24 card padding, 40 groups, 96 page sections.
- **Corners**: 8–10px controls, 12px cards, 16px screens/sheets, pills 999px.
- **Borders**: hairline 1px `--border` on cards; 1.5px `--border-strong` on inputs/outline buttons; dashed borders mean empty/incomplete/unknown.
- **Shadows are whispers**: rest → hover → overlay → modal (see `tokens/spacing.css`). Hover = lift −4/−5px + shadow bloom.
- **Motion is the signature**: springs, not tweens. Entries `cubic-bezier(.22,1,.36,1)`, press overshoot `(.3,2.4,.5,1)` (scale 1.06 hover / .92 press), knob spring `(.34,1.8,.5,1)`. Toasts dissolve upward into "smoke" (blur+rise). Count-ups ease out over 1.4s. Heroes get drifting blurred color orbs.
- **Backgrounds**: flat canvas; no photography, no textures, no gradients except (a) radial orb glows in heroes, (b) accent→light-accent progress fills, (c) avatar gradients.
- **Hover states**: border→accent on outline controls; background darkens one step on soft fills; rows translateX(3px) or lift; press scales down .92–.94.
- **Overlays**: modal backdrop rgba(16,17,22,.45)+blur(6px), scale-in from 96%; sheets slide from right over content; draggable panels dim without blur.
- **Transparency/blur** only in overlay backdrops and toast dismissal.
- **Imagery**: none in-product; broken images fall back to neutral tiles, never a broken glyph.
- **Focus**: every control gets the same ring — 2px accent outline, 2px offset.

## ICONOGRAPHY
- **No icon font and no SVG icon set** exist in the source. The system deliberately uses **unicode glyphs as functional marks**: ✓ done, ✕ close, ▲ warn mark, ▼/◀/▶ disclosure/nav, ● current, ↳ replies, ✦ trust, + add, ≔ list, — absent/unknown.
- Domain graphics (drying gauge water, fan, sparklines, flame) are bespoke inline SVG/CSS, not icons.
- If a richer glyph set is ever needed, Lucide (1.5px stroke) is the nearest CDN match — **not currently used; flag before adopting**.

## Components (window.Verve)
`components/core/` Button · Chip · Badge · Avatar · Card · Spinner · Skeleton · EmptyState
`components/forms/` Field · Input · TextArea · Select · Switch · Checkbox · Radio · Slider
`components/navigation/` Tabs · Stepper · Pagination
`components/overlays/` Modal · Sheet · Toast · Tooltip · Menu · Banner
`components/data/` DataTable · DatePicker · Sparkline
`components/messaging/` Thread · Composer
`components/domain/` DryingGauge · DryingTrend · StatusFlow · Timeline · TrustPosture · TrustSettings

## Domain rules (binding)
1. Errors are amber; red only for destructive or denied.
2. Color is never the whole signal — always a mark, glyph, or word.
3. "We don't know" must never look like "zero" (bare `—`, no water, no % sign).
4. Only positive evidence renders.
5. Plain English labels only.
6. Locked/capped automation renders muted neutral — a settled decision, not a warning.
7. Conservative folding: a panel covering several automation rungs displays the most manual one.

## Caveats
- Both webfonts load from Google Fonts (they are Google fonts; no binaries were provided).
- Light-mode values for the info/warn tone tokens were derived from the dark values and tone recipe in the specimen.
