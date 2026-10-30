import { ArrowDown, AudioLines, Bell, Keyboard, Mic, TriangleAlert } from 'lucide-react';
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionSentence } from '@/modules/companion/CompanionSentence';
import { useFollowNewest } from '@/modules/companion/hooks/useFollowNewest';
import type { CompanionLogEntry } from '@/shared/companion-types';
import type { CompanionSentenceRef } from '@/shared/types';
import { Button, EmptyState, ScrollArea } from '@/shared/ui';

type CompanionLogProps = {
  /** The picture's log, oldest first. */
  entries: CompanionLogEntry[];
  /** Her name, for her lines' caption and the empty state. */
  name: string;
  /** The turn she is answering right now, or null: its paragraph ends in the breathing dots. */
  turnId: string | null;
  /** Whether the panel is drawn: a closed panel stays mounted, and is put back at the newest line when it opens. */
  visible: boolean;
  /** The sentence this page's player is sounding: marked in her paragraph. Absent or null, no sentence is marked. */
  speaking?: CompanionSentenceRef | null;
};

/**
 * The sentence being spoken, as read-aloud marks it: a highlighter's band in the info tone (the status line's Speaking),
 * its ink at a fifth, widened by a ring of the same band so the words keep their places (a ring takes no room; padding
 * would re-wrap the paragraph each time the mark moves), with a 2px bar of the tone's full ink in the ring's left edge,
 * and all of it cloned onto every line the sentence wraps over. The bar is what meets the house's 3:1 floor for a mark:
 * 5.3:1 against the canvas in light and 10.3:1 in dark, 4.3:1 and 6.8:1 against the band beside it, where the band alone
 * measures 1.32:1 and 1.51:1 (the tone's own soft ground, 1.07:1, vanished in light); the words on the band keep 12.6:1
 * and 11.0:1. The bar is a shadow, as the ring is, so it too takes no room; drawn under the ring's fifth of the same ink,
 * it reads as the full ink. An underline was tried and read as a link. Forced colours drop every ground and shadow, so
 * there the words are underlined instead.
 */
const SPEAKING_MARK =
  'rounded-sm bg-tone-ink/20 ring-2 ring-tone-ink/20 shadow-[-2px_0_0_0] shadow-tone-ink box-decoration-clone forced-colors:underline';

/**
 * What the log draws, one block per row: his line; her turn, every sentence of one turn joined into one paragraph; an
 * alert; a system line. Her sentences of one turn stay one block only while nothing comes between them.
 */
type LogBlock =
  | { kind: 'operator' | 'alert' | 'system'; key: string; entry: CompanionLogEntry }
  | { kind: 'kaylee'; key: string; turnId: string | null; at: string; sentences: CompanionLogEntry[] };

/** The house's caption ink and type (MAN-742): who spoke and when, above what they said. */
const CAPTION = 'flex items-center gap-1 text-xs uppercase tracking-[0.14em] text-ink-faint';

/** The log's rows, in order: consecutive sentences of one turn fold into one block, ordered by their place in it. */
function blocksOf(entries: CompanionLogEntry[]): LogBlock[] {
  const blocks: LogBlock[] = [];
  for (const entry of entries) {
    const last = blocks[blocks.length - 1];
    if (entry.role !== 'kaylee') {
      blocks.push({ kind: entry.role, key: `e${entry.id}`, entry });
    } else if (last?.kind === 'kaylee' && last.turnId !== null && last.turnId === entry.turnId) {
      last.sentences.push(entry);
    } else {
      blocks.push({ kind: 'kaylee', key: `e${entry.id}`, turnId: entry.turnId, at: entry.at, sentences: [entry] });
    }
  }
  for (const block of blocks) {
    if (block.kind === 'kaylee') block.sentences.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  }
  return blocks;
}

