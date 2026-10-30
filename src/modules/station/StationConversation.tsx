import { useTranslation } from 'react-i18next';

import { CompanionLog, useCompanion } from '@/modules/companion';
import { useStation } from '@/modules/station/context/StationContext';
import type { CompanionNote, CompanionPicture } from '@/shared/companion-types';
import type { CompanionSentenceRef, StationRegionProps, StationTier } from '@/shared/types';
import { Banner, Button, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** What the conversation draws: her picture still being read, a read that failed, or her log. */
type ConversationState = 'loading' | 'failed' | 'log';

type StationConversationViewProps = {
  /** The arrangement: in her column it takes the room her column leaves; in the narrow stack it is a window of its own height. */
  tier: StationTier;
  /** Her picture as the page holds it (her log, her cards, the turn she is answering); null until the first read lands. */
  picture: CompanionPicture | null;
  /** Why the read of her picture failed, while there is none: the failed state, with Try again. */
  readFailure: string | null;
  /** Try again: her picture read once more. */
  onReread: () => void;
  /** Her name as he set it, the default while her picture loads. */
  name: string;
  /** The sentence this page's player is sounding, marked in her paragraph; null when none is. */
  speaking: CompanionSentenceRef | null;
  /** A card she put up, pressed in the conversation: the card on the stage. */
  onOpenCard: (note: CompanionNote) => void;
  /** The log's scroller, for the station's scroll memory on the page. Absent on a fixture, which remembers nothing. */
  scrollRef?: (node: HTMLElement | null) => void;
};

/**
 * HER CONVERSATION, under her head in her column: her exchange with him as her panel draws it (`CompanionLog`, through the
 * companion's barrel), with her cards standing in it where she put them.
 *
 * - LOADING, before her picture's first read lands: her panel's waiting row, the kit's spinner over "Opening Kaylee's
 *   conversation…" (her head's status line says Loading… meanwhile).
 * - FAILED, a read that failed with no picture to show: her panel's warn `Banner`, "Couldn't open Kaylee's conversation:
 *   <the reason>", and Try again, since the picture is not coming by itself.
 * - HER LOG: his lines on the right, her paragraphs on the left, the house's alerts and her harness's lines in their tones, the
 *   sentence she is speaking marked as it plays; before her first hello the empty state that says what she is for. It follows
 *   the newest line until he scrolls up, and "Newest" brings him back: the log's own (`useFollowNewest`). HER CARDS stand in it
 *   as chips (`cards`): each its kind's glyph and word, its title on one line and a pin when pinned, named "Open <title> on the
 *   stage"; a press is `onOpenCard`. A card taken down leaves the log with it.
 *
 * In her column (wide, laptop) it takes the room her head, the dock and the talk control leave, down to the shell's 3.5rem
 * floor, and scrolls inside. In the narrow stack, which scrolls as one, it is a window of its own height (60% of the screen,
 * at most 32rem), the same in every state, so the stack does not jump when her picture lands; her log scrolls inside it.
 *
 * `data-station-conversation` reads the state. A pure view: `StationConversation` below binds it, and
 * `.verify/kaylee-station-shots.mjs` draws it on `fake/conversation.ts`'s pictures.
 */
export function StationConversationView({ tier, picture, readFailure, onReread, name, speaking, onOpenCard, scrollRef }: StationConversationViewProps) {
  const { t } = useTranslation();
  const state: ConversationState = picture !== null ? 'log' : readFailure !== null ? 'failed' : 'loading';

  return (
    <div
      data-station-conversation={state}
      className={cn('flex min-h-0 min-w-0 flex-col bg-background', tier === 'narrow' ? 'h-[min(32rem,60dvh)]' : 'flex-1')}
    >
      {picture !== null ? (
        <CompanionLog
          entries={picture.log}
          name={name}
          turnId={picture.turnId}
          visible
          speaking={speaking}
          cards={{ notes: picture.notes, onOpen: onOpenCard }}
          scrollRef={scrollRef}
        />
      ) : readFailure !== null ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <Banner
            tone="warn"
            action={
              <Button variant="outline" size="sm" data-station-conversation-retry="" className="max-md:h-11" onClick={onReread}>
                {t('companion.panel.retry')}
              </Button>
            }
          >
            {t('companion.panel.readFailed', { name, reason: readFailure })}
          </Banner>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
          <Spinner size={28} label={t('companion.panel.loading', { name })} />
        </div>
      )}
    </div>
  );
}

/**
 * Her conversation on the page, the `conversation` slot's region (`stationRegions.ts`): it hands `StationConversationView` her
 * picture, the read's failure and its Try again, the sentence her voice is sounding, a card's press, and the log's scroller to
 * the station's scroll memory. It adds no state of its own.
 */
export function StationConversation({ tier }: StationRegionProps) {
  const { t } = useTranslation();
  const { picture, readFailure, reread, voice } = useCompanion();
  // The stage a card's press puts it on, and the log's place: `scrollMemory('conversation')` keeps its identity across renders, so the scroller is bound once.
  const { setFocus, scrollMemory } = useStation();
  const name = picture?.settings.name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });

  return (
    <StationConversationView
      tier={tier}
      picture={picture}
      readFailure={readFailure}
      onReread={reread}
      name={name}
      speaking={voice.speaking}
      // The `note` stage (`NoteStage`, `STAGE_VIEWS`) draws the card this puts in focus.
      onOpenCard={(note) => setFocus({ kind: 'note', id: note.id, label: note.title })}
      scrollRef={scrollMemory('conversation')}
    />
  );
}
