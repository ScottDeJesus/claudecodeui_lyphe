import { useEffect, useRef, useState } from 'react';
import type { FocusEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionAttachments } from '@/modules/companion/CompanionAttachments';
import type { CompanionAttachment, CompanionLogEntry } from '@/shared/companion-types';
import { ScrollArea } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** How much of the hairline beside the chips must stand in her words' pane for the chips to count as whole (a sub-pixel cut is none). */
const WHOLE = 0.99;
/** How far past a focused chip the row is scrolled: its own padding, which holds the chip's focus ring and its finger catch. */
const FOCUS_MARGIN = 8;

/**
 * The files of his newest line while her portrait is still about that line. Her answer is the turn of her first sentence after his line
 * (a sentence with no turn is a turn of its own, the portrait's rule). None before he has said anything (or after a Clear), none when the
 * line carries none, and none once she has turned to something else: an alert after her first sentence, or a sentence of another turn
 * (one a chat's report opened, which writes no line in her log).
 */
function attachmentsInPlay(log: CompanionLogEntry[]): CompanionAttachment[] {
  let his = -1;
  for (let at = log.length - 1; at >= 0 && his === -1; at -= 1) {
    if (log[at].role === 'operator') his = at;
  }
  if (his === -1) return [];
  const files = log[his].attachments ?? [];
  const first = log.findIndex((entry, at) => at > his && entry.role === 'kaylee');
  if (first === -1) return files;
  const answer = log[first].turnId;
  const turnedAway = log.some((entry, at) => at > first
    && (entry.role === 'alert' || (entry.role === 'kaylee' && (answer === null || entry.turnId !== answer))));
  return turnedAway ? [] : files;
}

/**
 * Used by the station module's portrait: the attachments of his newest line, as one centred row of small chips, while her portrait
 * thinks about that line and answers it. Nothing when that line has none, or once she has turned to something else (below). Its
 * accessible name is "You attached".
 *
 * The portrait draws none of his lines, so this is the one place he sees what she is answering about. It stands while she thinks about
 * his line and answers it, keyed on her answer (the turn of her first sentence after his line) and read from the log alone, never the
 * portrait's turn logic. It leaves when she turns to something else: his next line, an alert after her first sentence, or a sentence of
 * another turn (one a chat's report opened, which writes no line in her log). An alert before her first sentence leaves it standing, since
 * her answer still answers his line; her turn about that alert comes after her answer and takes the strip away. Her reading of a file he
 * attached is a tool call inside her answer, so it never does. With Live off an alert opens no turn and the strip leaves all the same:
 * the log alone cannot tell the two apart, and a strip that leaves early only says less, where one naming his old files over her answer
 * to something else would mislead. One moment the log cannot show: while she thinks about a chat's report, before its first sentence
 * lands, the strip stands over her dots, since nothing marks that turn yet; it lasts seconds, and her face and her state's words say she
 * is thinking. The chips are the chat's own at `small` (`CompanionAttachments`), pictures then files, each its own press: a picture
 * enlarges, a file downloads.
 *
 * PINNED WHILE SHE THINKS, IN FLOW OTHERWISE. Her words' pane follows its end. `pinned` is the portrait's word that her words are the
 * thinking dots (its own state, from her running turn and her process, which the log cannot tell from a turn that broke or one he
 * stopped). Then the strip is pinned to the pane's top on her ground, over those dots, which her face and her state's words already
 * say: at the laptop tier her portrait holds its 11rem floor and her words get 50 px, where the strip and her dots (about 72 px under a
 * mouse) do not fit, and in flow the strip would be cut, then hidden (measured). Under a finger its 8 px of catch padding below the
 * chips would leave them 2 px short of whole in that pane, a pinned box being held inside her words' column, so a 10 px negative margin
 * there lets it reach past the column's end. Otherwise (her answer, her harness's line for a turn that broke, her standing answer after
 * he stopped her) the strip stands in flow at the top of her words, and what the pane holds gets the pane: an answer longer than the
 * pane carries the strip up out of view, as a chat's context scrolls up under what follows, and a scroll back up shows it. Pinned then,
 * it would hide what she said: with a draft docked at 1440×900 her words get about 75 px, and a pinned strip left only her dots in
 * sight (measured), and at the laptop tier a pinned strip covered her turn's banner whole. So in a short pane it shows while she thinks
 * and not while she answers.
 *
 * WHOLE OR NOT AT ALL: between the two, an answer that carries the strip only partly up out of her pane would leave a sliver of each
 * chip under her face, which reads as a fault. So the strip is hidden, keeping its place so her words never move, until it stands whole
 * again (a scroll back up). An IntersectionObserver on a hairline beside the chips, as tall as they are, says when: an event as the pane
 * scrolls, never a poll. A chip that Tab lands on is scrolled whole into the row, ring and catch with it, by the row's own `scrollLeft`,
 * never `scrollIntoView`, which would move her words' pane and the page as well (the station's shelf does it the same way).
 *
 * ONE LINE: centred while it fits; where the chips pass the words' width (ten at 390 px) it scrolls sideways inside itself from its
 * first chip, in the kit's horizontal `ScrollArea`, whose `pan-x` lets a finger pan it inside her vertical words pane. A mouse's plain
 * wheel is left to her words, which it scrolls; Shift+wheel and a trackpad's sideways sweep turn the row. The row is padded by what
 * reaches past a chip, so the scroller clips none of it: under a finger 8 px, its 44 px catch (INV-10275); under a mouse 4 px, the
 * house's focus ring (a 2 px outline set 2 px out), which keeps the strip low in the shortest pane. Sideways the padding is given back
 * by a negative margin, so a first chip stands at the words' edge.
 */
