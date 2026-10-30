import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useCompanion } from '@/modules/companion';
import { useStation } from '@/modules/station/context/StationContext';
import { openInCloudcli } from '@/shared/cloudcliDoors';
import { RUNNER_LANDING_PARAM, STATION_FOCUS_GLYPHS } from '@/shared/constants';
import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import type { StationFocus, StationFocusKind } from '@/shared/station-types';
import { Button, Card, EmptyState } from '@/shared/ui';

/**
 * Each kind's "no longer here" line: what the stage says of a thing that has gone while it stood there (a chat
 * deleted, an ask answered elsewhere, a check no longer red, her card put away, her walk ended). The label is the
 * focus's own, where the line names it.
 */
const GONE_LINES: Record<StationFocusKind, string> = {
  chat: 'This session is no longer in your list.',
  card: '{{label}} is no longer on the roadmap',
  ask: 'That ask was answered elsewhere.',
  followups: '{{label}} has no open follow-ups now',
  check: '{{label}} is no longer red',
  note: '{{label}} was taken down',
  walk: 'The walkthrough ended',
  page: '{{label}} is no longer in DocSpace',
};

/**
 * A thing that has gone, said in its kind's own line beside its kind's glyph, where its view stood: the stage keeps
 * the head (its label, Back and ✕) and says why nothing is under it. Used by this file's `FocusFallbackView`, by
 * `CardStageView` (this module), for a feature or epic neither the dispatcher nor the roadmap holds any more, and by
 * the right rail's three stages (`AskStageView`, `FollowupsStageView`, `CheckStageView`) for an ask answered
 * elsewhere, a chat with no follow-ups left and a check no longer red, by the chat's stage (`ChatStageView`) for a
 * chat his sessions no longer hold, and by her cards' two stages (`NoteStageView`, `WalkStageView`) for a card taken
 * down and a walk ended.
 */
export function StageGone({ focus }: { focus: StationFocus }) {
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

/** Why the station shows this kind in its fallback: no view of the kind has landed on the stage yet. */
const WHY_LINES: Record<StationFocusKind, string> = {
  chat: 'The station has no view of a chat yet.',
  card: 'The station has no view of this card yet.',
  ask: 'The station has no view of a waiting ask yet.',
  followups: 'The station has no view of follow-ups yet.',
  check: 'The station has no view of a check yet.',
  note: 'The station has no view of her cards yet.',
  walk: 'The station has no view of her walkthrough yet.',
  page: 'The station has no view of a page yet.',
};

/** The press's words: where it leads in CloudCLI, which is where the thing is drawn today. */
const OPEN_LINES: Record<StationFocusKind, string> = {
  chat: 'Open the chat in CloudCLI',
  card: 'Open its card in the Runner',
  ask: 'Open the chat it waits in',
  followups: 'Open the chat in CloudCLI',
  check: 'Open CloudCLI',
  note: 'Open CloudCLI',
  walk: 'Open CloudCLI',
  page: 'Open CloudCLI',
};

/**
 * Where a focus is in CloudCLI, as a path under its router: the chat for a chat, and for an ask or follow-ups the
 * chat they belong to; the plan's card in the Runner for a card (the workspace's `?runner=` landing); CloudCLI's
 * home for the rest, which it draws in its own views (Cerberus's checks, her cards and her walkthrough in her panel).
 */
function cloudcliPathOf(focus: StationFocus): string {
  switch (focus.kind) {
    case 'chat':
    case 'ask':
    case 'followups':
      return `/session/${encodeURIComponent(focus.sessionId)}`;
    case 'card':
      return `/?${new URLSearchParams({ [RUNNER_LANDING_PARAM]: focus.plan })}`;
    default:
      return '/';
  }
}

type FocusFallbackViewProps = {
  focus: StationFocus;
  /** The thing has gone: its kind's "no longer here" line stands in its place. */
  gone: boolean;
  /** The press, handed the thing's path in CloudCLI (`/session/<id>`, `/?runner=<plan>`, `/`). */
  onOpen: (path: string) => void;
};

/**
 * THE STAGE'S FALLBACK: what a kind draws until its plan registers its own view — never a blank. The stage's head
 * already names the thing (its kind's glyph and word over its label), so the body says the rest once: a card with the
 * kind's glyph, a line saying in words that the station has no view of this kind yet, and the way to it in CloudCLI —
 * the chat for a chat, an ask or follow-ups, the plan's card in the Runner for a card, CloudCLI itself for the rest.
 * The press is a 44 px catch under a finger below 768 px (the touch law).
 *
 * A thing that has gone draws its kind's "no longer here" line (`StageGone`) instead.
 *
 * A pure view: `FocusFallback` below binds it. Drawn on the stage by `StationStage` for every kind `STAGE_VIEWS`
 * holds no view of, and by `.verify/kaylee-station-shots.mjs` for the `walkthrough` picture's walk.
 */
export function FocusFallbackView({ focus, gone, onOpen }: FocusFallbackViewProps) {
  const { t } = useTranslation();
  if (gone) return <StageGone focus={focus} />;

  const KindIcon = STATION_FOCUS_GLYPHS[focus.kind].icon;
  return (
    <Card data-station-fallback={focus.kind} className="flex min-w-0 flex-col gap-4 p-4 lg:p-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <KindIcon aria-hidden="true" className="size-4" />
        </span>
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {t(`station.fallback.why.${focus.kind}`, { defaultValue: WHY_LINES[focus.kind] })}
        </p>
      </div>
      <Button
        variant="outline"
        data-station-fallback-open=""
        className="self-start max-md:h-11"
        onClick={() => onOpen(cloudcliPathOf(focus))}
      >
        {t(`station.fallback.open.${focus.kind}`, { defaultValue: OPEN_LINES[focus.kind] })}
        <ArrowUpRight aria-hidden="true" />
      </Button>
    </Card>
  );
}

/**
 * The fallback on the page: what `StationStage` draws for a focus whose kind has no view registered. It reads whether
 * the thing is still there and binds the press, and hands them to `FocusFallbackView`.
 */
export function FocusFallback({ focus }: { focus: StationFocus }) {
  const navigate = useNavigate();
  const { phone } = useStation();
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const { picture } = useCompanion();

  // Whether the thing has gone, for the kinds the station holds a reader of: her walk and her cards, in her picture. A
  // picture not yet read says nothing of either, and every other kind has no reader here yet, so none is called gone.
  const gone = picture !== null && (
    (focus.kind === 'walk' && picture.walk === null)
    || (focus.kind === 'note' && !picture.notes.some((note) => note.id === focus.id))
  );

  return (
    <FocusFallbackView
      focus={focus}
      gone={gone}
      onOpen={(path) => openInCloudcli(path, navigate, { phone, pwa: isPWA })}
    />
  );
}
