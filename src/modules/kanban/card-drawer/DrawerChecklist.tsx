import { CheckCircle2, Circle, CircleDot, StickyNote } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanMutations } from '@/modules/kanban/hooks/useKanbanMutations';
import type { KanbanCardDetail, KanbanChecklistItem } from '@/shared/kanban-types';
import { Button, Input, Meter } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * HOW FAR THE RUN HAS GOT: the steps, where it is standing, and what it left beside each one.
 *
 * THE METER IS THE HEADLINE. A reader opening a card mid-build asks one question first — how much
 * of this is done — and the answer is a bar and a figure at the top of the section, not a count
 * they assemble by reading fourteen rows. It reads `done` over TOTAL, the same two numbers the
 * card's face carries, off the same fetch, so the drawer can never contradict the board.
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
 * COLOUR SAYS DONE, WEIGHT SAYS THE REST. Only the accent is spent, and only on progress: an
 * unfinished step is not a warning and a note is not a verdict. What a finished row loses is ink,
 * not hue — struck through and muted, so a glance down the list reads as a front line rather than
 * a colour chart.
 */

type DrawerChecklistProps = {
  /** The open card, as the shell read it. This section fetches nothing. */
  detail: KanbanCardDetail;
  /** The board's verbs, from the shell. This section reaches the network through none of its own. */
  writes: KanbanMutations;
};

type ChecklistState = KanbanChecklistItem['state'];

/** The mark each state wears, and the name of the press that leaves it. */
const STATES = {
  pending: { icon: Circle, className: 'text-ink-faint', markKey: 'kanban.checklist.markPending' },
  active: { icon: CircleDot, className: 'text-accent-ink', markKey: 'kanban.checklist.markActive' },
  done: { icon: CheckCircle2, className: 'text-accent-ink', markKey: 'kanban.checklist.markDone' },
} satisfies Record<ChecklistState, { icon: typeof Circle; className: string; markKey: string }>;

/** Forward, and round: a step marked done by mistake is one press from being open again. */
const NEXT_STATE = { pending: 'active', active: 'done', done: 'pending' } satisfies Record<ChecklistState, ChecklistState>;

/** Rendered by KanbanCardDrawer while autonomy is on. Nothing else mounts it. */
export function DrawerChecklist({ detail, writes }: DrawerChecklistProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const addId = useId();
  const [draft, setDraft] = useState('');

  const total = detail.checklist.length;
  const done = detail.checklist.filter((item) => item.state === 'done').length;

  const add = async () => {
    const next = draft.trim();
    if (next.length === 0) return;
    // The draft is cleared by the ANSWER, not by the press: a step the server did not take stays
    // in the field, so the reader can press again rather than retyping it.
    if (await writes.addChecklistItem(detail.id, next)) setDraft('');
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby={headingId}>
      <div className="flex items-center gap-3">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
          {t('kanban.checklist.title')}
        </h3>

        {/* An empty checklist reports `—` rather than `0/0`: a bar at zero claims a run that has
            done none of its work, where the truth is that nobody has written the work down. */}
        <div className="ml-auto w-36 shrink-0">
          <Meter
            variant="inline"
            percent={total === 0 ? null : Math.round((done / total) * 100)}
            label={t('kanban.checklist.progress')}
            ariaLabel={t('kanban.checklist.progressAria')}
            value={`${done}/${total}`}
          />
        </div>
      </div>

      {total === 0 ? (
        <p className="text-sm text-muted-foreground">{t('kanban.checklist.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {detail.checklist.map((item) => (
            <ChecklistRow key={item.id} item={item} updateChecklistItem={writes.updateChecklistItem} />
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Input
          id={addId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add();
          }}
          placeholder={t('kanban.checklist.addPlaceholder')}
          aria-label={t('kanban.checklist.add')}
          className="h-8"
        />
        <Button variant="tonal" size="sm" className="h-8 shrink-0" onClick={add}>
          {t('kanban.checklist.add')}
        </Button>
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
}: {
  item: KanbanChecklistItem;
  updateChecklistItem: KanbanMutations['updateChecklistItem'];
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState(item.note);
  const [editingNote, setEditingNote] = useState(false);

  const next = NEXT_STATE[item.state];
  const state = STATES[item.state];
  const Mark = state.icon;

  // The mark follows `item.state` — which the shell's re-read refreshes — so a refused press leaves
  // the row where it was without anything here having to put it back.
  const cycle = () => {
    void updateChecklistItem(item.id, { state: next });
  };

  const saveNote = async () => {
    if (note === item.note) {
      setEditingNote(false);
      return;
    }
    // The editor closes on the ANSWER: a note the server did not take stays open under the reader's
    // hands rather than closing over text that is nowhere else.
    if (await updateChecklistItem(item.id, { note })) setEditingNote(false);
  };

  return (
    <li className="flex items-start gap-2">
      <button
        type="button"
        className="mt-0.5 shrink-0"
        // The name of the PRESS, not of the state: the icon already says where the row stands.
        aria-label={t(STATES[next].markKey)}
        title={t(STATES[next].markKey)}
        onClick={cycle}
      >
        <Mark className={cn('h-4 w-4', state.className)} aria-hidden="true" />
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={cn(
            'text-sm leading-snug',
            item.state === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'
          )}
        >
          {item.text}
        </span>

        {editingNote ? (
          <div className="flex gap-2">
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveNote();
              }}
              placeholder={t('kanban.checklist.notePlaceholder')}
              aria-label={t('kanban.checklist.note')}
              className="h-7 text-xs"
            />
            <Button variant="tonal" size="sm" className="h-7 shrink-0 px-2" onClick={saveNote}>
              {t('kanban.checklist.noteSave')}
            </Button>
          </div>
        ) : (
          item.note.trim().length > 0 && (
            <p className="text-xs leading-snug text-muted-foreground">{item.note}</p>
          )
        )}
      </div>

      {/* One affordance on the row, and no delete: `api.kanban` carries no checklist removal —
          the server's DELETE route has no client verb, and `src/shared/api.ts` is closed to this
          phase and to the one that fills it. A button that cannot be wired is a button that lies
          about what this screen can do, so it is not drawn. A step written by mistake is cycled
          back to pending and left. */}
      <Button
        variant="ghost"
        size="icon"
        // Muted on purpose: the accent on this row belongs to the state mark, which means
        // progress. A second green glyph beside it is a column of colour that says nothing.
        className="h-7 w-7 shrink-0 text-muted-foreground"
        aria-label={t('kanban.checklist.note')}
        onClick={() => setEditingNote((editing) => !editing)}
      >
        <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </li>
  );
}
