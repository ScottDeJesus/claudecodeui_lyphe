<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-745 — verve

The Verve theme layer: tokens.css as the app's one source of colour, type, spacing and motion — light in :root, dark under .dark — with single declaration and derived values keeping it one source, and a held ceiling on the hard-coded colours left to clear.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/

## MAN-738 — The Verve theme layer
section: README/000

`tokens.css` is this app's one source of colour, type, spacing and motion. What the UI paints
comes from a custom property declared there — light in `:root`, dark under `.dark` — so a
colour change is one line in one file and both modes move together. Where the tokens came from,
and the four deliberate edits made to them, is in that file's own header.

A few hard-coded colours still survive in screens the theme layer has not reached, mostly in
Settings. They are counted, not ignored: the harness holds their number as a ceiling, so a new
one fails the run. Clearing an old one as you pass is welcome; the count only goes down.

This note says how the Verve design language is wired into this repo.

## MAN-739 — The rules that keep it one source
section: README/001 The rules that keep it one source

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
   the wrong way round is how the sidebar's most important label went under AA. `tone-soft`,
   `tone-ink` and `tone-dot` joined as names over the tone swap's own properties, not over a palette
   token: each is `color-mix` over `--tone-soft`, `--tone-ink` or `--tone-dot`, which the
   `[data-tone]` rules of rule 4 hand to everything inside a container. `bg-tone-dot` is the dot of
   whichever of the five tones the nearest `data-tone` chose, and resolves to nothing with none above
   it. `--tone-glyph` has no name: it holds a string, not a colour. A name whose
   `var()` points at no existing token is rule 2's second palette in a Tailwind spelling.

   A module carries its own stylesheet only where a selector must reach markup no className can: a
   scope class's descendants, `:has()`, `::marker`. It still spells Tailwind names through `@apply`,
   the transcript's named `md-body`, `md-meta`, `md-code` and `md-stat` sizes included, and there are
   two today, side by side under `src/modules/chat/transcript/`: `markdownCards.css`
   ([docs/architecture/MANUAL.md (08-rendered-shapes)](../../../../docs/architecture/MANUAL.md) §"Element cards")
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
   ([docs/architecture/MANUAL.md (08-rendered-shapes)](../../../../docs/architecture/MANUAL.md) §"Header, type and
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
   [docs/architecture/MANUAL.md (08-rendered-shapes)](../../../../docs/architecture/MANUAL.md) §"Header, type and motion".

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/main.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/shell/utils/terminalTheme.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/tailwind.config.js

## MAN-740 — The library those tokens paint
section: README/002 The library those tokens paint

32 components carry Verve paint (2026-10-07: a file in `src/shared/ui/` that puts a `.vv-*` class in its markup; a comment naming one does not count, and `Toast` with `ToastStack`, `Tabs` with `TabsMore` count once). The sheet that paints each (rule 6):

| sheet | components |
|---|---|
| `controls.css` | Button, Badge, Input, Card, Shimmer, Chip, Switch, Avatar, Meter, Spinner, Field, Select, Stepper |
| `feedback.css` | Banner, Toast, Tabs, EmptyState, Menu, Dialog, Tooltip, ActionMenu |
| `surfaces.css` | DockableFab, SplitPane, ResizeGrip |
| `panels.css` | TextArea, Sheet, Timeline, Steps, Checkbox, DialogFrame |
| `board.css` | KanbanLane, KanbanCard |

- `Sheet` (a panel on the right edge over a scrim), `Timeline` (an event feed, dense or full; props and open-row rules: MAN-7847) and `Steps` (Verve's navigation stepper) joined for the Cerberus tab: `CheckSheet`, Fleet's "What happened" and History's feed, the Enroll dialog. `TextArea` joined for the roadmap's goal field; the Mute dialog's reason takes it too.
- `Steps`, not `Stepper`: `Stepper` is the house's numeric minus/plus control and has its own consumers, and Verve's bundle gives its navigation component the same name. `Steps` shows where a flow stands: numbered rounds, a ✓ once done, an accent rail between; a step is not pressable.
- `TextArea` wears `Input`'s `.vv-input` paint (`controls.css`) and adds only its geometry in `panels.css`.
- `Checkbox` is Verve's `forms/Checkbox`, in the library because Verve draws it; its first consumer is the Cerberus Update wardens dialog. A real `<input type="checkbox">` hidden with `sr-only`, its box and ✓ painted from the input's own `:checked`, `:disabled` and `:focus-visible` by sibling selectors, so the state has one home. The focus ring is `Input`'s (2px `--accent`, 2px offset) moved onto the box; the rule that silences the hidden input's own ring has three class-level parts because `src/index.css` pins `input[type="checkbox"]:focus` at (0,2,1). Its `className` is size and flow on the `<label>`, the press target, never paint: the dialog's rows pass `py-3`, so a whole row is one 44 px target.
- `DialogFrame` is Verve's `overlays/Modal` on the house `Dialog`, in the library because Verve draws it (MAN-571): its props, behaviour and paint are MAN-7963.
- `DockableFab`, `SplitPane` and `ResizeGrip` were admitted on the barrel's *mechanism* test, not its two-module rule (`index.ts`'s own header). `ResizeGrip`'s one consumer is `ChatHostPanel`.
- `ConfirmDialog` was admitted on the two-module rule and paints nothing of its own: it is `Dialog` and `Button`, both already painted. It is not in the table.

What they share is the contract every later one joins:

1. **A component is a flat file in `src/shared/ui/`.** `verve/` holds stylesheets and nothing
   else: no component, no module, no `verve/components/` to grow into.
2. **Paint is a `.vv-*` rule; the component carries layout.** Colour, border, shadow and radius
   live in the piece's own sheet (rule 6) as `.vv-<name>` / `.vv-<name>--<variant>`; the `className`
   spells only size and flow (`inline-flex`, `h-10 px-4`). A colour utility inside a library file is a
   second paint mechanism, and the harness greps every file it has restyled for one. The ban is on
   the library file, not the call site: a caller's own `className` still wins over `.vv-*`, by
   design — except `TextArea`'s colours (rule 6). `panels.css` holds two departures, each named in its
   header: `.vv-textarea` invents no paint, it is `Input`'s `.vv-input`; and `.vv-timeline__dot`
   carries no colour, because `Timeline`'s dot is `data-tone` + `bg-tone-dot`, the tone swap's own dot,
   so a timeline dot and a status mark drawn the same way elsewhere cannot drift.
3. **Marker classes are surface, not decoration.** `vv-button--<variant>`, `vv-badge--<variant>`
   and `data-tone` are what a verify script queries to prove a variant painted; rename one and a
   gate that never reads your source goes quiet. A variant emitting no marker is unprovable.
4. **Import from the barrel, `@/shared/ui`.** It side-effect-imports all five stylesheets (rule
   6), so the barrel — not the component file — is what puts the paint in the document. A deep
   import by path gets an unpainted component unless something else loaded the barrel first.
5. **Props come from a site you can point at** — the integration plan's §4 table
   (`~/.claude/plans/cloudcli-verve-integration.md`), or a real call. A prop nobody passes is a
   prop nobody proves: `Card`'s `interactive` has no consumer today.
6. **A stylesheet at its ceiling opens a new file; it never wins lines back by squeezing what is
   there.** The barrel imports five sheets, in this order (lines measured 2026-10-07):

   | import | sheet | opened | lines | also holds |
   |---|---|---|---|---|
   | 1 | `controls.css` | 1st | 496 | past its stated ceiling (the headers of `surfaces.css` and `panels.css` say so) |
   | 2 | `feedback.css` | 2nd | 438 | — |
   | 3 | [`surfaces.css`](surfaces.css) | 4th | 367 | the `body.vv-dragging` / `vv-drag-fab` / `vv-drag-split` / `vv-drag-resize` classes a drag of any piece sets for its length (why a new file: that sheet's own header) |
   | 4 | [`panels.css`](panels.css) | 5th | 341 | `.vv-input`'s colours and ground said back over `src/index.css`'s `!important` pins on every bare `textarea` (the piece's own header says why) |
   | 5 | `board.css` | 3rd | 227 | the `.vv-lane`, `.vv-lane__head` and `.vv-lane-card` rules and their variants |

   `panels.css` is the fifth sheet opened and the fourth imported. The order is load-bearing at one end:
   - `board.css` stays LAST. A lane card composes `.vv-card`'s ground and overrides its background,
     shadow and transition, and at equal specificity the LATER rule wins, so imported any earlier
     `board.css` would lose all three to `.vv-card`.
   - `surfaces.css` and `panels.css` share no selector with their neighbours, so they only have to
     land before `board.css`. `panels.css` wins every tie it has by specificity, never by order.
   - A rule in `panels.css` that must beat `index.css`'s pins sits at three class-level parts
     (`.vv-input.vv-textarea.vv-textarea`); a new one needs the same height. A caller's `text-*` class
     loses to a TextArea's colours; only its ground defers to `bg-transparent`.

Which components exist at all, and when a screen composes instead of asking for a new one, is
doctrine §1–§3. Read it there, not here.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Checkbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/DialogFrame.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Sheet.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Steps.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/TextArea.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Timeline.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/panels.css

## MAN-741 — The overlay half
section: README/003 The overlay half

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

  **Six panels carry the marker in the library and the menus**: `ActionMenu`, `Menu`, `Select`,
  `Sheet`, the file tree's `FileContextMenu` and the composer's `ComposerMenuPrimitives`. The
  Lightbox, the fullscreen frames (`ShapeFrame`, `GutterWidgetFrame`), the application switcher's
  radial, rows and picker, the session picker popover and the check label editor claim it the same
  way. Each is rendered SOLELY while it is open, which is what lets the marker's mere presence in the
  document stand for the fact itself — a panel that stayed mounted closed could not honestly carry it.

  **`Sheet` also asks `modalInFrontHoldsEscape`** (`overlayEscape.ts`), the same question with a modal
  dialog (`[role="dialog"][aria-modal="true"]`) among the candidates. A `Dialog` carries no marker, since
  it is the thing that takes the key, so the marker rule alone leaves a sheet blind to the dialog its own
  button opens in front of it; and as both listen on `window` in the capture phase, where
  `stopPropagation` does not keep the second listener from running, one press would close the dialog
  AND the sheet. A dialog drawn BEHIND the sheet is no candidate (document order): the key is the
  sheet's. `Dialog` asks `overlayInFrontHoldsEscape`, markers only.

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

## MAN-742 — Three open design-language questions
section: README/004 Three open design-language questions

All three are measured facts about Verve's own palette, recorded rather than fixed. Changing any of
them means picking a colour Verve did not, which is the operator's call:

- The accent on the canvas measures **2.81:1** in light, under the 3:1 floor for graphics.
  Verve spends the accent on actions and focus, never on body text.
- `text-destructive` on the canvas measures **3.17:1** in dark, below AA. Verve's `.dark` block
  lightens nearly everything but never redeclares `--danger`, though it does ship
  `--danger-ink` for exactly this ink-on-canvas role.
- An unticked `Checkbox`'s edge, `--border-strong` on `--surface`, measures **1.41:1** in light and
  **1.57:1** in dark, under the 3:1 a control's outline needs (WCAG 1.4.11). It is Verve's own
  `forms/Checkbox` draw, a 1.5px `--border-strong` edge (`_ds_bundle.js` :1570). Its first screen,
  the Cerberus Update wardens dialog, opens with every box it offers ticked, so an empty box there
  is one the operator emptied.

## MAN-743 — What a composed screen looks like
section: README/005 What a composed screen looks like

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

## MAN-744 — Where the rest lives
section: README/006 Where the rest lives

- How the numbers above are measured, and the baselines a change must not regress:
  [`docs/MANUAL.md (verification)`](../../../../docs/MANUAL.md)

## MAN-7963 — `DialogFrame` — Verve's `overlays/Modal` on the house `Dialog`: two widths, the accent, the ✕ last in focus order, `busy`

`src/shared/ui/DialogFrame.tsx` is Verve's `overlays/Modal` composed on the house `Dialog` (MAN-741). It is in the library because Verve draws it (MAN-571); a screen composes it and never builds a frame of its own (MAN-575). Consumers: the Cerberus tab's Mute, Enroll, Promote and Update wardens dialogs (MAN-7884).

## Props
| prop | meaning |
|---|---|
| `size` | `md` = 520 px, `lg` = 600 px; never wider than the screen less 2 rem; the panel scrolls as a whole (`max-h-[calc(100dvh-2rem)]`) |
| `title` | the serif heading's first words |
| `accent?` | `{ words }`: italic, in the accent ink. `{ key }`: a raw key, mono, upright, `0.62em`. Omitted: the title stands alone |
| `busy?` | a write is out: the ✕ is `disabled` (dimmed, takes no press); the dialog's own buttons are the caller's |
| `onDismiss` | Escape, the backdrop and the ✕ all call it; the caller decides whether that closes the dialog |
| `children` | the body |
| `...rest` | any `data-*` and any `aria-*` but `aria-labelledby` (the title's id is the frame's own) land on the panel; the Cerberus dialogs pass `data-cerberus-dialog="mute" \| "enroll" \| "promote" \| "update"` |

## Behaviour
- Mounted only while its dialog is open (`<Dialog open>`): it opens clean every time, and the house `Dialog`'s Escape, backdrop, focus trap and first focus hold (MAN-741).
- The ✕ is LAST in panel order though drawn first (absolute, top right). why: first focus lands on the dialog's first field or chip, not on the way out, and Escape still closes from anywhere.
- The ✕ is the round close, `aria-label` `buttons.close`: 32 px at a desk, 44 px below md (Verve's touch minimum).

## Paint — `verve/panels.css`
| class | holds |
|---|---|
| `.vv-dialogframe` | padding `clamp(20px,5vw,30px)` by `var(--vv-dialogframe-gutter)`; the gutter is `clamp(18px,5vw,32px)` |
| `.vv-dialogframe__title` | `var(--font-display)` 28 px (25 px below 640 px); `overflow-wrap: anywhere`, so a long key wraps instead of widening the title under the ✕ |
| `.vv-dialogframe__accent`, `__key` | the italic accent ink; the mono key in the accent ink |
| `.vv-dialogframe__close` | a 32 px circle on `--surface2`; below md 44 px, its top and right offsets 6 px smaller about its own centre so it stays where it was |

- The ✕'s phone-size offsets are computed from the frame's padding and gutter: change them together.
- The panel's width and scroll are layout, spelled in the component; the paint is the `.vv-dialogframe*` rules (MAN-740).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/DialogFrame.tsx
