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
  /**
   * Set for a sentence that has just landed: its words come in one after another, the first after `delay` ms and each next one
   * `step` ms later. Absent, the sentence is its bare words.
   */
  arriving?: { delay: number; step: number };
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
        className="mx-0.5 inline-flex h-4 items-center rounded bg-accent-soft px-1 align-[-2px] text-accent-ink"
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
 * ARRIVING, each word is a span that fades in on its own delay (`.companion-word`, index.css), and a sound's mark takes the delay
 * of the word it follows. The spans are inline and the white space between them stays text, so the paragraph wraps exactly as its
 * bare words do: nothing moves when a sentence lands, and nothing moves when its words have come in. Reduced motion draws them whole.
 *
 * Used by this module's CompanionReply, once per sentence of a turn's paragraph.
 */
export function CompanionSentence({ text, sounds, arriving }: CompanionSentenceProps) {
  if (sounds.length === 0 && arriving === undefined) return <>{text}</>;
  let word = 0;
  const delayOf = (index: number) => ({ animationDelay: `${Math.round((arriving?.delay ?? 0) + index * (arriving?.step ?? 0))}ms` });
  /** A stretch of the text: bare, or cut into its words while the sentence arrives. */
  const stretch = (from: number, to: number): ReactNode => {
    const piece = text.slice(from, to);
    if (arriving === undefined) return <Fragment key={`t${from}`}>{piece}</Fragment>;
    return (
      <Fragment key={`t${from}`}>
        {piece.split(/(\s+)/).map((run, at) => (
          run === '' || /^\s+$/.test(run)
            ? run
            : <span key={at} className="companion-word" style={delayOf(word++)}>{run}</span>
        ))}
      </Fragment>
    );
  };
  const ordered = sounds.map((sound, made) => ({ ...sound, made })).sort((a, b) => a.at - b.at || a.made - b.made);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const sound of ordered) {
    const at = Math.min(Math.max(sound.at, cursor), text.length);
    if (at > cursor) parts.push(stretch(cursor, at));
    parts.push(
      arriving === undefined
        ? <SoundMark key={`s${sound.made}`} tag={sound.tag} />
        : <span key={`s${sound.made}`} className="companion-word" style={delayOf(Math.max(0, word - 1))}><SoundMark tag={sound.tag} /></span>,
    );
    cursor = at;
  }
  if (cursor < text.length) parts.push(stretch(cursor, text.length));
  return <>{parts}</>;
}
