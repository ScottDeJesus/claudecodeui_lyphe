import { Check, Plus, StickyNote } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DrawerStepStages } from '@/modules/kanban/card-drawer/DrawerStepStages';
import type { KanbanMutations } from '@/modules/kanban/hooks/useKanbanMutations';
import { flowOf, type KanbanFlow, type KanbanWalk, type KanbanWalkStage } from '@/modules/kanban/utils/walkModel';
import type { KanbanCardDetail, KanbanChecklistItem } from '@/shared/kanban-types';
import { Button, Meter, Rule, SignalLoop } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * HOW FAR THE RUN HAS GOT: the steps, where it is standing, and what it left beside each one.
 *
 * THE METER IS THE HEADLINE. A reader opening a card mid-build asks one question first — how much
 * of this is done — and the answer is a small ring with its figure at the end of the section's
 * Rule, not a count they assemble by reading fourteen rows. It reads `done` over TOTAL, the same
 * two numbers the card's mark carries, off the same fetch, so the Opening can never contradict
 * the board. A checklist nobody has written has no ring: zero of zero is no reading.
 *
 * THREE STATES, ONE CONTROL. `pending`, `active` and `done` are the checklist's OWN vocabulary —
 * a different one from a card's status, which is the lane policy's and is never named on this
 * screen. The mark cycles forward through them, and its accessible name says where the press
 * lands, because an icon that changes shape tells a reader what a row IS and never what pressing
 * it will do.
 *
 * EVERY WRITE BELOW IS A VERB ON `useKanbanMutations`, handed down by the shell: that hook is where
 * a write becomes a toast and where a refusal keeps the server's own sentence, so this file reaches
 * the network through nothing of its own.
 *
 * THE DESIGN SYSTEM'S STEPS. Each step's mark stands on one hairline, lit where the steps are
 * done: a done step settles with a green tick (finished is green), the step in hand works (the
 * loop in small), the rest wait as a faint ring. What a finished row loses is ink, not hue, so a
 * glance down the list reads as a front line rather than a colour chart. The mark is the press.
 *
 * A NOTE IS DRAWN WHOLE, LINE BY LINE. A walk writes what it found under the step that found it,
 * and the root-cause step's note is four lines: the cause, then what was searched for the same
 * cause elsewhere, for similar cards and for an earlier fix, each with what turned up. One
 * paragraph would run them together into a sentence nobody wrote.
 *
 * UNDER A STEP, THE SITTINGS THAT DID IT (`DrawerStepStages`): who, how it ended, what it spent
 * and the press that opens its transcript. A sitting no step of this card's list claims is drawn
 * under the list, so no transcript is ever unreachable because a card changed flow mid-walk.
 */

type DrawerChecklistProps = {
  /** The open card, as the shell read it. This section fetches nothing. */
  detail: KanbanCardDetail;
  /** The board's verbs, from the shell. This section reaches the network through none of its own. */
  writes: KanbanMutations;
  /** The card's walk, or `null` for a card the dispatcher is not walking: steps and no sittings. */
  walk: KanbanWalk | null;
  /** Opens one sitting's transcript. The shell owns where it is read. */
  onReadStage: (stage: KanbanWalkStage) => void;
};

type ChecklistState = KanbanChecklistItem['state'];

/** The name of the press that lands on each state, and the state as the design system's Steps draws it. */
const STATES = {
  pending: { markKey: 'kanban.checklist.markPending', drawn: 'next' },
  active: { markKey: 'kanban.checklist.markActive', drawn: 'live' },
  done: { markKey: 'kanban.checklist.markDone', drawn: 'done' },
} satisfies Record<ChecklistState, { markKey: string; drawn: 'next' | 'live' | 'done' }>;

/** Forward, and round: a step marked done by mistake is one press from being open again. */
const NEXT_STATE = { pending: 'active', active: 'done', done: 'pending' } satisfies Record<ChecklistState, ChecklistState>;

/** The place in a flow's step list a sitting of that flow belongs under, or `null` when no step of it does. */
function stepIndexOf(stageName: string, flow: KanbanFlow | null): number | null {
  if (flow === null) return null;
  if (flow === 'tweak') {
    if (stageName === 'tweak' || stageName === 'tweak-undo') return 1;
    return null;
  }
  if (stageName === 'diagnose') return 1;
  if (stageName === 'scenarios') return 2;
  if (stageName === 'builder' || stageName === 'fix-pass' || stageName.startsWith('fix-pass-')) return 3;
  if (/^athena-\d+$/.test(stageName)) return 4;
  if (stageName === 'prometheus') return 5;
  return null;
}

