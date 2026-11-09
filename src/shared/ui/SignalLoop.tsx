import { cn } from '@/shared/utils';

type SignalLoopProps = {
  /**
   * What the agent is doing: `thinking` (the loop broken into dashes that turn — a turn is being worked on, nothing heard yet),
   * `working` (the loop whole and breathing — tools running, output arriving) or `idle` (a still ring in the idle ink).
   */
  state: 'thinking' | 'working' | 'idle';
  /** Whose loop: `accent` for the chat's own agent, `secondary` (Astrolabe's ice) for the helpers it started — subagents, souls. */
  signal?: 'accent' | 'secondary';
  /** Outer size in px; the ring keeps a hairline track at any size. */
  size?: number;
  className?: string;
};

/**
 * Used by the chat module (the composer's live status line) and the sidebar module (a chat's running and helpers-running marks):
 * the small form of Astrolabe's loop, the same sign Kaylee's face and the app's Spinner make, so every agent at work reads as one
 * instrument wherever it is shown. Decorative: the words beside it (or the tooltip around it) carry the state. Under reduced
 * motion the dashes hold still and the breath stops.
 */
export function SignalLoop({ state, signal = 'accent', size = 14, className }: SignalLoopProps) {
  return (
    <svg className={cn('vv-signal-loop', className)} data-state={state} data-signal={signal} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle className="vv-signal-loop__track" cx="8" cy="8" r="6" />
      {/* pathLength 16 makes the dashes eight at any size: few enough to read as a broken ring at 13 px. */}
      <circle className="vv-signal-loop__ring" cx="8" cy="8" r="6" pathLength="16" strokeDasharray={state === 'thinking' ? '1.25 0.75' : undefined} />
    </svg>
  );
}
