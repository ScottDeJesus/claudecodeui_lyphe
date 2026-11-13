import { useTranslation } from 'react-i18next';

import type { UploadsPillKey, UploadsRead, UploadsTally } from '@/modules/upload-runs/utils/uploadsModel';
import { agoWord, verdictLook, whoWord } from '@/modules/upload-runs/utils/uploadsWords';
import type { Tone } from '@/shared/types';
import { Badge, Pill, PillBar } from '@/shared/ui';
import { cn } from '@/shared/utils';

type UploadsPillsProps = {
  /** The window's armed runs, counted. */
  tally: UploadsTally;
  /** The window held more runs than one answer carries, so the count is a floor. */
  truncated: boolean;
  /** Whether a run is live, and if so whether it works or waits on a person; null with none. */
  live: 'working' | 'waiting' | null;
  /** The heals that claimed this window's friction; null while the heal answer is out or could not be read. */
  healed: UploadsRead['healed'];
  /** The heal answer could not be read: the Healed pill says so, and never reads as "none". */
  frictionFailed: boolean;
  /** The clock the last run's age is counted from, epoch ms. */
  now: number;
  /** Per pill, whether the section it carries the reader to is on the page: Live now's only while a run is live, none of them on an empty window. */
  canGo: Record<UploadsPillKey, boolean>;
  /** The pill last pressed, whose section the reader was carried to; null until one is. */
  activePill: UploadsPillKey | null;
  onSelect: (key: UploadsPillKey) => void;
};

/** `wrap` marks a value that is a phrase: it may break across lines on a phone, where a fixed pill would run off the edge. */
type PillSpec = { key: UploadsPillKey; label: string; value: string; tone: Tone; title: string; wrap?: boolean };

/**
 * THE VIEW'S VITALS, five pills in the heal tab's grammar: a label and a figure in the tone that says whether to look.
 * Runs is the window's count. Hiccups is amber above none and green at none (grey when the window holds no run at all,
 * since nothing ran clean either). Live now is blue while a run works, amber
 * while it waits on a person, quiet otherwise. Last run is its age and who pressed, in its verdict's tone. Healed is the
 * heals that claimed this window's friction, landed and still running.
 *
 * EACH PILL IS A PRESS that carries the reader to the section its figure counted. A phone reads all five before
 * anything scrolls: the bar wraps, since a row that scrolled sideways would hide the one figure that says "look". A pill
 * whose section is not on the page (Live now with nothing live, all five over an empty window) still shows its figure
 * and is not a press: it takes no focus and no hover, so nothing lights up that leads nowhere.
 *
 * NOT READ IS NEVER NONE. While the heal answer is out the Healed pill shows a dash, and when the ledger could not be read
 * it says "not read": a zero there would be this screen claiming nothing needed healing.
 *
 * Used by this module's root, `UploadsView`, under the head.
 */
export function UploadsPills({ tally, truncated, live, healed, frictionFailed, now, canGo, activePill, onSelect }: UploadsPillsProps) {
  const { t } = useTranslation();
  const p = 'cerberus.uploads.pills';
  const last = tally.last;

  const pills: PillSpec[] = [
    {
      key: 'runs',
      label: t(`${p}.runs`),
      value: truncated ? t(`${p}.atLeast`, { count: tally.runs }) : String(tally.runs),
      tone: 'neutral',
      title: t(`${p}.runsTitle`),
    },
    {
      key: 'hiccups',
      label: t(`${p}.hiccups`),
      // A window cut short counts the newest runs alone, so its hiccups are a floor too.
      value: truncated ? t(`${p}.atLeast`, { count: tally.hiccups }) : String(tally.hiccups),
      // Green only where there were runs to go clean: a window with none has earned no colour.
      tone: tally.hiccups > 0 ? 'warn' : tally.runs > 0 ? 'positive' : 'neutral',
      title: t(`${p}.hiccupsTitle`),
    },
    {
      key: 'live',
      label: t(`${p}.live`),
      value: live === null ? t(`${p}.liveNone`) : t(live === 'working' ? `${p}.liveWorking` : `${p}.liveWaiting`),
      tone: live === null ? 'neutral' : live === 'working' ? 'info' : 'warn',
      title: t(`${p}.liveTitle`),
      wrap: true,
    },
    {
      key: 'lastRun',
      label: t(`${p}.lastRun`),
      value: last === null ? t(`${p}.lastRunNone`) : `${agoWord(t, last.started_at, now)} · ${whoWord(t, last.generated_by)}`,
      tone: last === null ? 'neutral' : verdictLook(t, last).tone,
      title: last === null ? t(`${p}.lastRunNoneTitle`) : verdictLook(t, last).word,
      wrap: true,
    },
    {
      key: 'healed',
      label: t(`${p}.healed`),
      value: frictionFailed
        ? t(`${p}.healedUnread`)
        : healed === null
          ? '—'
          : healed.landed + healed.running === 0
            ? t(`${p}.healedNone`)
            : healed.running === 0
              ? t(`${p}.healedLanded`, { count: healed.landed })
              : t(`${p}.healedBoth`, { landed: healed.landed, running: healed.running }),
      tone: frictionFailed || healed === null || healed.landed + healed.running === 0 ? 'neutral' : healed.running > 0 ? 'info' : 'positive',
      title: frictionFailed ? t(`${p}.healedUnreadTitle`) : t(`${p}.healedTitle`),
      wrap: true,
    },
  ];

  return (
    <PillBar className="w-full flex-wrap" role="group" aria-label={t(`${p}.label`)} data-uploads-pills>
      {pills.map((pill) => (
        <Pill
          key={pill.key}
          isActive={canGo[pill.key] && activePill === pill.key}
          onClick={() => onSelect(pill.key)}
          // With nowhere to carry the reader, the pill is a figure and not a press.
          disabled={!canGo[pill.key]}
          title={pill.title}
          // A phrase-valued pill may shrink and wrap; a number-valued one keeps its one line. 44 px under a finger.
          className={cn('finger:min-h-11 disabled:pointer-events-none', pill.wrap && 'min-w-0 max-w-full shrink text-left')}
          data-uploads-pill={pill.key}
        >
          <span className="text-xs">{pill.label}</span>
          <Badge as="span" tone={pill.tone} className={pill.wrap ? 'min-w-0 whitespace-normal break-words' : undefined}>{pill.value}</Badge>
        </Pill>
      ))}
    </PillBar>
  );
}
