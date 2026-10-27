import { AudioWaveform } from 'lucide-react';
import { Fragment } from 'react';
import type { ReactNode } from 'react';

import type { CompanionSound } from '@/shared/companion-types';
import { Tooltip } from '@/shared/ui';

type CompanionSentenceProps = {
  /** The sentence as the panel shows it: her mood brackets lifted and every sound tag taken out by the server. */
  text: string;
  /** Her sounds, each at its offset into `text` (UTF-16 units, the unit `slice` cuts in). */
  sounds: CompanionSound[];
};

/**
 * One small mark where she made a sound: a waveform chip in her accent, the tag's name on hover and long-press (the kit
 * Tooltip), and the name in parentheses to a screen reader, so "(giggle)" is read where it happened. Never colour alone:
 * the chip's shape is the mark.
 */
function SoundMark({ tag }: { tag: string }) {
  return (
    <Tooltip content={tag} position="top">
      <span
        data-companion-sound={tag}
        className="mx-0.5 inline-flex h-4 items-center rounded-full bg-accent-soft px-1 align-[-2px] text-accent-ink"
      >
        <AudioWaveform aria-hidden="true" className="size-3" strokeWidth={2} />
        <span className="sr-only">({tag})</span>
      </span>
    </Tooltip>
  );
}

/**
 * One sentence of hers, with each sound drawn as a small mark at its offset. The text is cut at every `at` with `slice`
 * and a mark stands in each cut: the server places a sound right after the word it follows, so "Oh nice" + mark + " that
 * landed." draws the mark hugging "nice". An offset past the end is drawn at the end, and two sounds at one offset stand
 * side by side, in the order she made them.
 *
 * Used by this module's CompanionLog, once per sentence of her turn's paragraph.
 */
export function CompanionSentence({ text, sounds }: CompanionSentenceProps) {
  if (sounds.length === 0) return <>{text}</>;
  const ordered = sounds.map((sound, made) => ({ ...sound, made })).sort((a, b) => a.at - b.at || a.made - b.made);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const sound of ordered) {
    const at = Math.min(Math.max(sound.at, cursor), text.length);
    if (at > cursor) parts.push(<Fragment key={`t${cursor}`}>{text.slice(cursor, at)}</Fragment>);
    parts.push(<SoundMark key={`s${sound.made}`} tag={sound.tag} />);
    cursor = at;
  }
  if (cursor < text.length) parts.push(<Fragment key={`t${cursor}`}>{text.slice(cursor)}</Fragment>);
  return <>{parts}</>;
}
