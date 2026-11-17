import type { SimpleChatMark } from '@/shared/types';
import { cn } from '@/shared/utils';

type SessionTileProps = {
  /** Which of its four marks the chat draws (`chatMarks`): the tile shows each in its own place, so two can stand at once. */
  marks: Record<SimpleChatMark, boolean>;
  /** The chat has no live session host: the tile is its bare frame. */
  isAsleep: boolean;
  className?: string;
};

/**
 * ONE CHAT AS A SMALL WINDOW THAT SHOWS ITS STATE BY HOW IT STANDS, 66 by 44. The frame alone is a chat asleep. A plate in it is a chat awake.
 * A dashed ring on the plate is its turn running, and it turns slowly while it does. The plate filled in the accent is a chat waiting on the reader. A bar
 * across the top is a reply not read yet. A dot under the plate is a subagent still at work. Each mark has its own place, so a chat that is running with a
 * subagent out, or asleep with a reply unread, reads at a glance.
 *
 * Drawn `aria-hidden`: the row says the same states in words beside it.
 *
 * Used by `BoardChatRow`, once per chat on the sessions board.
 */
export function SessionTile({ marks, isAsleep, className }: SessionTileProps) {
  // A turn or a question means the chat is awake whatever the host's census last said.
  const awake = !isAsleep || marks.running || marks.awaitingInput;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 66 44"
      width={66}
      height={44}
      data-session-tile={marks.awaitingInput ? 'waiting' : marks.running ? 'running' : awake ? 'idle' : 'asleep'}
      className={cn('block flex-none', className)}
    >
      <rect x={0.5} y={0.5} width={65} height={43} fill="none" className="stroke-border transition-colors group-focus-within/row:stroke-foreground group-hover/row:stroke-foreground" />
      {marks.unread && <rect data-tile-mark="unread" x={4.5} y={2} width={57} height={6} style={{ fill: 'var(--ink-strong)' }} />}
      {awake && (marks.awaitingInput
        ? <rect data-tile-mark="waiting" x={4} y={9.5} width={58} height={25} rx={0.5} style={{ fill: 'var(--accent)' }} />
        : <rect x={4.5} y={10} width={57} height={24} style={{ fill: 'color-mix(in srgb, var(--ink) 20%, transparent)', stroke: 'var(--ink-muted)' }} strokeWidth={0.75} />)}
      {marks.running && (
        <circle
          data-tile-mark="running"
          cx={33}
          cy={22}
          r={10.5}
          fill="none"
          strokeWidth={1}
          strokeDasharray="3.2 2.3"
          style={{ stroke: 'var(--accent)', transformBox: 'fill-box', transformOrigin: 'center' }}
          className="motion-safe:animate-[spin_9s_linear_infinite]"
        />
      )}
      {marks.subagents && <circle data-tile-mark="subagents" cx={33} cy={39} r={1.9} style={{ fill: 'var(--signal-b)' }} />}
    </svg>
  );
}
