import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DashboardHunterNights } from '@/modules/kanban/dashboard/DashboardHunterNights';
import { DashboardHunterSkips } from '@/modules/kanban/dashboard/DashboardHunterSkips';
import type { BugDashboardPart, HuntHunter, HuntProjectStanding, HuntSkippedUnit, HuntStatus, Tone } from '@/shared/types';
import { Badge, Banner, Button, ConfirmDialog, EmptyState, Rule, SignalLoop } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';

/**
 * THE BUG HUNTERS: what is being hunted tonight, and how far each hunter has got through each project.
 *
 * ONE ANSWER FIRST: tonight's line. A hunter is out now and when it winds down; or which hunter takes which project
 * next, and when; or that nightly hunting is off. Beside it, the two presses that act on a night: `Run a night now`,
 * and `Stop tonight's hunt` only while a night is open (while one is, a second run would change nothing, so that
 * press waits). Under the line, one quiet sentence on the newest night: what it has used, or how it ended, in the
 * dispatcher's own words. That sentence stops being quiet in one case: the night closed with two of its sittings
 * failed, which is the dispatcher's rule for giving a night up, and then it is said in amber with its mark.
 * A press that did not do what was asked, refused or answered with nothing opened, says the dispatcher's sentence
 * directly under them. While a night is open the quiet sentence says why `Run a night now` waits, and while nightly
 * hunting is off it says where it is switched on.
 *
 * STOPPING A NIGHT IS ASKED ONCE. A stopped night cannot be opened again until the next date, and no undo exists, so
 * the press opens the kit's question, which says what stopping does: the hunter finishes what it has in hand, and
 * tonight is over.
 *
 * THEN ONE GROUP FOR EACH HUNTER, under its Rule (its name, and the soul that wears it at the line's end), and ONE ROW
 * FOR EACH PROJECT. A project being hunted reads left to right as it is asked: which project and where it stands (a
 * word), then the pass as ONE ring with its three measures in words beside it (covered, skipped, not reached, each with
 * the unit's word); then what the hunt has cost and found: about how many nights are left, tickets and proposals filed,
 * and how its last night ended.
 *
 * ONLY COVERED IS PROGRESS. Round the ring covered is the green (finished is green), skipped the neutral grey and not
 * reached the bare track: work nobody has done must not read as work done. A skip is routine and lasting, so it wears no
 * amber: its reasons are the table below, and amber in this section is kept for the two things that ask to be looked
 * at, a project that could not be mapped and a night given up.
 *
 * A PROJECT THAT COULD NOT BE MAPPED SAYS WHY AND DRAWS NO RING. One with nothing to hunt (not started, nothing of the
 * hunter's kind, no database named) is one quiet line: a ring at zero would claim a pass that does not exist.
 *
 * A PART THAT DID NOT ANSWER BLANKS THE SECTION. When the house's `hunt status` refused, the section says its
 * sentence and draws nothing under it: no line, no bar, no table.
 *
 * IT COMPOSES, IT DOES NOT BUILD, and fetches nothing: its part of the answer and its acts are handed to it.
 */

type DashboardHuntersProps = {
  /** `dispatcher hunt status`, or the sentence of the read that did not answer. */
  hunts: BugDashboardPart<HuntStatus>;
  /** Which of the night's two presses is out, and the dispatcher's sentence for a press that did not do what was asked: a refusal, or an answer that says nothing was opened or closed. */
  night: { busy: 'run' | 'stop' | null; sentence: string | null };
  /** The skipped unit whose `Hunt it again` is out, and the dispatcher's sentence for the one it refused. */
  reopen: { busy: HuntSkippedUnit | null; refusal: { unit: HuntSkippedUnit; sentence: string } | null };
  onRunNight: () => void;
  onStopNight: () => void;
  onHuntAgain: (unit: HuntSkippedUnit) => void;
};

/** The tone of each standing's word. Only a project that could not be mapped asks to be looked at. */
const STATE_TONES: Record<HuntProjectStanding['state'], Tone> = {
  'not started': 'neutral',
  hunting: 'info',
  done: 'positive',
  'could not be mapped': 'warn',
  'nothing of its kind': 'neutral',
  'no database named': 'neutral',
};


/** A soul's slug as its name: `argus` is Argus. */
const soulName = (soul: string) => soul.charAt(0).toUpperCase() + soul.slice(1);

/** The ring's radius and its length, in its own 48-unit square. */
const RING_R = 20;
const RING_LENGTH = 2 * Math.PI * RING_R;

