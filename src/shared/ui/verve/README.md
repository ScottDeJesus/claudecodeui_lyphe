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
   palette, and two palettes drift inside a single phase.

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

   A module carries its own stylesheet only where a selector must reach markup no className can: a
   scope class's descendants, `:has()`, `::marker`. It still spells Tailwind names through `@apply`,
   the transcript's named `md-body`, `md-meta`, `md-code` and `md-stat` sizes included, and there are
   two today, side by side under `src/modules/chat/transcript/`: `markdownCards.css`
   ([08-rendered-shapes.md](../../../../docs/architecture/08-rendered-shapes.md) §"Element cards")
   and `shapes/shapeMotion.css` (its §"Header, type and motion").

4. **Tone is a token swap, not a rule.** Put `data-tone="neutral|info|positive|warn|danger"`
   (the `Tone` type in `src/shared/types.ts`) on a container and the five `[data-tone]` rules
   hand `--tone-soft`, `--tone-ink`, `--tone-dot` and `--tone-glyph` to everything inside it by
   inheritance. No component writes a tone rule of its own, and the set never grows — two
   spellings for one state is what the swap exists to prevent. `warn` covers errors; red is
   kept for destructive or denied. `Badge` is the first consumer: its `tone` prop lands as
   `data-tone` on the badge, and `.vv-badge` reads `--tone-soft` / `--tone-ink` from there.

   The marker vocabulary is not only tone. `data-vv-enter` on a container is the ENTRANCE marker — a
   container carrying it plays its entrance — and the library reads it in one place: `tokens.css`'s
   `[data-vv-enter] .vv-meter__fill` runs `@keyframes vv-meter-grow`, a `from` frame only, because a
   meter's end state is its inline `transform: scaleX(p)` and a `to` frame with a fill would pin
   every bar at full width. That rule sits inside a `prefers-reduced-motion: no-preference` query, so
   a reader who asked for less motion gets a still meter. The chat sets the marker, on the frames it
   draws and only on a card the reader has not watched arrive
   ([08-rendered-shapes.md](../../../../docs/architecture/08-rendered-shapes.md) §"Header, type and
   motion"); a bare `.vv-meter` under no such marker never animates.

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

7. **A library piece's text size is a custom-property swap too, the same shape as rule 4's tone.**
   `.vv-badge`, `.vv-chip`, `.vv-meter__label`, `.vv-banner` and `.vv-tabs__tab` (both its filled and
   underline registers) spell their `font-size` as `var(--vv-text-meta, <literal>)` or, for `Banner`,
   `var(--vv-text-body, <literal>)`, in `controls.css`/`feedback.css`. Neither property is declared
   here: a rendered shape's frame is the one thing that sets them, on `[data-text-scale="flow"]` in
   `tokens.css`, so a library piece a shape composes inherits the reader's chat text size and the
   same piece built bare — outside any frame — falls back to the literal it always had. The frame
   side of the swap, and the five named sizes it stands beside, is
   [08-rendered-shapes.md](../../../../docs/architecture/08-rendered-shapes.md) §"Header, type and motion".

## The library those tokens paint

Twenty-three components carry Verve paint today — Phase 2's twelve, then Phase 3's six new and
three restyled, then DockableFab and SplitPane for the application switcher's kit scaffold,
admitted on the barrel's *mechanism* test rather than its two-module rule (`index.ts`'s own
header). What they share is the contract every later one joins:

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
4. **Import from the barrel, `@/shared/ui`.** It side-effect-imports all four stylesheets (rule
   6), so the barrel — not the component file — is what puts the paint in the document. A deep
   import by path gets an unpainted component unless something else loaded the barrel first.
5. **Props come from a site you can point at** — the integration plan's §4 table
   (`~/.claude/plans/cloudcli-verve-integration.md`), or a real call. A prop nobody passes is a
   prop nobody proves: `Card`'s `interactive` has no consumer today.
6. **`controls.css` is 440 lines — past its stated ceiling — and `feedback.css` 386, at its.**
   Phase 3's paint went into `feedback.css` beside `controls.css`; the board's paint went into a
   THIRD file, `board.css` — the `.vv-lane`, `.vv-lane__head` and `.vv-lane-card` rules and their
   variants; and the application switcher's kit scaffold opened a FOURTH,
   [`surfaces.css`](surfaces.css) — DockableFab's and SplitPane's own paint, plus the
   `body.vv-dragging` / `vv-drag-fab` / `vv-drag-split` classes a drag of either sets for its
   length (why a new file rather than a squeeze is that stylesheet's own header). Each is imported
   from the barrel exactly as the ones before it, and the order is load-bearing at both ends:
   `surfaces.css` shares no selector with its neighbours, so it only has to land before
   `board.css`, which stays LAST because a lane card composes `.vv-card`'s ground and overrides
   its background, shadow and transition, and at equal specificity the LATER rule wins, so imported
   any earlier `board.css` would lose all three to `.vv-card`. A stylesheet at its ceiling opens a new file rather than winning lines back by
   squeezing what's there; the next one will too.

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
- **`Dialog` owns Escape, unless a panel that CLAIMS it is up in front.** The dialog listens on
  `window` capture and stops the key there, so no `document` handler below acts on a keystroke that
  closed a panel. The exception is a panel drawn over it — inside it, or after it in document order
  — that carries `data-owns-escape` (`overlayEscape.ts`): the dialog stands down and marks the key
  rather than stopping it, so that panel's own Escape closes it, and the next press closes the
  dialog. The claim is stated by the panel's producer, not read off a role, because a role is
  shared: cmdk's list carries `role="listbox"` as static content of the dialog it sits in, and a
  role-keyed rule left the command palette unable to be dismissed from the keyboard.

  **Five panels carry the marker today**: `ActionMenu`, `Menu`, `Select`, the file tree's
  `FileContextMenu` and the composer's `ComposerMenuPrimitives`. Each is rendered SOLELY while it
  is open, which is what lets the marker's mere presence in the document stand for the fact
  itself — a panel that stayed mounted closed could not honestly carry it.

  **The failure direction is silent, not broken.** A new overlay that closes itself on Escape but
  forgets `OWNS_ESCAPE` (`overlayEscape.ts`) is invisible to `overlayInFrontHoldsEscape`, so the
  dialog beneath it never stands down: the FIRST Escape closes the dialog — and, being in front of
  it, the forgetful overlay along with it — instead of just the overlay on its own press. That is
  the OLD behaviour the marker exists to replace, not a crash, which is exactly why it shipped
  once: the application switcher's drawer is a `Dialog` and its rows' kebabs are a portalled
  `ActionMenu` in front of it, and before `ActionMenu` carried the marker, one Escape took the
  sheet and the open kebab together.
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
