import { cn } from '@/shared/utils';

type ClaudeCodeMarkProps = {
  /** Tailwind size classes. The figure is 16:10 and is centred inside whatever box they draw. */
  className?: string;
};

/**
 * Claude Code's pixel mascot: a body with two eyes, an arm out to each side and four legs.
 *
 * Drawn wherever the mark answers WHO is doing the work inside a conversation — the chat
 * transcript's assistant turns and every subagent row — which reach it through `LLMProviderLogo`'s
 * `claudeMark="mascot"` opt-in. The composer's DeepSeek chip draws it directly, while the switch is
 * off and the builds run on Claude: that chip is a pressed toggle, and the mark says which side the
 * builds are on.
 *
 * `ClaudeLogo`, the company's starburst, is the other mark and stays the default behind that door:
 * it is what the sidebar, settings, onboarding, the model library and the accounts readouts draw,
 * because there the mark names the PROVIDER an account or a session is opened on. This one names
 * the coding agent at work, which is why it is the tool's own figure.
 *
 * Drawn on the reference's own grid. The operator's 640px artwork is built from 40px cells, 16
 * across and 10 down, so the viewBox counts cells. At `h-4 w-4` each cell is one CSS pixel, which on
 * a 1.25× or 1.5× screen is not a whole number of device pixels: antialiased, every edge smeared
 * into a half-tone fringe (measured, 15 colours at 1.25×). `crispEdges` snaps each edge to a device
 * pixel instead, so the figure stays hard at every scale, at the cost of one cell now and then
 * coming out a device pixel wider than its neighbour. Below one device pixel per cell (under 16
 * device pixels across) a snapped cell can vanish, eyes first, so the floor below holds the box at
 * the 16×10 device pixels the grid needs at 1× whatever the call site asked for — a subagent row
 * asks for `h-3.5`, and a 14px box would put this figure's cells under one device pixel each.
 * Rasterised against the reference, 0.6% of the figure's box disagrees: some of the artwork's row
 * edges sit up to 3px off its own grid, and the mark snaps them onto it.
 *
 * The eyes are HOLES, not white paint: two subpaths cut out under `evenodd`, so whatever surface
 * the mark sits on shows through, in the light theme and the dark. The orange is sampled from the
 * reference and fixed rather than a theme token, for the reason `ClaudeLogo`'s is: it is the
 * brand's colour, and a mark that changed colour with the theme would stop meaning "Claude".
 */
export function ClaudeCodeMark({ className = 'w-5 h-5' }: ClaudeCodeMarkProps) {
  return (
    <svg
      viewBox="0 0 16 10"
      role="img"
      aria-label="Claude"
      className={cn('min-w-4 min-h-2.5', className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#D97757"
        fillRule="evenodd"
        shapeRendering="crispEdges"
        // The outline runs clockwise from the body's top-left corner: the right arm, the four legs
        // right to left, the left arm. Then the two eye holes.
        d="M2 0H14V4H16V6H14V8H13V10H12V8H11V10H10V8H6V10H5V8H4V10H3V8H2V6H0V4H2Z M4 2H5V4H4Z M11 2H12V4H11Z"
      />
    </svg>
  );
}
