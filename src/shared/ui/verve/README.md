# The Verve theme layer

`tokens.css` is this app's one source of colour, type, spacing and motion. What the UI paints
comes from a custom property declared there — light in `:root`, dark under `.dark` — so a
colour change is one line in one file and both modes move together. Where the tokens came from,
and the four deliberate edits made to them, is in that file's own header.

A few hard-coded colours still survive in screens the theme layer has not reached, mostly in
Settings. They are counted, not ignored: the harness holds their number as a ceiling, so a new
one fails the run. Clearing an old one as you pass is welcome; the count only goes down.

The design language the tokens serve is written down at `~/.claude/design/DESIGN_DOCTRINE.md`.
That is the law; this note only says how the law is wired into this repo.

## The rules that keep it one source

1. **Import order is load-bearing.** `src/main.tsx` imports `tokens.css` *before* `index.css`,
   because `@tailwind base` and every utility mapped onto a token have to resolve against
   properties that already exist. Swapping the two lines is not a style preference.

2. **Never declare a colour token twice.** `--accent`, `--canvas`, `--ink`, `--border` and
   their siblings are declared in `tokens.css` and nowhere else. `index.css` may *derive* — its
   `--nav-*` values are `color-mix()` over a Verve token — but a second declaration is a second
   palette, and two palettes drift inside a single phase. One repeat is allowed and it is not a
   screen: `public/logo.svg` is served from `/public` with no stylesheet to read a property from,
   so it carries the accent's hex and names the token it copied in a comment beside it. One
   asset, the token named next to the value, moved only when that token moves.

3. **Colour reaches a screen through Tailwind, never as a literal.** `tailwind.config.js`
   maps every colour name (`bg-primary`, `text-muted-foreground`, `border-border`, …) to
   `color-mix(in srgb, var(--token) calc(<alpha-value> * 100%), transparent)`. The `color-mix`
   is what carries the alpha modifier (`bg-primary/10`) through a custom property — a bare
   `var(--accent)` cannot. So a screen spells Tailwind names: not hex, not `var(--…)`. A library
   component spells neither — its colour is a `.vv-*` rule, per the section below. Adding a
   *name* is not adding a colour: `ink-faint`, `warn-ink` and `accent-ink` joined the map — the
   first two for the task board, the third for accent TEXT — each one `color-mix` over a token
   `tokens.css` already declared. `accent-ink` is the readable half of a pair, because `primary`
   is the accent FILL: a green WORD is `text-accent-ink`, a green SHAPE is `text-primary`, and
   the wrong way round is how the sidebar's most important label went under AA. A name whose
   `var()` points at no existing token is rule 2's second palette in a Tailwind spelling.

4. **Tone is a token swap, not a rule.** Put `data-tone="neutral|info|positive|warn|danger"`
   (the `Tone` type in `src/shared/types.ts`) on a container and the five `[data-tone]` rules
   hand `--tone-soft`, `--tone-ink`, `--tone-dot` and `--tone-glyph` to everything inside it by
   inheritance. No component writes a tone rule of its own, and the set never grows — two
   spellings for one state is what the swap exists to prevent. `warn` covers errors; red is
   kept for destructive or denied. `Badge` is the first consumer: its `tone` prop lands as
   `data-tone` on the badge, and `.vv-badge` reads `--tone-soft` / `--tone-ink` from there.

5. **Colour animates only across a theme flip.** `body.vv-anim` sets a transition with
   `!important` on every element. `ThemeContext.toggleDarkMode` adds it for 500 ms around the
   switch and takes it back off; left on, it smears every hover, menu and scroll in the app.
   Nothing else adds that class, and no always-on colour transition comes back.

6. **The terminal reads the palette; it never keeps one.** `src/modules/shell/utils/terminalTheme.ts`
   builds xterm's theme from the tokens live on `<html>`, and `useTerminalGround` re-reads them
   after every flip because xterm holds a *copy* of what it was handed; a ground hard-coded there
   is rule 2's second palette. The light ANSI sixteen follow that ground — eight read the token for
   a role Verve names (`--danger-ink`, `--pos-ink`, `--warn-ink`, `--info-ink`, the ink ladder),
   and only the eight Verve has no word for are literals, quarantined in one `INVENTED_LIGHT_ANSI`
   block. The dark sixteen stay as they are, in `useShellTerminal`'s `TERMINAL_OPTIONS`. Which
   measurement forced each choice is in that file's own header — doctrine §7's method, applied.

## The library those tokens paint

Twenty-one components carry Verve paint after Phase 3 — Phase 2's twelve, then six new and
three restyled. What they share is the contract every later one joins:

1. **A component is a flat file in `src/shared/ui/`.** `verve/` holds stylesheets and nothing
   else: no component, no module, no `verve/components/` to grow into.
