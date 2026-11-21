import { CloudOff } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DashboardCases } from '@/modules/kanban/dashboard/DashboardCases';
import { DashboardChangelog } from '@/modules/kanban/dashboard/DashboardChangelog';
import { DashboardFlow } from '@/modules/kanban/dashboard/DashboardFlow';
import { DashboardHunters } from '@/modules/kanban/dashboard/DashboardHunters';
import { DashboardNumbers } from '@/modules/kanban/dashboard/DashboardNumbers';
import { DashboardOldest } from '@/modules/kanban/dashboard/DashboardOldest';
import { DashboardWaysIn } from '@/modules/kanban/dashboard/DashboardWaysIn';
import { useBugDashboard } from '@/modules/kanban/dashboard/useBugDashboard';
import { plainSentence, readDispatcherAnswer } from '@/modules/kanban/utils/dispatcherAnswer';
import { api } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import type { BugDashboardView, HuntSkippedUnit } from '@/shared/types';
import { Banner, EmptyState, SegmentedControl, Spinner } from '@/shared/ui';
import { copyTextToClipboard } from '@/shared/utils';

/**
 * THE BUGS VIEW'S DASHBOARD FACE: how the board stands, in the order a person asks it. How many are open and how bad;
 * is the board keeping up; what has waited longest; where the work comes from; what the night's cases say; what the
 * bug hunters are on and how far they have got; what got fixed. Last, and only while there are any, the tickets no
 * board could take.
 *
 * TWO CONTROLS, AND THEY STAY PUT. Which boards (this one, or all) and how far back (7, 30 or 90 days), each the kit's
 * segmented control, stand at the head in every state, a spinner and a failure included, so the way to ask a different
 * question never moves. What
 * they are set to is the panel's, not this face's: it survives a visit to the Board face and a board switch.
 *
 * ONE READ, FOUR STATES. Still reading: the ring, under the controls. The route did not answer: one sentence and
 * Try again. An answer with nothing in it: every section says its own nothing. An answer: the sections. A newer
 * answer replaces the one drawn without a spinner between them, and the face says it is busy to assistive tech only.
 *
 * A PART THAT DID NOT ANSWER BLANKS ITS OWN SECTION. The board's numbers are this server's and always arrive with the
 * answer; the cases, the tickets and the hunts are the house's, and each may be a refusal. The section it feeds says
 * the refusal's sentence and draws no number; every other section stands.
 *
 * THE HUNTERS' THREE PRESSES ARE THIS FACE'S WRITES, as the changelog's copy is: the section is handed each as a
 * callback, with which one is out and the dispatcher's sentence for one that did not do what was asked, and calls no
 * route itself.
 *
 * IT READS AS ONE INSTRUMENT'S READOUT, in the design system's voice: each section under its Rule (its count or its one
 * press at the line's end), tables as rules between rows with no frame, what happened as a Trace, a card as a row that opens
 * it, each hunter's pass as a ring (`bugScreen.css`, under `.bug-dashboard`).
 *
 * IT COMPOSES, IT DOES NOT BUILD. Every piece is the kit's, and each section is a file of its own that is handed its
 * part of the answer and fetches nothing.
 */

type BugDashboardProps = {
  /** The open board: what "This board" asks about. */
  boardId: string;
  /** Which boards and how far back, kept by the panel. */
  view: BugDashboardView;
  onView: (view: BugDashboardView) => void;
  /** Opens a card on its board: the Board face, that board, that card's sheet. */
  onOpenCard: (cardId: string, boardId: string) => void;
};

/** The windows offered, in days. */
const WINDOWS: BugDashboardView['days'][] = [7, 30, 90];

/**
 * The night verbs' lines that say they did what was asked. Any other line did nothing and is said: a refusal, a
 * `hunt night` that opened nothing because last night's hunter is still out, `hunt stop` with no night open, a second
 * run on the same night. A run past a stale night prints CLOSED before OPENED, so CLOSED counts too.
 */
const NIGHT_DONE = /^(?:OPENED|CLOSED|STOPPED) night /;

