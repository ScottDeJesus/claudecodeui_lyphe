/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['"Schibsted Grotesk"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        serif: ['"Instrument Serif"', 'Georgia', 'serif'],
      },
      // The rendered-transcript text scale: four named sizes plus the tool anchor. Every one is
      // `em`, so a framed shape follows the chat text size the reader set and never a fixed px.
      // A header is never smaller than what it heads — `md-body` is the size of all content AND of
      // every title — and `md-stat` is the stat tile's figure and nothing else. `chat-tool` is the
      // base size of a markdown tool body, 7/8 of the chat setting.
      fontSize: {
        'md-body': '1em',
        'md-meta': '0.875em',
        'md-code': '0.875em',
        'md-stat': '1.75em',
        'chat-tool': 'calc(var(--chat-font-size, 1rem) * 0.875)',
      },
      // Tailwind's colour names are kept — 665 utility sites already spell them — but every
      // one now resolves to a Verve token from src/shared/ui/verve/tokens.css, which is the
      // app's ONE colour source. color-mix carries the alpha modifier through: Tailwind
      // substitutes `<alpha-value>` textually (1 for `bg-primary`, 0.1 for `bg-primary/10`),
      // which a bare `var(--accent)` could not do.
      colors: {
        border: "color-mix(in srgb, var(--border) calc(<alpha-value> * 100%), transparent)",
        input: "color-mix(in srgb, var(--border-strong) calc(<alpha-value> * 100%), transparent)",
        ring: "color-mix(in srgb, var(--accent) calc(<alpha-value> * 100%), transparent)",
        background: "color-mix(in srgb, var(--canvas) calc(<alpha-value> * 100%), transparent)",
        foreground: "color-mix(in srgb, var(--ink) calc(<alpha-value> * 100%), transparent)",
        primary: {
          DEFAULT: "color-mix(in srgb, var(--accent) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--on-accent) calc(<alpha-value> * 100%), transparent)",
        },
        secondary: {
          DEFAULT: "color-mix(in srgb, var(--surface2) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--ink-mid) calc(<alpha-value> * 100%), transparent)",
        },
        destructive: {
          DEFAULT: "color-mix(in srgb, var(--danger) calc(<alpha-value> * 100%), transparent)",
          // NOT --on-accent: --danger does not flip in dark but --on-accent does, which put
          // near-black ink on a mid-red fill at 3.17:1. See tokens.css's header note 3.
          foreground: "color-mix(in srgb, var(--on-danger) calc(<alpha-value> * 100%), transparent)",
        },
        muted: {
          DEFAULT: "color-mix(in srgb, var(--surface2) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--ink-muted) calc(<alpha-value> * 100%), transparent)",
        },
        accent: {
          DEFAULT: "color-mix(in srgb, var(--surface2) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--ink-mid) calc(<alpha-value> * 100%), transparent)",
        },
        popover: {
          DEFAULT: "color-mix(in srgb, var(--surface) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--ink) calc(<alpha-value> * 100%), transparent)",
        },
        card: {
          DEFAULT: "color-mix(in srgb, var(--surface) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--ink) calc(<alpha-value> * 100%), transparent)",
        },
        // Three inks tokens.css already declares that no Tailwind name reached. The shadcn
        // vocabulary above has no word for any of them, and screen work is what needed them:
        // Phase 16's ladder of task priorities and terminal footer note, and Phase 5's accent
        // TEXT. Named after the token so a call site says which ink it means, and colour-mixed
        // like every name above so the alpha modifier still carries. No new colour: all three
        // are tokens.css's.
        //
        // `accent-ink` exists because `primary` is the accent FILL and reads at 2.55:1 as text.
        // A green word is `text-accent-ink`; a green shape is `text-primary`. Getting that pair
        // the wrong way round is how the sidebar's most important label went under AA.
        //
        // `accent-soft` and its hover are the soft green ground a lit control stands on — the views
        // rail's lit glyph, `text-accent-ink` on `bg-accent-soft`. They need names of their own
        // because `accent` above is the shadcn legacy, mapped to `--surface2`.
        "ink-faint": "color-mix(in srgb, var(--ink-faint) calc(<alpha-value> * 100%), transparent)",
        "warn-ink": "color-mix(in srgb, var(--warn-ink) calc(<alpha-value> * 100%), transparent)",
        "accent-ink": "color-mix(in srgb, var(--accent-ink) calc(<alpha-value> * 100%), transparent)",
        "accent-soft": "color-mix(in srgb, var(--accent-soft) calc(<alpha-value> * 100%), transparent)",
        "accent-soft-hover": "color-mix(in srgb, var(--accent-soft-hover) calc(<alpha-value> * 100%), transparent)",
        // The tone swap's own properties (tokens.css, the `[data-tone]` rules), named. A container
        // that sets `data-tone` hands `--tone-soft`, `--tone-ink` and `--tone-dot` to everything inside
        // it, and these three let that content spell them as Tailwind names: a status mark is
        // `<span data-tone="warn" className="bg-tone-dot">`, its wash `bg-tone-soft`, its word
        // `text-tone-ink`. They are not a sixth palette — they carry whichever of the five tones the
        // nearest `data-tone` chose, and with none above them they resolve to nothing.
        "tone-soft": "color-mix(in srgb, var(--tone-soft) calc(<alpha-value> * 100%), transparent)",
        "tone-ink": "color-mix(in srgb, var(--tone-ink) calc(<alpha-value> * 100%), transparent)",
        "tone-dot": "color-mix(in srgb, var(--tone-dot) calc(<alpha-value> * 100%), transparent)",
      },
      borderRadius: {
        lg: "var(--radius-input)",
        md: "calc(var(--radius-input) - 2px)",
        sm: "calc(var(--radius-input) - 4px)",
      },
      // Verve's elevation ladder (tokens.css's `--shadow-*`), named so a screen spells a rung — `shadow-lift`
      // — and never `var(--shadow-lift)`. Names over tokens tokens.css already declares, as the colours above
      // are: no new shadow. Rest, hover, lift (an object standing over the page: the floating panels),
      // overlay (menus and popovers), modal.
      boxShadow: {
        rest: "var(--shadow-rest)",
        hover: "var(--shadow-hover)",
        lift: "var(--shadow-lift)",
        overlay: "var(--shadow-overlay)",
        modal: "var(--shadow-modal)",
      },
      // Named so a call site spells the intent, not the curve: `ease-spring`, `duration-move`.
      transitionTimingFunction: {
        enter: 'var(--ease-enter)',
        spring: 'var(--ease-spring)',
        press: 'var(--ease-press)',
      },
      transitionDuration: {
        quick: '200ms',
        move: '350ms',
      },
      spacing: {
        'safe-area-inset-bottom': 'env(safe-area-inset-bottom)',
        'mobile-nav': 'var(--mobile-nav-total)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'dialog-overlay-show': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        // The centred-box spelling of Verve's `vv-pop`: the same 96% scale-in and the same
        // small rise, with the dialog's own centring translate folded in — vv-pop animates
        // `transform` outright and would throw a centred panel into the corner.
        'dialog-content-show': {
          from: { opacity: '0', transform: 'translate(-50%, -48%) scale(0.96)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
        'bottom-sheet-content-show': {
          from: { opacity: '0', transform: 'translateY(100%)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // A sheet pinned to the LEFT edge arriving: a short slide in from the edge it hangs on, not a
        // full-width sweep — the applications drawer's entrance.
        'sheet-in-left': {
          from: { opacity: '0', transform: 'translateX(-22px)' },
          to: { opacity: '1', transform: 'none' },
        },
        // The roadmap's two motions Verve has no keyframe for. Verve's own (`vv-pop`, `vv-draw`) carry
        // the other two below; none of the four animates a colour, and each is spelled behind
        // `motion-safe:` at its call site.
        //
        // A celebration particle leaving the point it was born at. Where it lands is that element's own
        // `--dx`/`--dy`, set inline — position data, never colour — so one keyframe serves the
        // milestone banner's 48 particles and the epic ring's 12.
        'roadmap-burst': {
          from: { transform: 'none', opacity: '1' },
          to: { transform: 'translate(var(--dx), var(--dy)) scale(.4)', opacity: '0' },
        },
        // A ring or a feature's dot swelling past its size and settling a little over it. The
        // peak sits early so the settle has most of the run, under `--ease-spring`'s own overshoot.
        'roadmap-bloom': {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.6)' },
          '100%': { transform: 'scale(1.1)' },
        },
        // The Cerberus tab's six motions, ported from its prototype (`cb-*` in `Cerberus Tab.dc.html`).
        // Colour in them is `--warn-dot` through `color-mix` and nothing else: the ring is that dot's
        // halo, and the rest move or fade an element that keeps its own ink.
        //
        // A status mark that needs you: a halo of the warn dot going out 8px as it fades.
        'cerberus-ring-warn': {
          '0%': { boxShadow: '0 0 0 0 color-mix(in srgb, var(--warn-dot) 50%, transparent)' },
          '100%': { boxShadow: '0 0 0 8px color-mix(in srgb, var(--warn-dot) 0%, transparent)' },
        },
        // A heartbeat dot while its warden is reporting: opacity 1 down to .5 and back.
        'cerberus-breathe': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '.5' },
        },
        // A beat riding a spoke from its node to the hub. It starts at the node's end (`left: 100%`),
        // fades in over the first 12% and out over the last 15%, so it never pops at either end.
        'cerberus-travel': {
          '0%': { left: '100%', opacity: '0' },
          '12%': { opacity: '1' },
          '85%': { opacity: '1' },
          '100%': { left: '0', opacity: '0' },
        },
        // A ✓ arriving: it grows from .4 to full while it fades in.
        'cerberus-check': {
          '0%': { opacity: '0', transform: 'scale(.4)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        // A line of output arriving: a short rise from 5px below.
        'cerberus-line': {
          from: { opacity: '0', transform: 'translateY(5px)' },
          to: { opacity: '1', transform: 'none' },
        },
        // A terminal caret: on for the first half of the second, off for the second, no tween.
        'cerberus-caret': {
          '0%, 49%': { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
      },
      animation: {
        shimmer: 'shimmer 2s linear infinite',
        // Verve's timings, not Tailwind's default tween: the scrim fades on `vv-fade .25s` and
        // the panel arrives on `vv-pop .45s var(--ease-enter)`.
        'dialog-overlay-show': 'dialog-overlay-show 250ms var(--ease-enter)',
        'dialog-content-show': 'dialog-content-show 450ms var(--ease-enter)',
        'bottom-sheet-content-show': 'bottom-sheet-content-show 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        'sheet-in-left': 'sheet-in-left 340ms var(--ease-enter)',
        // The rendered transcript's entrances, both on Verve's own keyframes (`vv-rise` and
        // `vv-pagein`, `src/shared/ui/verve/tokens.css`) rather than on a second spelling of them
        // here. `shape-rise` is a FRAME arriving — a card the reader has never seen rises once, and
        // `both` keeps it at its end state while the memory that suppressed it is consulted. It is
        // named for the transcript, its first wearer, but it is the house's one spelling of Verve's
        // rise: any screen's arriving block wears it, never a second `vv-rise` utility. A stagger's
        // delay goes inline (`style={{ animationDelay }}`): a `[animation-delay:…]` class is emitted
        // before the `motion-safe:` media block, whose shorthand then resets the delay to 0.
        // `shape-item` is a row or a tile following its frame, `backwards` so the stagger's delay
        // holds the item invisible instead of flashing it at full opacity before its turn.
        'shape-rise': 'vv-rise var(--dur-move) var(--ease-enter) both',
        'shape-item': 'vv-pagein 240ms var(--ease-enter) backwards',
        // The dispatcher cards' live ring, on Verve's own `vv-ring` — the halo its StatusFlow puts
        // round the stage in hand (`_ds_bundle.js`, `vv-ring 2.4s ease-out infinite`). It is that
        // halo on a node whose walk is out right now, breathing for as long as it is. An arc deck's
        // plans are paged, not jumped to, so the one-shot flavour the tab's wall used is gone.
        'live-ring': 'vv-ring 2.4s ease-out infinite',
        // The Cerberus tab's motions, the keyframes above, at the prototype's timings. `both` on the
        // two one-shots keeps the first frame (invisible) through any delay and the last (settled) after.
        'cerberus-ring-warn': 'cerberus-ring-warn 1.8s ease-out infinite',
        'cerberus-breathe': 'cerberus-breathe 2.6s ease-in-out infinite',
        'cerberus-travel': 'cerberus-travel 3.2s linear infinite',
        'cerberus-check': 'cerberus-check .6s var(--ease-spring) both',
        'cerberus-line': 'cerberus-line .35s var(--ease-enter) both',
        'cerberus-caret': 'cerberus-caret 1s steps(1) infinite',
        // The roadmap's celebrations. Two run Verve's own keyframes (`vv-pop`, `vv-draw` in
        // `src/shared/ui/verve/tokens.css`), because Verve draws that motion; the other two run the
        // keyframes above.
        // A mark arriving: the milestone banner's badge. `vv-pop` on the spring curve.
        'roadmap-pop': 'vv-pop 420ms var(--ease-spring)',
        // An SVG stroke drawing itself: a milestone's connector from the goal, and the last share of a
        // ring. The stroke needs `pathLength="1"` AND `[stroke-dasharray:1]`: `vv-draw` moves only
        // `stroke-dashoffset` (1 → 0), so without the dash the stroke is solid at every frame and nothing
        // draws. It does nothing to a div's background. `forwards` keeps the line drawn when it ends.
        'roadmap-draw': 'vv-draw 900ms var(--ease-enter) forwards',
        // A particle's flight, `forwards` so it stays at its last frame, invisible, until its layer
        // is taken down.
        'roadmap-burst': 'roadmap-burst 1.1s ease-out forwards',
        // A ring's or a dot's swell.
        'roadmap-bloom': 'roadmap-bloom 900ms var(--ease-spring)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
