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
        "ink-faint": "color-mix(in srgb, var(--ink-faint) calc(<alpha-value> * 100%), transparent)",
        "warn-ink": "color-mix(in srgb, var(--warn-ink) calc(<alpha-value> * 100%), transparent)",
        "accent-ink": "color-mix(in srgb, var(--accent-ink) calc(<alpha-value> * 100%), transparent)",
      },
      borderRadius: {
        lg: "var(--radius-input)",
        md: "calc(var(--radius-input) - 2px)",
        sm: "calc(var(--radius-input) - 4px)",
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
        // The roadmap's three motions Verve has no keyframe for. Verve's own (`vv-pop`, `vv-ring`,
        // `vv-draw`) carry the other three below; none of the six animates a colour, and each is
        // spelled behind `motion-safe:` at its call site.
        //
        // A celebration particle leaving the point it was born at. Where it lands is that span's own
        // `--dx`/`--dy`, set inline — position data, never colour — so one keyframe serves all 48.
        'roadmap-burst': {
          from: { transform: 'none', opacity: '1' },
          to: { transform: 'translate(var(--dx), var(--dy)) scale(.4)', opacity: '0' },
        },
        // One soft band crossing a row once. The band is the row's own className
        // (`bg-gradient-to-r from-transparent via-primary/15 to-transparent bg-[length:50%_100%]
        // bg-no-repeat`), so its colour stays a Tailwind name; this only moves it from fully off the
        // left edge (-100% of a half-width image) to fully off the right (200%).
        'roadmap-sweep': {
          from: { backgroundPosition: '-100% 0' },
          to: { backgroundPosition: '200% 0' },
        },
        // A reached milestone's station swelling past its size and settling a little over it. The
        // peak sits early so the settle has most of the run, under `--ease-spring`'s own overshoot.
        'roadmap-bloom': {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.6)' },
          '100%': { transform: 'scale(1.1)' },
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
        // `both` keeps it at its end state while the memory that suppressed it is consulted.
        // `shape-item` is a row or a tile following its frame, `backwards` so the stagger's delay
        // holds the item invisible instead of flashing it at full opacity before its turn.
        'shape-rise': 'vv-rise var(--dur-move) var(--ease-enter) both',
        'shape-item': 'vv-pagein 240ms var(--ease-enter) backwards',
        // The dispatcher cards' live ring, on Verve's own `vv-ring` — the halo its StatusFlow puts
        // round the stage in hand (`_ds_bundle.js`, `vv-ring 2.4s ease-out infinite`). It is that
        // halo on a node whose walk is out right now, breathing for as long as it is. An arc deck's
        // plans are paged, not jumped to, so the one-shot flavour the tab's wall used is gone.
        'live-ring': 'vv-ring 2.4s ease-out infinite',
        // The roadmap's celebrations. Three run Verve's own keyframes (`vv-pop`, `vv-ring`, `vv-draw`
        // in `src/shared/ui/verve/tokens.css`), because Verve draws that motion; the other three run
        // the keyframes above.
        // A mark arriving: the shipped dot, a figure ticking up. `vv-pop` on the spring curve.
        'roadmap-pop': 'vv-pop 420ms var(--ease-spring)',
        // One halo going out from a mark, once — `live-ring`'s `vv-ring`, run a single time at 900ms
        // instead of breathing for as long as a walk is out.
        'roadmap-ring': 'vv-ring 900ms ease-out 1',
        // An SVG stroke drawing itself, such as an epic ring's last segment. The stroke needs
        // `pathLength="1"` AND `[stroke-dasharray:1]`: `vv-draw` moves only `stroke-dashoffset`
        // (1 → 0), so without the dash the stroke is solid at every frame and nothing draws. It does
        // nothing to a div's background, so a rail drawn as a `bg-primary` div cannot use it; a rail
        // that fills with this is an SVG line. `forwards` keeps the line drawn when it ends.
        'roadmap-draw': 'vv-draw 900ms var(--ease-enter) forwards',
        // A particle's flight, `forwards` so it stays at its last frame, invisible, until its layer
        // is taken down.
        'roadmap-burst': 'roadmap-burst 1.1s ease-out forwards',
        // The shipped row's band crossing it, once. `forwards` because the keyframe's end is the band
        // off the right edge, which is the band gone; without it the position falls back to the
        // default `0 0` the moment the pass ends and parks the band on the row's left half.
        'roadmap-sweep': 'roadmap-sweep 600ms var(--ease-enter) forwards',
        // The reached station's swell.
        'roadmap-bloom': 'roadmap-bloom 900ms var(--ease-spring)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
