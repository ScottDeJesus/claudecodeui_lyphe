import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { FollowupsContext, FollowupsWidgetBody, useFollowups } from '@/modules/followups';
import { StageGone } from '@/modules/station/FocusFallback';
import { useOpenChatInCloudcli } from '@/modules/station/hooks/useOpenChatInCloudcli';
import type { StationFocus } from '@/shared/station-types';
import { Button, Card } from '@/shared/ui';

/** A chat's open follow-ups on the stage. */
type FollowupsFocus = Extract<StationFocus, { kind: 'followups' }>;

/** One chat's follow-ups as the followups module reads them: its items (null until read), whether it could not be, its open count, its re-read and its tick. */
type FollowupsReading = ReturnType<typeof useFollowups>;

type FollowupsStageViewProps = {
  focus: FollowupsFocus;
  /** The chat's follow-ups as `useFollowups(sessionId)` keeps them, handed to the module's own body through its context. */
  reading: FollowupsReading;
  /** "Open the chat": the chat in CloudCLI, where its Next steps widget stands beside it. */
  onOpenChat: () => void;
};

/**
 * A CHAT'S FOLLOW-UPS ON THE STAGE, drawn by their owner and never redrawn here: the followups module's own Next steps body
 * (`FollowupsWidgetBody`) in a card, under its own context (`FollowupsContext`), so the station lists them, ticks one off and
 * gives one back exactly as the chat's gutter does — its groups ("Next steps", "Known gaps"), its Done fold, its reading and
 * its could-not-read states with Try again are its own. Then "Open the chat".
 *
 * GONE once the chat has none left open: its kind's line, "<chat> has no open follow-ups now", where the list stood, with
 * "Open the chat" still under it (the chat's own widget keeps the Done fold, where an item ticked by mistake comes back).
 *
 * The list's card is the keyboard's landing from the rail's Open (`data-station-fire`, a region that takes the focus, so Tab
 * walks into its ticks); with nothing open, "Open the chat" is. Every tick, the Done fold and "Open the chat" are 44 px catches
 * under a finger below 768 px (the touch law; the ticks and the fold are the followups module's, sized there).
 *
 * A pure view: `FollowupsStage` below binds it. Drawn on the stage for a `followups` focus once `stageViews.ts` registers it
 * (`live`), and by `.verify/kaylee-station-shots.mjs` on its fixture (`fake/needs.ts`).
 */
export function FollowupsStageView({ focus, reading, onOpenChat }: FollowupsStageViewProps) {
  const { t } = useTranslation();
  // Read, and nothing open: the chat's follow-ups have all been settled since the rail offered them.
  const gone = reading.items !== null && reading.openCount === 0;

  return (
    <div data-station-followups={gone ? 'gone' : 'open'} className="flex min-w-0 flex-col gap-3">
      {gone ? (
        <StageGone focus={focus} />
      ) : (
        <Card
          role="region"
          aria-label={t('station.needs.followups.list', { chat: focus.label, defaultValue: '{{chat}}’s follow-ups' })}
          tabIndex={-1}
          data-station-fire=""
          className="min-w-0 p-4 lg:p-5"
        >
          <FollowupsContext.Provider value={reading}>
            <FollowupsWidgetBody />
          </FollowupsContext.Provider>
        </Card>
      )}
      <Button
        variant="outline"
        size="sm"
        data-station-followups-open=""
        data-station-fire={gone ? '' : undefined}
        className="self-start max-md:h-11"
        onClick={onOpenChat}
      >
        {t('station.needs.openChat', 'Open the chat')}
        <ArrowUpRight aria-hidden="true" />
      </Button>
    </div>
  );
}

/**
 * The follow-ups' stage on the page: registered for the `followups` kind in `stageViews.ts`, drawn by `StationStage`. It reads
 * the chat's follow-ups through the followups module (`useFollowups`, kept on `followups_changed`, ticks and all) and hands them
 * to `FollowupsStageView`. The stage is keyed by its focus, so one chat's reading never draws under another.
 */
export function FollowupsStage({ focus }: { focus: FollowupsFocus }) {
  const reading = useFollowups(focus.sessionId);
  const openChat = useOpenChatInCloudcli();

  return <FollowupsStageView focus={focus} reading={reading} onOpenChat={() => openChat(focus.sessionId)} />;
}
