const plugin = require('tailwindcss/plugin')

// Tailwind's STOCK palettes, retuned to Astrolabe. Seventy-odd older screens still spell stock classes (`bg-blue-600`,
// `dark:bg-gray-800`, `text-emerald-700` …), which drew stock Tailwind blues, greens, violets and navy greys beside the
// instrument. Rather than repaint ~1,300 call sites, each stock shade is replaced by the colour with the SAME relative
// luminance — so every contrast ratio those screens had still holds — the hue of the Astrolabe tone it stands for, and a
// chroma no stronger than that tone's own: greens → positive, reds and roses → danger, ambers, yellows and oranges → warn
// (gold, never the live amber), blues, skies and cyans → info (ice), indigo → the feature blue, violets, purples and
// fuchsias → the epic violet; pink keeps its hue, quieted. Greys become the instrument's neutral steel, and their dark
// end IS the Night ground: 950 canvas, 900 surface, 800 surface2, 700 one hover rung above it. Generated from
// tailwindcss/colors and tokens.css. New work reads the tokens (`bg-background`, `text-muted-foreground`, `--pos-ink` …),
// never these; they exist so old screens stop shouting.
const ASTROLABE_STOCK = {
  gray: { 50: '#f9fafb', 100: '#f3f4f6', 200: '#e4e7eb', 300: '#d0d5db', 400: '#9ba4ad', 500: '#6b737b', 600: '#4d555d', 700: '#2b3035', 800: '#161a1e', 900: '#0e1013', 950: '#08090b' },
  slate: { 50: '#f8fafc', 100: '#f1f5f9', 200: '#e1e8f0', 300: '#ccd5de', 400: '#9aa3ac', 500: '#6c747c', 600: '#4d555d', 700: '#2b3035', 800: '#161a1e', 900: '#0e1013', 950: '#08090b' },
  zinc: { 50: '#fafafa', 100: '#f3f4f5', 200: '#e2e5e7', 300: '#d2d5d8', 400: '#9ca3aa', 500: '#6c737a', 600: '#4d545b', 700: '#2b3035', 800: '#161a1e', 900: '#0e1013', 950: '#08090b' },
  neutral: { 50: '#fafafa', 100: '#f5f5f5', 200: '#e5e5e5', 300: '#d4d4d4', 400: '#a3a3a3', 500: '#737373', 600: '#525252', 700: '#2b3035', 800: '#161a1e', 900: '#0e1013', 950: '#08090b' },
  stone: { 50: '#f9fafb', 100: '#f4f5f6', 200: '#e4e6e7', 300: '#d1d4d6', 400: '#9fa4a9', 500: '#6d7379', 600: '#505459', 700: '#2b3035', 800: '#161a1e', 900: '#0e1013', 950: '#08090b' },
  green: { 50: '#effdf6', 100: '#d9fceb', 200: '#b4f8d8', 300: '#87edc1', 400: '#71d7ac', 500: '#57be94', 600: '#339f77', 700: '#047f5a', 800: '#036547', 900: '#005339', 950: '#002e1e' },
  emerald: { 50: '#ecfdf4', 100: '#d1fae6', 200: '#a7f3d0', 300: '#7ee5b9', 400: '#67cea3', 500: '#4db58b', 600: '#25956d', 700: '#0c7855', 800: '#0e5f43', 900: '#0f4e37', 950: '#072c1e' },
  lime: { 50: '#effff7', 100: '#dafeec', 200: '#aefed9', 300: '#8ff5c8', 400: '#80e6ba', 500: '#65cba0', 600: '#3aa47b', 700: '#057f5a', 800: '#036547', 900: '#00563c', 950: '#003120' },
  teal: { 50: '#f1fdf7', 100: '#d2fbe7', 200: '#a6f5d1', 300: '#82e8bc', 400: '#6ad1a6', 500: '#4eb68d', 600: '#379470', 700: '#2d7659', 800: '#265e47', 900: '#214e3b', 950: '#0f2f22' },
  red: { 50: '#fef2f0', 100: '#fee2de', 200: '#fecbc3', 300: '#fca69a', 400: '#f87363', 500: '#e05547', 600: '#cb4135', 700: '#b32820', 800: '#991c16', 900: '#7f1e17', 950: '#450a07' },
  rose: { 50: '#fff1ef', 100: '#ffe5e0', 200: '#fecec6', 300: '#fda699', 400: '#fc7464', 500: '#e35749', 600: '#cd4337', 700: '#b52b22', 800: '#a01712', 900: '#891611', 950: '#4d0705' },
  amber: { 50: '#fefbf1', 100: '#fff2d2', 200: '#ffe4a1', 300: '#fad36a', 400: '#ebc45b', 500: '#d3ac41', 600: '#b18b10', 700: '#8a6b01', 800: '#6e5504', 900: '#5b4602', 950: '#322501' },
  yellow: { 50: '#fffbf1', 100: '#fff6e1', 200: '#ffecbf', 300: '#ffdd86', 400: '#f4cc64', 500: '#deb74d', 600: '#b8921d', 700: '#8b6c04', 800: '#715702', 900: '#5e4902', 950: '#342701' },
  orange: { 50: '#fcf8ec', 100: '#faefd4', 200: '#f1dca6', 300: '#e6c469', 400: '#cea83c', 500: '#bc9623', 600: '#a78307', 700: '#876903', 800: '#6c5301', 900: '#584401', 950: '#2e2200' },
  blue: { 50: '#ebf7fc', 100: '#d2edf8', 200: '#afe0f3', 300: '#7fcbe8', 400: '#60acc8', 500: '#428fa9', 600: '#257690', 700: '#08647d', 800: '#025268', 900: '#034659', 950: '#002d3a' },
  sky: { 50: '#eff9fe', 100: '#def3fb', 200: '#b7e7fa', 300: '#87d3ef', 400: '#6fbbd7', 500: '#59a5c0', 600: '#3987a1', 700: '#186c86', 800: '#035c74', 900: '#014c61', 950: '#003241' },
  cyan: { 50: '#f4fcff', 100: '#e1f6fe', 200: '#c1edfe', 300: '#96e1fd', 400: '#7fcbe7', 500: '#64b0cc', 600: '#418fa9', 700: '#22738d', 800: '#145e75', 900: '#124e61', 950: '#033442' },
  indigo: { 50: '#ebf3ff', 100: '#dbe9ff', 200: '#bcd5fd', 300: '#90b9fb', 400: '#6896e0', 500: '#4b77bf', 600: '#345fa5', 700: '#265094', 800: '#174183', 900: '#0d3779', 950: '#05204b' },
  violet: { 50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a58eef', 500: '#846cca', 600: '#7057b2', 700: '#6248a2', 800: '#533891', 900: '#472a82', 950: '#300f64' },
  purple: { 50: '#f7f6ff', 100: '#edeaff', 200: '#dfd8ff', 300: '#c8bafe', 400: '#a890f2', 500: '#8971cf', 600: '#735bb7', 700: '#6349a3', 800: '#553a93', 900: '#472a82', 950: '#320e68' },
  fuchsia: { 50: '#f7f6fe', 100: '#efecff', 200: '#dfd8fe', 300: '#c8baff', 400: '#ae96f8', 500: '#937bda', 600: '#7c64c1', 700: '#6950ab', 800: '#583e97', 900: '#4c3089', 950: '#321465' },
  pink: { 50: '#fdf2f8', 100: '#fce7f3', 200: '#fbcfe8', 300: '#f9a8d4', 400: '#e57eb1', 500: '#ce6693', 600: '#bb5276', 700: '#a63e5f', 800: '#922b4e', 900: '#821b43', 950: '#500724' },
}

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
      // Astrolabe's two faces (tokens.css): Geist for what is read, Geist Mono for what the instrument reports. `serif` is
      // the display role the Verve screens already spell (`font-serif`): it is Geist too, set light and tight by tokens.css.
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        serif: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
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
        ...ASTROLABE_STOCK,
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
        // The second signal (Astrolabe's ice; Verve's garnish): the station's marks, its shapes (the "new" dot, the last look's
        // dashed rule, a new landing's edge). A shape in it is `bg-garnish` or `border-garnish`. No new colour: tokens.css's
        // `--garnish`, which reads at least 3:1 on both grounds — enough for a shape, not for a word.
        garnish: "color-mix(in srgb, var(--garnish) calc(<alpha-value> * 100%), transparent)",
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
      // Machined corners (Astrolabe): every rung of Tailwind's radius scale resolves to a token, so the 140-odd
      // `rounded-xl` / `rounded-2xl` sites follow the system too. `rounded-full` stays round for dots, pills and avatars.
      borderRadius: {
        sm: "var(--radius-control)",
        DEFAULT: "var(--radius-control)",
        md: "var(--radius-control)",
        lg: "var(--radius-input)",
        xl: "var(--radius-card)",
        "2xl": "var(--radius-screen)",
        "3xl": "var(--radius-screen)",
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
        // A small mark of state appearing where it stands, once: the kit's `vv-fab-dot-in` (`surfaces.css`), the pop the
        // FAB's dot arrives with, on the spring curve. Worn by Kaylee's "1 new" on her folded notes, under `motion-safe:`.
        'mark-in': 'vv-fab-dot-in 0.25s var(--ease-spring) both',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    // `finger:`: the touch law's one trigger (Kaylee Station's INV-10275), the kit's own query (`verve/data.css`): a touch screen, or any
    // window under 768 px, the house's mobile breakpoint. A width alone missed a phone on its side (844 px across), whose presses stayed
    // desk-sized. Beside `max-md:`, which stays for what a NARROW window lays out differently (a line that wraps, a cell that hides).
    plugin(({ addVariant }) => addVariant('finger', '@media (pointer: coarse), (max-width: 767.98px)')),
  ],
}