2. **Paint is a `.vv-*` rule; the component carries layout.** Colour, border, shadow and radius
   live in `controls.css` as `.vv-<name>` / `.vv-<name>--<variant>`; the `className` spells only
   size and flow (`inline-flex`, `h-10 px-4`). A colour utility inside a library file is a second
   paint mechanism, and the harness greps every file it has restyled for one. The ban is on the
   library file, not the call site: a caller's own `className` still wins over `.vv-*`, by design.
3. **Marker classes are surface, not decoration.** `vv-button--<variant>`, `vv-badge--<variant>`
   and `data-tone` are what a verify script queries to prove a variant painted; rename one and a
   gate that never reads your source goes quiet. A variant emitting no marker is unprovable.
4. **Import from the barrel, `@/shared/ui`.** It side-effect-imports `controls.css`, so the
   barrel — not the component file — is what puts the paint in the document. A deep import by
   path gets an unpainted component unless something else loaded the barrel first.
5. **Props come from a site you can point at** — the integration plan's §4 table
   (`~/.claude/plans/cloudcli-verve-integration.md`), or a real call. A prop nobody passes is a
   prop nobody proves: `Card`'s `interactive` has no consumer today.
6. **`controls.css` is full, 296 of its 300 lines.** Phase 3's paint went into `feedback.css`
   beside it, imported from the barrel the same way; the next file opens the same way again.
   Don't win four lines back by squeezing either one.

Which components exist at all, and when a screen composes instead of asking for a new one, is
doctrine §1–§3. Read it there, not here.

## The overlay half

`feedback.css` is the second paint file and holds to those same six rules: Banner, Toast,
Tabs, EmptyState and Menu new, Dialog, Tooltip and ActionMenu restyled.

- **A toast is advisory.** `useToast()` (from `@/shared/context/ToastContext`, not the barrel)
  raises one; it leaves after 3250 ms and has no dismiss control. It may say what happened,
  never be the only record that it did — an outcome the reader must act on is a `Banner`.
- **The stack is the app's topmost surface, and it takes no pointer.** `z-index: 10001` is one
  above the highest z-index measured in `src/`, because later phases raise toasts from inside
  those modals; `pointer-events: none` because the stack's rect sits over the composer and
  swallowed its clicks. A toast that gains an action takes `auto` back on itself then, not before.
- **The keyboard is the contract.** `Tabs` roves a single tab stop with Arrow/Home/End and falls
  back to the first tab when `active` names none, because `role="tablist"` promises it. `Menu`
  closes on Escape and on an outside pointerdown, returns focus to its trigger, and marks its
  chosen row `aria-current` — its rows are menu items, of which one is current.
- **Dialog's motion is a Tailwind keyframe, not `vv-pop`.** `vv-pop` animates `transform`
  outright, which would overwrite the `-translate-*` that centres the panel. The retuned
  `animate-dialog-content-show` is that motion carried onto a centred box.

## Two open design-language questions

Both are measured facts about Verve's own palette, recorded rather than fixed. Changing either
means picking a colour Verve did not, which is the operator's call:

- The accent on the canvas measures **2.81:1** in light, under the 3:1 floor for graphics.
  Verve spends the accent on actions and focus, never on body text.
- `text-destructive` on the canvas measures **3.17:1** in dark, below AA. Verve's `.dark` block
  lightens nearly everything but never redeclares `--danger`, though it does ship
  `--danger-ink` for exactly this ink-on-canvas role.

## What a composed screen looks like

Settings is the first screen assembled out of that library rather than asking for new components,
so copy it: the nav rail is `Chip` (`selected` + `onClick`), `SettingsToggle` is the library
`Switch` behind one settings-shaped prop name so four tabs share a spelling instead of each
growing its own track and knob, and a connected agent says so with `Badge tone="positive"` — a
tone attribute, not a green. The modal is hand-built and still borrows `vv-dialog__backdrop`,
because the paint classes work without the component that usually carries them. Whether a missing
piece becomes a *new* component is doctrine §1–§3; this is the other answer.

Phase 5 composed three more — sidebar, workspace header, sign-in — and left two rules behind.
**A wash is chosen by measuring it, not by reasoning about it.** The selected project row wanted
the prototype's full `--accent-soft` under its name; that pair reads under AA, so the wash — this
app's half, against the ink Verve owns — moved, and a border carries the "chosen" reading the
thinner fill gave up. **A new string is a translated string**: it arrives through `t()`, and a
counted one carries one plural key per category `Intl.PluralRules` gives its language — four for
`ru`, three for `es`/`fr`/`it`, one for `ja`/`ko`/`zh`, never an `_one` in a one-category file.

## Where the rest lives

- Design provenance — the canvas, the prototype, the handoff: [`design/README.md`](../../../../design/README.md)
- How the numbers above are measured, and the baselines a change must not regress:
  [`docs/verification.md`](../../../../docs/verification.md)