/** A stamp as the reader's clock reads it, `9:41 AM`; nothing for a stamp that is not a time. */
function clockOf(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** The three dots of a turn still being said; the words are for a screen reader, the dots for the eye. */
function SpeakingDots({ label }: { label: string }) {
  return (
    <span data-companion-speaking="" className="ml-1 inline-flex items-center gap-0.5 align-middle">
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          aria-hidden="true"
          className="size-1 rounded-full bg-muted-foreground motion-safe:animate-pulse"
          style={{ animationDelay: `${dot * 160}ms` }}
        />
      ))}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Her exchange with him, newest last. Drawn by this module's CompanionPanel, between the header and the dock, and by the
 * station module's conversation.
 *
 * HIS LINES stand on the right in the secondary ground, captioned "You · typed" or "You · spoken" with the glyph of the
 * way they came (a keyboard, a mic), as the chat draws his turn. A spoken line with no words (a press that carried none,
 * still a turn she answers) keeps that place and caption and reads "Nothing heard" in the muted ink on an outline, so it
 * is never taken for words he said. HER TURN is a paragraph on the left: the sentences of one turn joined, her mood
 * brackets already lifted by the server, each sound a small mark at its offset (CompanionSentence). While this page's
 * player sounds one of her sentences (`speaking`), that sentence stands on a band of the info tone, as read-aloud marks
 * it, a bar of its ink at each line's start, and the band moves on with her voice; nothing else about the paragraph
 * changes, so its lines never re-wrap under him. AN ALERT is a row in the info tone with a bell, the house's news in its own words. A SYSTEM LINE is her harness
 * speaking — her own failures among them, which she never says herself — small, in the warn tone, with the ▲ mark.
 * Colour is never the whole signal: every kind has its glyph or its caption too.
 *
 * It is a `role="log"` region, so a screen reader hears each new line as it lands. The scroller follows the newest
 * line until he scrolls up; then "Newest" stands at its foot and brings him back (`useFollowNewest`). Before her first
 * hello it is an empty state that says what she is for.
 */
