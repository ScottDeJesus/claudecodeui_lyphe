import { useTranslation } from 'react-i18next';

import { STATION_FOCUS_GLYPHS } from '@/shared/constants';
import type { StationFocus, StationFocusKind } from '@/shared/station-types';
import { Banner, Button, EmptyState } from '@/shared/ui';

/** The kinds a "no longer here" line is written for: every kind but a page, which is a link DocSpace answers for itself. */
type GoneFocus = Exclude<StationFocus, { kind: 'page' }>;

/**
 * Each kind's "no longer here" line: what the stage says of a thing that has gone while it stood there (a chat
 * deleted, an ask answered elsewhere, a check no longer red, her card put away, her walk ended). The label is the
 * focus's own, where the line names it. A page has none: the stage holds a link to it and DocSpace's own page says
 * when it is gone.
 */
const GONE_LINES: Record<GoneFocus['kind'], string> = {
  chat: 'This session is no longer in your list.',
  card: '{{label}} is no longer on the roadmap',
  ask: 'That ask was answered elsewhere.',
  followups: '{{label}} has no open follow-ups now',
  check: '{{label}} is no longer red',
  note: '{{label}} was taken down',
  walk: 'The walkthrough ended',
};

/**
 * A thing that has gone, said in its kind's own line beside its kind's glyph, where its view stood: the stage keeps
 * the head (its label, Back and ✕) and says why nothing is under it. Used by `CardStageView`, for a
 * feature or epic neither the dispatcher nor the roadmap holds any more, by the right rail's three stages
 * (`AskStageView`, `FollowupsStageView`, `CheckStageView`) for an ask answered elsewhere, a chat with no follow-ups
 * left and a check no longer red, by the chat's stage (`ChatStageView`) for a chat his sessions no longer hold, and by
 * her cards' two stages (`NoteStageView`, `WalkStageView`) for a card taken down and a walk ended.
 */
export function StageGone({ focus }: { focus: GoneFocus }) {
  const { t } = useTranslation();
  return (
    <div data-station-gone={focus.kind}>
      <EmptyState
        icon={STATION_FOCUS_GLYPHS[focus.kind].icon}
        title={t(`station.gone.${focus.kind}`, { label: focus.label, defaultValue: GONE_LINES[focus.kind] })}
      />
    </div>
  );
}

/**
 * A read of what a stage draws that did not land: her picture, for her cards' two stages. It says so in a sentence of the page's
 * own (`title`) with a Try again (`onRetry`, a 44 px catch under a finger below 768 px), where the stage's quiet "Reading…"
 * would otherwise wait for ever on a picture that is not coming. The raw reason is not drawn: it is the browser's words for a
 * dropped connection as often as the server's, and it is already in the console. Used by `NoteStageView` and `WalkStageView`.
 */
export function StageReadFailed({ kind, title, onRetry }: { kind: StationFocusKind; title: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" data-station-read-failed={kind}>
      <Banner
        tone="warn"
        action={(
          <Button variant="tonal" size="sm" className="h-8 flex-none px-2.5 text-xs finger:h-11" onClick={onRetry}>
            {t('station.cards.retry', { defaultValue: 'Try again' })}
          </Button>
        )}
      >
        <p className="break-words text-sm font-medium">{title}</p>
      </Banner>
    </div>
  );
}
