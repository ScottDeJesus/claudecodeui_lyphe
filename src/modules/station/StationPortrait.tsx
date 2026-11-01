import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionAttachmentStrip, CompanionReply, useFollowNewest } from '@/modules/companion';
import { useDrawnSquare } from '@/modules/station/hooks/useDrawnSquare';
import type { CompanionLogEntry, CompanionPicture } from '@/shared/companion-types';
import type { CompanionSentenceRef, StationDensity } from '@/shared/types';
import { Banner, ScrollArea } from '@/shared/ui';

/** What her words area holds: the dots while she answers, her harness's line for a turn that broke, her latest answer, or the empty state. */
type PortraitState = 'thinking' | 'broke' | 'reply' | 'empty';

/** Her face's px until the layout has told the view the square it drew (it fills a 200 px square before that). */
const FACE_FALLBACK_PX = 200;

/** Her latest turn: its id and its sentences in their order, or null before she has said anything. */
type LatestTurn = { turnId: string | null; sentences: CompanionLogEntry[] };

/**
 * The turn her newest line belongs to, every sentence of it (a card or an alert between two of them does not part them), ordered
 * by their place in it. A line with no turn is a turn of its own.
 */
function latestTurnOf(log: CompanionLogEntry[]): LatestTurn | null {
  let newest: CompanionLogEntry | null = null;
  for (let at = log.length - 1; at >= 0 && newest === null; at -= 1) {
    if (log[at].role === 'kaylee') newest = log[at];
  }
  if (newest === null) return null;
  const { turnId } = newest;
  const sentences = turnId === null ? [newest] : log.filter((entry) => entry.role === 'kaylee' && entry.turnId === turnId);
  return { turnId, sentences: [...sentences].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) };
}

type StationPortraitViewProps = {
  /** Taken and passed by every region; the portrait draws the same at every tier and density, on the room it is given. */
  density: StationDensity;
  /** Her picture as the page holds it. Never null here: until the first read lands (or while it has failed) the conversation's own loading row and failed banner stand in her place. */
  picture: CompanionPicture;
  /** Her name as he set it. */
  name: string;
  /** The sentence this page's player is sounding, marked in her answer; null when none is. */
  speaking: CompanionSentenceRef | null;
  /** Her face at the square the view draws it, in px: `CompanionFace` on the page, `CompanionAvatar` on a fixture's presence. */
  face: (px: number) => ReactNode;
};

/**
 * HER PORTRAIT, her column's `conversation` slot while her view is `portrait` (`StationConversation` hands it the picture): her face
 * front and center, undisced, and under it the words of her latest answer alone, as they stream and as she speaks them.
 *
 * - HER FACE takes the room's upper two parts, centred, a square of the smaller side that part gives it and never past 32rem: as
 *   large as her column allows. It is the companion's own drawing (`face`, the face on her button), with no disc or ground of
 *   its own behind it. Her column's head over it holds her name, her state and her controls.
 * - HER WORDS take the lower part, in a pane of their own that scrolls inside itself, so a long answer never moves her face: her
 *   latest turn's sentences as one paragraph (`CompanionReply`, the log's own: the sentence she is speaking on its band, each
 *   sound a small mark), the breathing dots at its end while she is still answering, and the pane follows the end as the answer
 *   grows until he scrolls up. Earlier turns are not drawn; his own lines are not either.
 * - THINKING: while something is working toward her answer (her turn is running with none of its sentences landed yet, or her process
 *   is waking for his line) her words are the breathing dots alone; her face and her state's words, which read the same presence
 *   (MAN-9089), say what she is doing. His line newest with no turn behind it (Stop before her first sentence) is not thinking: her
 *   latest answer stands, as the log's newest turn.
 * - A TURN THAT BROKE: her harness's line, as the log's newest, in a warn `Banner`, where her words would be: it is the answer he gets.
 * - EMPTY: before her first hello, the log's own words for what she is for.
 *
 * The parts are ratios (2 to 1), never her words' height, so her face never resizes as the answer grows. In her column the shell holds
 * the slot at an 11rem floor while this is drawn (`PORTRAIT_FLOOR`, MAN-9230), a face about 100 px over two lines of her words, so a
 * stage beside her on a laptop gives way to her rather than leave a sliver. Cards she put up stand on the stage's shelf only: they are
 * drawn in her conversation, not here.
 *
 * `data-station-portrait` reads the state of her words. A pure view: `StationConversation` binds it, and
 * `.verify/kaylee-station-shots.mjs` draws it on `fake/portrait.ts`'s pictures.
 */
export function StationPortraitView({ picture, name, speaking, face }: StationPortraitViewProps) {
  const { t } = useTranslation();
  const [setFaceNode, drawnPx] = useDrawnSquare(FACE_FALLBACK_PX);
  const { log, turnId } = picture;
  const reply = latestTurnOf(log);
  const newest = log[log.length - 1];
  // She is thinking only while something is working toward an answer: her turn is running with none of its sentences landed (the
  // log's own rule for its waiting row), or she is waking for his line. His line alone is not enough: a turn that ended with no
  // sentence (Stop before her first) leaves his line newest and nothing coming, and dots there would breathe forever.
  const working = (turnId !== null && reply?.turnId !== turnId) || (newest?.role === 'operator' && picture.process.state === 'waking');
  const state: PortraitState = working ? 'thinking' : newest?.role === 'system' ? 'broke' : reply !== null ? 'reply' : 'empty';
  const answered = state === 'reply' ? reply : null;
  const lastSentence = answered?.sentences[answered.sentences.length - 1];
  // A sentence growing, one landing, a turn starting or ending all change what stands at the end of her words.
  const contentKey = `${state}:${answered?.sentences.length ?? 0}:${lastSentence?.text.length ?? 0}:${turnId ?? ''}`;
  const { scrollerRef } = useFollowNewest(contentKey, true);

  return (
    <div data-station-portrait={state} className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      {/* A query container of its own, so the square is read off this part's sides (cqw, cqh), never off her whole column's. */}
      <div className="flex min-h-0 flex-[2_1_0%] items-center justify-center p-3 [container-type:size]">
        <div ref={setFaceNode} data-station-portrait-face="" className="relative size-[min(100cqw,100cqh,32rem)] shrink-0">
          {face(drawnPx)}
        </div>
      </div>
      {/* Keyed by the answer it holds, so a new answer starts at its own beginning and follows its end afresh. */}
      <ScrollArea key={answered?.turnId ?? state} ref={scrollerRef} className="min-h-0 flex-[1_1_0%]">
        <div
          role="log"
          tabIndex={0}
          data-station-portrait-words=""
          aria-label={t('station.portrait.label', { name, defaultValue: '{{name}}\'s latest answer' })}
          className="px-4 pb-4 pt-1 text-center focus-visible:-outline-offset-2"
        >
          <div className="mx-auto max-w-xl">
            <CompanionAttachmentStrip log={log} pinned={state === 'thinking'} />
            {state === 'thinking' && <CompanionReply sentences={[]} turnId={null} answering speaking={null} name={name} className="text-base" />}
            {state === 'broke' && <div className="text-left"><Banner tone="warn">{newest.text}</Banner></div>}
            {answered !== null && (
              <CompanionReply
                sentences={answered.sentences}
                turnId={answered.turnId}
                answering={turnId !== null && answered.turnId === turnId}
                speaking={speaking}
                name={name}
                className="text-base"
              />
            )}
            {state === 'empty' && <p className="text-sm leading-relaxed text-muted-foreground">{t('companion.log.emptyMessage', { name })}</p>}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