/** Rendered by KanbanCardDrawer while autonomy is on. Nothing else mounts it. */
export function DrawerChecklist({ detail, writes, walk, onReadStage }: DrawerChecklistProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const addId = useId();
  const [draft, setDraft] = useState('');

  const total = detail.checklist.length;
  const done = detail.checklist.filter((item) => item.state === 'done').length;

  // Which of the walk's sittings are drawn under which step, by the stage's
  // name and the card's flow. A bug and a change: `diagnose` under the second step, `scenarios`
  // the third, `builder` and every `fix-pass` the fourth, every `athena-<n>` the fifth, the docs
  // sitting the sixth. A tweak: `tweak` and `tweak-undo` under the second. A sitting no step of
  // THIS list claims (a tweak's, on a card that moved to the full flow) is `unplaced`.
  // The docs sitting is the walk's `prometheus` stage, and a card no walk has sorted (no flow tag) claims none.
  const flow = flowOf(detail.tags)?.flow ?? null;
  const stepOf = (stage: KanbanWalkStage): number | null => {
    const index = stepIndexOf(stage.name, flow);
    return index !== null && index < total ? index : null;
  };
  const stages = walk?.stages ?? [];
  const stagesOf = (index: number) => stages.filter((stage) => stepOf(stage) === index);
  const unplaced = stages.filter((stage) => stepOf(stage) === null);

  const add = async () => {
    const next = draft.trim();
    if (next.length === 0) return;
    // The draft is cleared by the ANSWER, not by the press: a step the server did not take stays
    // in the field, so the reader can press again rather than retyping it.
    if (await writes.addChecklistItem(detail.id, next)) setDraft('');
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby={headingId} data-drawer-checklist="">
      <Rule
        id={headingId}
        end={
          total > 0 && (
            <Meter
              variant="ring"
              percent={Math.round((done / total) * 100)}
              label={`${done}/${total}`}
              ariaLabel={t('kanban.checklist.progressAria')}
              value={`${done}/${total}`}
            />
          )
        }
      >
        {t('kanban.checklist.title')}
      </Rule>

      {total > 0 && (
        <ol className="ast-steps">
          {detail.checklist.map((item, index) => (
            <ChecklistRow
              key={item.id}
              item={item}
              updateChecklistItem={writes.updateChecklistItem}
              stages={stagesOf(index)}
              onReadStage={onReadStage}
            />
          ))}
        </ol>
      )}

      {unplaced.length > 0 && (
        <div className="flex flex-col gap-1 pl-[30px]" data-unplaced-stages>
          <span className="text-xs text-muted-foreground">{t('kanban.stages.earlier')}</span>
          <DrawerStepStages stages={unplaced} onRead={onReadStage} />
        </div>
      )}

      <div className="bug-add pl-[30px]">
        <input
          id={addId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void add();
          }}
          placeholder={t('kanban.checklist.addPlaceholder')}
          aria-label={t('kanban.checklist.add')}
          className="bug-field"
        />
        {/* The press arrives with what it adds: a step being typed. Enter adds it too. */}
        {draft.trim().length > 0 && (
          <Button variant="outline" size="icon" className="size-7 shrink-0 finger:size-11" aria-label={t('kanban.checklist.add')} title={t('kanban.checklist.add')} onClick={() => void add()}>
            <Plus aria-hidden="true" />
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * One step: its mark, its text, its note and the two things that can be done to it.
 *
 * Its own component because the note is edited in place and that draft belongs to the ROW — a
 * shared one would put the eleventh step's note under the third.
 */
function ChecklistRow({
  item,
  updateChecklistItem,
  stages,
  onReadStage,
}: {
  item: KanbanChecklistItem;
  updateChecklistItem: KanbanMutations['updateChecklistItem'];
  stages: KanbanWalkStage[];
  onReadStage: (stage: KanbanWalkStage) => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState(item.note);
  const [editingNote, setEditingNote] = useState(false);

  const next = NEXT_STATE[item.state];

  // The mark follows `item.state` — which the shell's re-read refreshes — so a refused press leaves the row where it was without
  // anything here having to put it back.
  const cycle = () => {
    void updateChecklistItem(item.id, { state: next });
  };

  const saveNote = async () => {
    if (note === item.note) {
      setEditingNote(false);
      return;
    }
    // The editor closes on the ANSWER: a note the server did not take stays open under the reader's hands rather than closing
    // over text that is nowhere else.
    if (await updateChecklistItem(item.id, { note })) setEditingNote(false);
  };

  return (
    <li className="ast-step group" data-state={STATES[item.state].drawn}>
      <button
        type="button"
        className="ast-step-mark"
        // The name of the PRESS, not of the state: the mark already says where the row stands.
        aria-label={t(STATES[next].markKey)}
        title={t(STATES[next].markKey)}
        onClick={cycle}
      >
        {item.state === 'done' ? (
          <span key="done" className="ast-step-glyph" aria-hidden="true">✓</span>
        ) : item.state === 'active' ? (
          <SignalLoop state="working" size={14} />
        ) : (
          <span className="ast-step-ring" aria-hidden="true" />
        )}
      </button>

      <div className="ast-step-body">
        <span className="ast-step-label">{item.text}</span>

        {editingNote ? (
          <div className="bug-add">
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveNote();
              }}
              placeholder={t('kanban.checklist.notePlaceholder')}
              aria-label={t('kanban.checklist.note')}
              className="bug-field"
              autoFocus
            />
            <Button variant="outline" size="icon" className="size-7 shrink-0 finger:size-11" aria-label={t('kanban.checklist.noteSave')} title={t('kanban.checklist.noteSave')} onClick={() => void saveNote()}>
              <Check aria-hidden="true" />
            </Button>
          </div>
        ) : (
          item.note.trim().length > 0 && (
            // One block per line the note was written on. An empty line keeps its height, so a note written in two parts is
            // still read in two parts.
            <p className="ast-step-detail flex flex-col gap-0.5" data-step-note>
              {item.note.split('\n').map((line, index) => (
                <span key={index} className="block min-h-[1em] break-words">{line}</span>
              ))}
            </p>
          )
        )}

        <DrawerStepStages stages={stages} onRead={onReadStage} />
      </div>

      {/* One affordance on the row, and no delete: `api.kanban` carries no checklist removal, so a button that cannot be wired is
          not drawn. A step written by mistake is cycled back to pending and left. Quiet until the row is pointed at or focused
          (always there under a finger). */}
      <Button
        variant="outline"
        size="icon"
        className={cn('size-7 shrink-0 text-muted-foreground transition-opacity finger:size-11', editingNote ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 finger:opacity-100')}
        aria-label={t('kanban.checklist.note')}
        title={t('kanban.checklist.note')}
        aria-pressed={editingNote}
        onClick={() => setEditingNote((editing) => !editing)}
      >
        <StickyNote aria-hidden="true" />
      </Button>
    </li>
  );
}