export function CompanionAttachmentStrip({ log, pinned = false }: {
  log: CompanionLogEntry[];
  /** The portrait's word that her words are the thinking dots (its `thinking` state): the strip pins over them. */
  pinned?: boolean;
}) {
  const { t } = useTranslation();
  const attachments = attachmentsInPlay(log);
  const drawn = attachments.length > 0;
  // The row's sideways scroller (the kit's `ScrollArea` hands its ref to it), which a focused chip is scrolled whole into.
  const rowRef = useRef<HTMLDivElement>(null);
  // The hairline beside the chips, as tall as they are, that the observer reads.
  const chipsLine = useRef<HTMLSpanElement>(null);
  // Whether the chips stand whole in her words' pane, so a strip her answer has carried only partly up hides rather than leave slivers
  // of its chips under her face. Set by the IntersectionObserver below as the pane scrolls, never by a poll.
  const [whole, setWhole] = useState(true);

  useEffect(() => {
    const line = chipsLine.current;
    if (!drawn || line === null) return undefined;
    const observer = new IntersectionObserver((entries) => setWhole(entries[entries.length - 1].intersectionRatio >= WHOLE), { threshold: WHOLE });
    observer.observe(line);
    return () => observer.disconnect();
  }, [drawn]);

  if (!drawn) return null;

  const standWhole = (event: FocusEvent<HTMLDivElement>) => {
    const row = rowRef.current;
    const chip = event.target;
    if (row === null || chip === row || !row.contains(chip)) return;
    // The chips are positioned (their catches stand on them), so each one's offset is from the row's own start, whatever it scrolled.
    const start = chip.offsetLeft - FOCUS_MARGIN;
    const end = chip.offsetLeft + chip.offsetWidth + FOCUS_MARGIN;
    if (start < row.scrollLeft) row.scrollLeft = start;
    else if (end > row.scrollLeft + row.clientWidth) row.scrollLeft = end - row.clientWidth;
  };

  return (
    <div
      role="group"
      aria-label={t('companion.attachments.strip', { defaultValue: 'You attached' })}
      data-companion-attachment-strip=""
      // Pinned (sticky, its own ground, over the dots that follow; under a finger reaching 10 px past her words' column) while she
      // thinks; in her words' flow otherwise.
      className={cn('-mx-2', pinned ? 'sticky top-0 z-10 bg-background finger:-mb-2.5' : 'relative', !whole && 'invisible')}
    >
      <ScrollArea ref={rowRef} orientation="horizontal" onFocus={standWhole}>
        {/* As wide as its chips: centred by its margins while it fits, and starting at the scroller's start once it does not. */}
        <div className="mx-auto w-max px-2 py-1 finger:py-2">
          <CompanionAttachments attachments={attachments} size="small" />
        </div>
      </ScrollArea>
      {/* Beside the chips and as tall as them (the row's padding in from the top and the foot), outside the sideways scroller, so only
          her words' pane can cut it: whether it stands whole is whether the chips do. */}
      <span ref={chipsLine} aria-hidden="true" className="pointer-events-none absolute inset-y-1 left-0 w-px finger:inset-y-2" />
    </div>
  );
}