/**
 * ONE PROJECT'S PASS AS A RING: from twelve o'clock, what is covered in the green, then what was skipped in the grey, and the rest
 * of the ring the track (not reached). Its figure is the share covered. It is a meter for assistive tech, which hears all three
 * in words.
 */
function PassRing({ standing, unit }: { standing: HuntProjectStanding; unit: string }) {
  const { t } = useTranslation();
  const total = Math.max(0, standing.total);
  const covered = total > 0 ? standing.covered / total : 0;
  const skipped = total > 0 ? standing.skipped / total : 0;
  const words = (['covered', 'skipped', 'open'] as const)
    .map((key) => `${t(`kanban.dashboard.hunters.parts.${key}`)} ${standing[key].toLocaleString()}`)
    .join(', ');
  return (
    <span
      role="meter"
      aria-label={t('kanban.dashboard.hunters.pass', { pass: standing.pass ?? 1, total: total.toLocaleString(), unit })}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(covered * 100)}
      aria-valuetext={`${words} ${unit}`}
      className="relative grid size-14 shrink-0 place-items-center"
    >
      <svg viewBox="0 0 48 48" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle cx="24" cy="24" r={RING_R} fill="none" stroke="var(--track)" strokeWidth="3" />
        {skipped > 0 && (
          <circle cx="24" cy="24" r={RING_R} fill="none" stroke="var(--neutral-dot)" strokeWidth="3"
            strokeDasharray={`${skipped * RING_LENGTH} ${RING_LENGTH}`} strokeDashoffset={-covered * RING_LENGTH} />
        )}
        {covered > 0 && (
          <circle cx="24" cy="24" r={RING_R} fill="none" stroke="var(--pos-dot)" strokeWidth="3" strokeDasharray={`${covered * RING_LENGTH} ${RING_LENGTH}`} />
        )}
      </svg>
      <span className="relative font-mono text-[11px] tabular-nums text-foreground">{total > 0 ? `${Math.round(covered * 100)}%` : '—'}</span>
    </span>
  );
}

/** One project's row in a hunter's group: its standing as a word, and its pass as a ring and three figures while it has one. */
function ProjectStanding({ standing }: { standing: HuntProjectStanding }) {
  const { t } = useTranslation();
  const unit = t(`kanban.dashboard.hunters.units.${standing.unit_word}`);

  const head = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="break-words text-sm font-medium text-foreground">{standing.name}</span>
      <Badge as="span" tone={STATE_TONES[standing.state]} className="vv-badge--compact">{t(`kanban.dashboard.hunters.state.${standing.state}`)}</Badge>
    </div>
  );

  if (standing.state === 'could not be mapped') {
    return (
      <li className="flex flex-col gap-2 py-3" data-hunter-project={standing.name} data-hunter-state={standing.state}>
        {head}
        <Banner tone="warn">
          {standing.cause === null
            ? t('kanban.dashboard.hunters.notMappedNoCause', { project: standing.name })
            : t('kanban.dashboard.hunters.notMapped', { project: standing.name, cause: standing.cause })}
        </Banner>
      </li>
    );
  }

  if (standing.state !== 'hunting' && standing.state !== 'done') {
    return (
      <li className="flex flex-col gap-1 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3" data-hunter-project={standing.name} data-hunter-state={standing.state}>
        {head}
        <span className="text-xs text-muted-foreground">{t(`kanban.dashboard.hunters.quiet.${standing.state}`)}</span>
      </li>
    );
  }

  /** One of the three measures, in words: its name and its figure, in the unit the pass counts. */
  const part = (key: 'covered' | 'skipped' | 'open') => (
    <div className="flex items-baseline gap-2" data-hunter-part={key}>
      <dt className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t(`kanban.dashboard.hunters.parts.${key}`)}</dt>
      <dd className="font-mono text-sm tabular-nums text-foreground">
        {standing[key].toLocaleString()} <span className="text-xs text-muted-foreground">{unit}</span>
      </dd>
    </div>
  );

  return (
    <li
      className="grid gap-x-8 gap-y-3 py-4 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,15rem)] lg:items-start"
      data-hunter-project={standing.name}
      data-hunter-state={standing.state}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {head}
        <span className="text-xs text-muted-foreground">
          {t('kanban.dashboard.hunters.pass', { pass: standing.pass ?? 1, total: standing.total.toLocaleString(), unit })}
        </span>
      </div>

      {/* The pass as one object: a ring covered in the green (finished is green), skipped in the grey, the rest not reached, and
          its three figures in words beside it. */}
      <div className="flex items-center gap-4" data-hunter-parts>
        <PassRing standing={standing} unit={unit} />
        <dl className="flex flex-col gap-1">
          {part('covered')}
          {part('skipped')}
          {part('open')}
        </dl>
      </div>

      <div className="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground">
        {standing.state === 'hunting' && standing.nights_left !== null && standing.nights_left > 0 && (
          <span className="text-sm font-medium text-foreground" data-hunter-nights-left={standing.nights_left}>
            {t('kanban.dashboard.hunters.nightsLeft', { count: standing.nights_left })}
          </span>
        )}
        <span>
          {t('kanban.dashboard.hunters.filed', {
            tickets: t('kanban.dashboard.hunters.tickets', { count: standing.tickets }),
            proposals: t('kanban.dashboard.hunters.proposals', { count: standing.proposals }),
          })}
        </span>
        <span className="break-words">
          {standing.last === null
            ? t('kanban.dashboard.hunters.neverHunted')
            : t('kanban.dashboard.hunters.last', {
                date: formatShortDate(standing.last.night) ?? standing.last.night,
                outcome: t(`kanban.dashboard.hunters.outcome.${standing.last.outcome}`, { defaultValue: standing.last.outcome }),
              })}
        </span>
      </div>
    </li>
  );
}