export function CompanionLog({ entries, name, turnId, visible, speaking = null }: CompanionLogProps) {
  const { t } = useTranslation();
  const last = entries[entries.length - 1];
  // A new row, a sentence growing, or a turn starting or ending all change what stands at the end.
  const contentKey = `${entries.length}:${last?.id ?? 0}:${last?.text.length ?? 0}:${turnId ?? ''}`;
  const { scrollerRef, following, jumpToNewest } = useFollowNewest(contentKey, visible);

  if (entries.length === 0 && turnId === null) {
    return (
      <div data-companion-log="empty" className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-background p-4">
        <EmptyState icon={AudioLines} title={t('companion.log.emptyTitle')} message={t('companion.log.emptyMessage', { name })} />
      </div>
    );
  }

  const blocks = blocksOf(entries);
  const lastBlock = blocks[blocks.length - 1];
  // Her answer has begun but no sentence of it has landed yet: a caption and the dots stand in for its paragraph.
  const waitingOnFirstSentence = turnId !== null && !(lastBlock?.kind === 'kaylee' && lastBlock.turnId === turnId);
  const speakingWords = t('companion.log.speaking', { name });

  const row = (block: LogBlock): ReactNode => {
    if (block.kind === 'kaylee') {
      return (
        <div key={block.key} data-companion-entry="kaylee" className="flex flex-col gap-1">
          <div className={CAPTION}>{name} · {clockOf(block.at)}</div>
          <div className="break-words text-sm leading-relaxed text-foreground">
            {block.sentences.map((sentence, index) => {
              const spoken = speaking !== null && block.turnId === speaking.turnId && sentence.index === speaking.index;
              const words = <CompanionSentence text={sentence.text} sounds={sentence.sounds} />;
              return (
                <Fragment key={sentence.id}>
                  {index > 0 && ' '}
                  {/* Only the sentence being spoken gets a wrapper: with none spoken, the paragraph is its bare words. */}
                  {spoken ? <span data-companion-speaking-sentence="" data-tone="info" className={SPEAKING_MARK}>{words}</span> : words}
                </Fragment>
              );
            })}
            {block.turnId !== null && block.turnId === turnId && <SpeakingDots label={speakingWords} />}
          </div>
        </div>
      );
    }
    const { entry } = block;
    if (block.kind === 'operator') {
      const spoken = entry.via === 'spoken';
      const Via = spoken ? Mic : Keyboard;
      // A press that carried no words is still his turn: the log says so, in words he could not have said.
      const nothingHeard = spoken && entry.text.trim().length === 0;
      return (
        <div
          key={block.key}
          data-companion-entry="operator"
          data-via={entry.via ?? undefined}
          data-heard={nothingHeard ? 'nothing' : undefined}
          className="flex flex-col items-end gap-1"
        >
          {/* Typed or spoken is a state, so its glyph and word take the muted ink; the faint eyebrow ink only names and dates. */}
          <div className={CAPTION}>
            {t('companion.log.you')} ·
            <span className="flex items-center gap-1 text-muted-foreground">
              <Via aria-hidden="true" className="size-3" />
              {t(spoken ? 'companion.log.spoken' : 'companion.log.typed')}
            </span>
            · {clockOf(entry.at)}
          </div>
          {nothingHeard ? (
            <div className="max-w-[85%] rounded-xl border border-dashed border-border px-3 py-2 text-sm leading-relaxed text-muted-foreground">
              {t('companion.log.nothingHeard', { defaultValue: 'Nothing heard' })}
            </div>
          ) : (
            <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-xl bg-secondary px-3 py-2 text-sm leading-relaxed text-foreground">
              {entry.text}
            </div>
          )}
        </div>
      );
    }
    if (block.kind === 'alert') {
      return (
        <div key={block.key} data-companion-entry="alert" data-tone="info" className="flex gap-2 rounded-lg border border-tone-ink/25 bg-tone-soft px-3 py-2">
          <Bell aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-tone-ink" />
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-[0.14em] text-tone-ink">{t('companion.log.alert')} · {clockOf(entry.at)}</div>
            <p className="mt-0.5 whitespace-pre-line break-words text-sm leading-relaxed text-foreground">{entry.text}</p>
          </div>
        </div>
      );
    }
    return (
      <div key={block.key} data-companion-entry="system" data-tone="warn" className="flex items-start gap-1.5 px-1 text-xs leading-relaxed text-tone-ink">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <p className="min-w-0 break-words">
          <span className="sr-only">{t('companion.log.systemPrefix')} </span>
          {entry.text}
          <span className="text-ink-faint"> · {clockOf(entry.at)}</span>
        </p>
      </div>
    );
  };

  return (
    // A floor of 3.5rem: on a short panel (a phone's keyboard up) her newest line stays in sight while he answers her.
    <div data-companion-log="" className="relative flex min-h-14 flex-1 flex-col bg-background">
      <ScrollArea ref={scrollerRef} className="min-h-0 flex-1">
        {/* A tab stop of its own, carrying the log's name: the keys scroll the scroller around it, in browsers that do not
            make a scroller focusable on their own and in a log that holds nothing focusable. The ring is drawn inside, where
            the scroller does not clip it. */}
        <div
          role="log"
          tabIndex={0}
          aria-label={t('companion.log.label', { name })}
          className="flex flex-col gap-4 px-3 py-4 focus-visible:-outline-offset-2"
        >
          {blocks.map(row)}
          {waitingOnFirstSentence && (
            <div data-companion-entry="kaylee-waiting" className="flex flex-col gap-1">
              <div className={CAPTION}>{name}</div>
              <div className="text-sm leading-relaxed"><SpeakingDots label={speakingWords} /></div>
            </div>
          )}
        </div>
      </ScrollArea>
      {!following && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
          <Button variant="secondary" size="sm" onClick={jumpToNewest} className="pointer-events-auto h-8 rounded-full px-3 shadow-hover">
            <ArrowDown aria-hidden="true" />
            {t('companion.log.newest')}
          </Button>
        </div>
      )}
    </div>
  );
}
