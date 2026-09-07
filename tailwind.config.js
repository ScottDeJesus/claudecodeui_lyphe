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
      },
      animation: {
        shimmer: 'shimmer 2s linear infinite',
        // Verve's timings, not Tailwind's default tween: the scrim fades on `vv-fade .25s` and
        // the panel arrives on `vv-pop .45s var(--ease-enter)`.
        'dialog-overlay-show': 'dialog-overlay-show 250ms var(--ease-enter)',
        'dialog-content-show': 'dialog-content-show 450ms var(--ease-enter)',
        'bottom-sheet-content-show': 'bottom-sheet-content-show 220ms cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