/** One hunter's group: its name, the soul that wears it, whether it takes a turn, and its projects. */
function HunterGroup({ hunter }: { hunter: HuntHunter }) {
  const { t } = useTranslation();
  const headingId = useId();
  return (
    <div className="flex flex-col" role="group" aria-labelledby={headingId} data-hunter={hunter.hunt}>
      <Rule
        id={headingId}
        level={4}
        end={
          <>
            <span className="normal-case tracking-normal">{t('kanban.dashboard.hunters.soul', { soul: soulName(hunter.soul) })}</span>
            {!hunter.runs && <Badge as="span" tone="neutral" className="vv-badge--compact">{t('kanban.dashboard.hunters.notRunning')}</Badge>}
          </>
        }
      >
        {t(`kanban.dashboard.hunters.name.${hunter.hunt}`, { defaultValue: hunter.hunt })}
      </Rule>
      {hunter.projects.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">{t('kanban.dashboard.hunters.noProjects')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--hairline)]">
          {hunter.projects.map((standing) => <ProjectStanding key={standing.project} standing={standing} />)}
        </ul>
      )}
    </div>
  );
}

/** Rendered by BugDashboard, after the regression cases. Nothing else mounts it. */
export function DashboardHunters({ hunts, night, reopen, onRunNight, onStopNight, onHuntAgain }: DashboardHuntersProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const nightId = useId();
  // The night the question before stopping was asked of, by its date, or `null`: a stopped night cannot be opened again
  // tonight. A date and not a yes: a question left standing when its night closes is never asked of the next night.
  const [stopAsked, setStopAsked] = useState<string | null>(null);
  const heading = <Rule id={headingId}>{t('kanban.dashboard.hunters.title')}</Rule>;

  if (!hunts.ok) {
    return (
      <section className="flex flex-col gap-3" aria-labelledby={headingId} data-dashboard-hunters="unread">
        {heading}
        <Banner tone="warn">{t('kanban.dashboard.hunters.failed', { error: hunts.error })}</Banner>
      </section>
    );
  }

  const status = hunts.value;
  const nightOpen = status.night !== null && status.night.state === 'open';
  const hunterWord = (hunt: string) => t(`kanban.dashboard.hunters.kind.${hunt}`, { defaultValue: hunt });
  // A sitting, a turn and a skip name a project by its folder; a person is told its name, or the folder's last word when no hunter lists it.
  const names = new Map(status.hunts.flatMap((hunter) => hunter.projects.map((standing) => [standing.project, standing.name] as const)));
  const nameOf = (project: string) => names.get(project) ?? project.split('/').filter(Boolean).pop() ?? project;
  /** An instant as the reader's own clock says it, in the 24 hours the night's start is written in: `02:30`. */
  const clock = (stamp: string) => {
    const at = new Date(stamp);
    return Number.isNaN(at.getTime()) ? '—' : at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  };
  // The dispatcher gives a night up when two of its sittings have failed: the one ending of a night that asks to be looked at.
  const nightGivenUp =
    status.night !== null && !nightOpen && status.sittings.filter((sitting) => sitting.night === status.night?.night && sitting.outcome === 'failed').length >= 2;

  /** Tonight's line, and which of its wordings it is. */
  const tonight = (): { mode: 'hunting' | 'next' | 'nothing' | 'off'; words: string } => {
    const { sitting, next } = status;
    if (sitting !== null) {
      return { mode: 'hunting', words: t('kanban.dashboard.hunters.tonight.hunting', { hunter: hunterWord(sitting.hunt), project: nameOf(sitting.project), time: clock(sitting.deadline) }) };
    }
    if (!nightOpen && !status.nightly) return { mode: 'off', words: t('kanban.dashboard.hunters.tonight.off') };
    if (next === null) return { mode: 'nothing', words: t('kanban.dashboard.hunters.tonight.nothingNext') };
    const turn = { hunter: hunterWord(next.hunt), project: nameOf(next.project) };
    // A night already open takes its next turn at once; one not yet open waits for the start Settings holds.
    return { mode: 'next', words: nightOpen ? t('kanban.dashboard.hunters.tonight.nextNow', turn) : t('kanban.dashboard.hunters.tonight.next', { ...turn, time: status.start }) };
  };
  const line = tonight();

  /** The newest night, in one quiet sentence. */
  const nightWords = () => {
    if (status.night === null) return t('kanban.dashboard.hunters.tonight.noNight');
    if (nightOpen) return t('kanban.dashboard.hunters.tonight.nightOpen', { used: status.night.minutes_used.toLocaleString() });
    return t('kanban.dashboard.hunters.tonight.nightClosed', {
      date: formatShortDate(status.night.night) ?? status.night.night,
      used: status.night.minutes_used.toLocaleString(),
      why: status.night.why ?? t('kanban.dashboard.unknown'),
    });
  };

  return (
    <section className="flex flex-col gap-6" aria-labelledby={headingId} data-dashboard-hunters="read">
      {heading}

      <div className="flex flex-col gap-3" data-hunters-tonight={line.mode}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="flex items-start gap-2 text-base font-medium leading-snug text-foreground">
              {line.mode === 'hunting' && <SignalLoop state="working" size={16} className="mt-[3px] shrink-0" />}
              <span className="min-w-0 break-words">{line.words}</span>
            </p>
            {!nightGivenUp && <p id={nightId} className="text-xs text-muted-foreground" data-hunters-night>{nightWords()}</p>}
            {line.mode === 'off' && <p className="text-xs text-muted-foreground">{t('kanban.dashboard.hunters.tonight.offWhere')}</p>}
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="finger:h-11" busy={night.busy === 'run'} disabled={nightOpen} aria-describedby={nightOpen ? nightId : undefined} onClick={onRunNight} data-hunters-press="run">
              {t('kanban.dashboard.hunters.tonight.run')}
            </Button>
            {nightOpen && (
              // On a phone the press that can act stands above the one that waits. It opens the question; the question's answer stops the night.
              <Button variant="outline" className="order-first finger:h-11 sm:order-none" busy={night.busy === 'stop'} onClick={() => setStopAsked(status.night?.night ?? null)} data-hunters-press="stop">
                {t('kanban.dashboard.hunters.tonight.stop')}
              </Button>
            )}
          </div>
        </div>
        {nightGivenUp && <div data-hunters-night="given-up"><Banner tone="warn">{nightWords()}</Banner></div>}
        {night.sentence !== null && <div data-hunters-night-said><Banner tone="warn">{night.sentence}</Banner></div>}
      </div>

      <ConfirmDialog
        open={nightOpen && stopAsked !== null && stopAsked === status.night?.night}
        title={t('kanban.dashboard.hunters.stopDialog.title')}
        message={t('kanban.dashboard.hunters.stopDialog.message')}
        actions={[
          { label: t('kanban.dashboard.hunters.stopDialog.cancel'), variant: 'ghost', onSelect: () => setStopAsked(null) },
          { label: t('kanban.dashboard.hunters.stopDialog.confirm'), variant: 'default', onSelect: () => { setStopAsked(null); onStopNight(); } },
        ]}
        onDismiss={() => setStopAsked(null)}
      />

      {status.hunts.length === 0 ? (
        <EmptyState size="sm" title={t('kanban.dashboard.hunters.noHunters')} />
      ) : (
        <div className="flex flex-col gap-6">
          {status.hunts.map((hunter) => <HunterGroup key={hunter.hunt} hunter={hunter} />)}
        </div>
      )}

      {/* The sittings are bounded at twenty and the skips only grow, so the bounded table stands first. */}
      <DashboardHunterNights sittings={status.sittings} hunterWord={hunterWord} nameOf={nameOf} />
      <DashboardHunterSkips skipped={status.skipped} hunterWord={hunterWord} nameOf={nameOf} reopen={reopen} onHuntAgain={onHuntAgain} />
    </section>
  );
}