/** Rendered by KanbanPanel while its face is the dashboard. Nothing else mounts it. */
export function BugDashboard({ boardId, view, onView, onOpenCard }: BugDashboardProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const allBoards = view.scope === 'all';

  const scope = allBoards ? 'all' : boardId;
  const { reading, retry } = useBugDashboard(scope, view.days);

  // The copy is the same changelog the section draws, asked as Markdown, so what lands on the clipboard is what the screen says.
  const copyChangelog = async () => {
    try {
      const response = await api.kanban.changelogMarkdown(scope);
      if (!response.ok) throw new Error(`The changelog request failed with status ${response.status}.`);
      const text = await response.text();
      const copied = await copyTextToClipboard(text);
      if (!copied) throw new Error('The clipboard refused the changelog.');
      toast({ tone: 'positive', title: t('kanban.toast.changelogCopied') });
    } catch (error) {
      console.error('Error copying the changelog:', error);
      toast({ tone: 'warn', title: t('kanban.toast.changelogNotCopied') });
    }
  };

  const copyMarkdown = () => {
    void copyChangelog();
  };

  // Shared by the three presses: a press's state lands after the next render, so without this ref a second press in that
  // gap would send the same request again.
  const out = useRef(false);
  const [huntNight, setHuntNight] = useState<{ busy: 'run' | 'stop' | null; sentence: string | null }>({ busy: null, sentence: null });
  const [huntReopen, setHuntReopen] = useState<{ busy: HuntSkippedUnit | null; refusal: { unit: HuntSkippedUnit; sentence: string } | null }>({
    busy: null,
    refusal: null,
  });

  const pressNight = async (press: 'run' | 'stop', request: () => Promise<Response>) => {
    if (out.current) return;
    out.current = true;
    setHuntNight({ busy: press, sentence: null });
    const reply = await readDispatcherAnswer(request());
    out.current = false;
    const sentence = reply.ok ? (NIGHT_DONE.test(reply.line) ? null : plainSentence(reply.line)) : (reply.sentence ?? t('kanban.notAnswered'));
    setHuntNight({ busy: null, sentence });
    if (reply.ok) {
      // The section draws the night from the answer, so it is read now rather than at the dispatcher's next frame.
      retry();
    }
  };

  const runNight = () => {
    void pressNight('run', () => api.kanban.huntNight());
  };

  const stopNight = () => {
    void pressNight('stop', () => api.kanban.huntStop());
  };

  const reopenUnit = async (unit: HuntSkippedUnit) => {
    if (out.current) return;
    // The skipped unit names its project by folder and reopen takes the config's name, so the name is looked up here. A
    // folder with no config to match goes as it is, and the dispatcher refuses it in its own words.
    let name = unit.project;
    if (reading.status === 'ready' && reading.answer.hunts.ok) {
      const hunters = reading.answer.hunts.value.hunts;
      const found = [...hunters.filter((hunter) => hunter.hunt === unit.hunt), ...hunters]
        .flatMap((hunter) => hunter.projects)
        .find((project) => project.project === unit.project);
      if (found) name = found.name;
    }

    out.current = true;
    setHuntReopen({ busy: unit, refusal: null });
    const reply = await readDispatcherAnswer(api.kanban.huntReopen({ hunt: unit.hunt, project: name, unit: unit.unit }));
    out.current = false;
    if (reply.ok) {
      setHuntReopen({ busy: null, refusal: null });
      retry();
    } else {
      setHuntReopen({ busy: null, refusal: { unit, sentence: reply.sentence ?? t('kanban.notAnswered') } });
    }
  };

  const huntAgain = (unit: HuntSkippedUnit) => {
    void reopenUnit(unit);
  };

  const body = () => {
    if (reading.status === 'loading') {
      return (
        <div className="flex justify-center py-16">
          <Spinner label={t('kanban.dashboard.loading')} />
        </div>
      );
    }

    if (reading.status === 'unreachable') {
      return (
        <EmptyState
          icon={CloudOff}
          title={t('kanban.dashboard.unreachable.title')}
          message={t('kanban.dashboard.unreachable.message')}
          actionLabel={t('kanban.dashboard.unreachable.retry')}
          onAction={retry}
        />
      );
    }

    const { stats, changelog, cases, tickets } = reading.answer;
    const unplaced = tickets.ok ? tickets.value.unplaced : [];
    const { hunts } = reading.answer;

    return (
      <>
        <DashboardNumbers stats={stats} allBoards={allBoards} onOpenCard={onOpenCard} />
        <DashboardFlow byDay={stats.byDay} days={view.days} />
        <DashboardOldest cards={stats.oldestOpen} allBoards={allBoards} onOpenCard={onOpenCard} />
        <DashboardWaysIn waysIn={stats.waysIn} tickets={tickets} days={view.days} />
        <DashboardCases cases={cases} days={view.days} onOpenCard={onOpenCard} />
        <DashboardHunters hunts={hunts} night={huntNight} reopen={huntReopen} onRunNight={runNight} onStopNight={stopNight} onHuntAgain={huntAgain} />
        <DashboardChangelog entries={changelog} allBoards={allBoards} onOpenCard={onOpenCard} onCopyMarkdown={copyMarkdown} />
        {unplaced.length > 0 && (
          <div data-dashboard-unplaced>
            <Banner tone="warn">
              <p className="font-medium">{t('kanban.dashboard.unplaced.title', { count: unplaced.length })}</p>
              <p>{t('kanban.dashboard.unplaced.about', { count: unplaced.length })}</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {unplaced.map((ticket) => (
                  <li key={ticket.id} className="flex flex-col">
                    <span className="break-words">{ticket.title}</span>
                    <span className="break-all font-mono text-xs">{ticket.path}</span>
                  </li>
                ))}
              </ul>
            </Banner>
          </div>
        )}
      </>
    );
  };

  return (
    <div
      className="bug-dashboard min-h-0 flex-1 overflow-y-auto"
      data-bug-dashboard={reading.status}
      aria-busy={reading.status === 'loading' || (reading.status === 'ready' && reading.stale)}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-9 p-4 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            label={t('kanban.dashboard.scope.label')}
            options={[
              { value: 'board', label: t('kanban.dashboard.scope.board') },
              { value: 'all', label: t('kanban.dashboard.scope.all') },
            ]}
            value={view.scope}
            onChange={(scope) => onView({ ...view, scope })}
          />
          {/* Three windows, all worth seeing at once, so a segmented control and not a list to open. */}
          <SegmentedControl
            label={t('kanban.dashboard.window.label')}
            options={WINDOWS.map((days) => ({ value: String(days), label: t('kanban.dashboard.window.short', { days, defaultValue: '{{days}} days' }) }))}
            value={String(view.days)}
            onChange={(next) => {
              const days = WINDOWS.find((candidate) => String(candidate) === next);
              if (days !== undefined) onView({ ...view, days });
            }}
          />
        </div>

        {body()}
      </div>
    </div>
  );
}
