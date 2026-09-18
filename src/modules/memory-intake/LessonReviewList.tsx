import { CheckIcon, ChevronDownIcon, FileCodeIcon, LightbulbIcon, PlugZapIcon, XIcon } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanLesson, KanbanLessonLean } from '@/shared/kanban-types';
import { Badge, Button, Card, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * The lessons a build staged, as a SECTION of the Memory tab — under its own heading, in the same
 * measured column as the memory queue above it, inside the same scroll.
 *
 * A SECTION AND NOT A TAB, because reviewing what the machine wants to remember is one habit: a
 * second tab would split it in two and hide whichever half was not open. The heading is an `h3`
 * under the panel's `h2`, and the count rides beside it the way the panel's own count does.
 *
 * THE LIST IS LEAN AND STAYS LEAN ON SCREEN. A row is the lesson's name, its one-line summary, when
 * it applies, and its card when it has one — summary and trigger clamped to two lines each, so a
 * long one never pushes the next lesson off the pane. The BODY is never in the list: it is read
 * for the one row a person opens, and drawn only there.
 *
 * EVERY STATE IS A DIFFERENT SENTENCE: still reading, could not be read, none staged, and the rows.
 * "None staged" is a quiet line and not the kit's dashed EmptyState — that frame belongs to the
 * panel's primary queue, and a second one stacked under it would say "nothing" louder than this
 * tab ever says anything.
 *
 * A REVIEW THAT FAILED STAYS ON ITS ROW, in amber with a mark and the server's own words, and the
 * row stays where it was: the lesson was not reviewed, and a row that vanished would say it had been.
 */

/** `null` before the first read lands, `'unread'` when it could not be made, else the staged
 *  lessons in the server's own order. Never `[]` for "not asked yet". */
type StagedLessons = KanbanLessonLean[] | 'unread' | null;

/** The one opened lesson's by-id read. `gone` is a lesson reviewed elsewhere since the list was
 *  read — no longer `staged`, or no longer a row at all. */
type LessonBody =
  | { state: 'reading' }
  | { state: 'unread' }
  | { state: 'gone' }
  | { state: 'read'; lesson: KanbanLesson };

/** What the scaffold draws while nothing is wired: a plain lesson on a card, a skill draft with a
 *  write in flight, and a long one whose review was refused — every row state at once. */
const SCAFFOLD_LESSONS: KanbanLessonLean[] = [
  { id: 'ls-scaffold-1', cardId: 'c-142', name: 'Probe against a scratch database', summary: 'A probe that boots the server must point it at a copy, never the live file.', trigger: 'Before any command that starts a second server', kind: 'note', tags: ['probe', 'sqlite'], status: 'staged', source: 'metis', createdAt: '2026-09-17T18:04:00Z', reviewedAt: null },
  { id: 'ls-scaffold-2', cardId: null, name: 'Scaffold then fill', summary: 'Split a screen into a composition phase and a wiring phase.', trigger: 'Planning any UI phase', kind: 'skill_draft', tags: ['planning'], status: 'staged', source: 'metis', createdAt: '2026-09-17T17:40:00Z', reviewedAt: null },
  { id: 'ls-scaffold-3', cardId: 'c-97', name: 'Read the failing rows first', summary: 'When a migration check fails, read the rows it failed on before touching the migration: three of the last four failures were data the plan never described, and the migration itself was right every time.', trigger: 'A verify step fails on a count, a sum, or any figure derived from rows rather than from code', kind: 'note', tags: ['migrations', 'root-cause', 'verify'], status: 'staged', source: 'spill', createdAt: '2026-09-16T09:12:00Z', reviewedAt: null },
];
const SCAFFOLD_REFUSALS: Record<string, string> = { 'ls-scaffold-3': 'lesson ls-scaffold-3 is approved, not staged — it was reviewed elsewhere' };
const SCAFFOLD_BODIES: Record<string, LessonBody> = {
  'ls-scaffold-1': { state: 'read', lesson: { ...SCAFFOLD_LESSONS[0], body: 'The live database is the operator\'s.\n\n1. Copy it to /tmp and disarm every board on the copy.\n2. Boot the second server on its own port against the copy.\n3. Trap the teardown before the boot, so a failed read never strands it.', draftPath: null } },
  'ls-scaffold-3': { state: 'unread' },
};

/** Rendered by MemoryIntakePanel, beneath the memory queue and inside its scroll. Nothing else mounts it. */
export function LessonReviewList() {
  const { t } = useTranslation();
  const headingId = useId();

  // ── The wires. Each line below is the fill phase's; the composition around them is not. ──
  const lessons = SCAFFOLD_LESSONS as StagedLessons; // FILL: lessons
  const busyId: string | null = 'ls-scaffold-2'; // FILL: busy
  const refusals: Record<string, string> = SCAFFOLD_REFUSALS; // FILL: refusals
  const onApprove = (_lessonId: string): void => {}; // FILL: onApprove
  const onReject = (_lessonId: string): void => {}; // FILL: onReject

  return (
    // The memory queue's own column — `max-w-2xl`, centred, `px-4` — so the two sections share one
    // left edge. The rule above the heading is the whole separation between them.
    <section aria-labelledby={headingId} className="mx-auto w-full max-w-2xl px-4 pb-6" data-lesson-review>
      <div className="flex items-center gap-2 border-t border-border pt-5">
        <LightbulbIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h3 id={headingId} className="text-sm font-medium">
          {t('memory.lessons.title', { defaultValue: 'Lessons' })}
        </h3>
        {/* A count only over a list that was read: "0 staged" above "could not be read" would
            have the section contradict itself in two adjacent lines. */}
        {Array.isArray(lessons) && (
          <Badge tone="neutral">
            {t('memory.lessons.staged', { defaultValue: '{{count}} staged', count: lessons.length })}
          </Badge>
        )}
      </div>
      <p className="pb-3 pt-1 text-xs text-muted-foreground">
        {t('memory.lessons.about', { defaultValue: 'What a build learned. Approve one and later sessions can read it; reject it and none will.' })}
      </p>

      {lessons === null ? (
        <div className="flex justify-center py-6">
          <Spinner size={20} label={t('memory.reading')} />
        </div>
      ) : lessons === 'unread' ? (
        <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <PlugZapIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t('memory.lessons.unread', { defaultValue: 'The lessons could not be read right now.' })}
        </p>
      ) : lessons.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">
          {t('memory.lessons.none', { defaultValue: 'No lessons are waiting for review.' })}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {lessons.map((lesson) => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              refusal={refusals[lesson.id] ?? null}
              writing={busyId === lesson.id}
              // Every row, not just the one being written: one write runs at a time, so a row
              // that still looked pressable would turn a refused press into one that vanished.
              busy={busyId !== null}
              onApprove={onApprove}
              onReject={onReject}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

type LessonRowProps = {
  lesson: KanbanLessonLean;
  /** This tab's held refusal for this lesson, in the server's own words, or `null`. */
  refusal: string | null;
  /** THIS row's write is the one in flight. */
  writing: boolean;
  /** Some row's write is in flight, so every row's buttons refuse. */
  busy: boolean;
  onApprove: (lessonId: string) => void;
  onReject: (lessonId: string) => void;
};

/**
 * One staged lesson, as a card a person can decide on — and, once opened, read whole. The heading
 * is the expander, exactly as a memory's is: opening to read IS the deliberate step, so there is no
 * confirmation dialog. Every string is a build's free text and reaches the DOM as a text node.
 */
function LessonRow({ lesson, refusal, writing, busy, onApprove, onReject }: LessonRowProps) {
  const { t } = useTranslation();
  // One person's place in one list: nothing outside the row acts on it.
  const [expanded, setExpanded] = useState(false);

  // The by-id read of THIS lesson, asked for when the row opens and kept once it lands.
  const body: LessonBody = expanded ? (SCAFFOLD_BODIES[lesson.id] ?? { state: 'reading' }) : { state: 'reading' }; // FILL: body

  const toggle = () => setExpanded((open) => !open);
  const onHeadingKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggle();
  };

  const isDraft = lesson.kind === 'skill_draft';
  const KindIcon = isDraft ? FileCodeIcon : LightbulbIcon;

  return (
    <li data-lesson-id={lesson.id}>
      <Card>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          title={t('memory.lessons.expand', { defaultValue: 'read the whole lesson' })}
          onClick={toggle}
          onKeyDown={onHeadingKeyDown}
          className="flex cursor-pointer items-start gap-3 px-4 pb-3 pt-4"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
            <KindIcon className="h-4 w-4" aria-hidden="true" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              {/* A lesson staged without a name still has to be something a person can point at. */}
              <span className="break-words text-sm font-medium">{lesson.name || lesson.id}</span>
              {isDraft && (
                <Badge as="span" tone="info" title={t('memory.lessons.draftTitle', { defaultValue: 'also staged as a SKILL.md draft to promote' })}>
                  {t('memory.lessons.draft', { defaultValue: 'skill draft' })}
                </Badge>
              )}
              {/* The card it was learned on, by the board's own id. Absent, never "no card": a
                  lesson outlives its card, and most of what a reviewer weighs is not where. */}
              {lesson.cardId && (
                <Badge as="span" variant="outline" title={t('memory.lessons.cardTitle', { defaultValue: 'the card it was learned on' })}>
                  {lesson.cardId}
                </Badge>
              )}
            </span>
            {/* Clamped while closed — the list is for deciding WHICH to read — and whole once open. */}
            {lesson.summary && (
              <span className={cn('mt-0.5 block break-words text-xs text-foreground/80', !expanded && 'line-clamp-2')}>
                {lesson.summary}
              </span>
            )}
            {lesson.trigger && (
              <span className={cn('mt-1 block break-words text-xs text-muted-foreground', !expanded && 'line-clamp-2')}>
                {`${t('memory.lessons.when', { defaultValue: 'When' })}: ${lesson.trigger}`}
              </span>
            )}
          </span>

          <ChevronDownIcon
            aria-hidden="true"
            className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-180')}
          />
        </div>

        {/* The review that failed: amber, a mark, the server's sentence — and announced, because it
            arrives as the answer to a press. Errors are amber here; red is for what is destroyed. */}
        {refusal && (
          <p role="alert" data-tone="warn" data-lesson-refusal className="flex items-start gap-1.5 px-4 pb-3 text-xs text-[color:var(--tone-ink)]">
            <span aria-hidden="true">▲</span>
            <span className="min-w-0 break-words">{refusal}</span>
          </p>
        )}

        {expanded && (
          <div className="mx-4 mb-3 rounded-xl border border-border bg-muted/50 p-3">
            {body.state === 'reading' && <Spinner size={20} label={t('memory.reading')} />}
            {body.state === 'unread' && (
              <p className="text-xs text-muted-foreground">{t('memory.lessons.bodyUnread', { defaultValue: 'This lesson could not be read right now.' })}</p>
            )}
            {body.state === 'gone' && (
              <p className="text-xs text-muted-foreground">{t('memory.lessons.gone', { defaultValue: 'This lesson is no longer staged — it was reviewed elsewhere.' })}</p>
            )}
            {body.state === 'read' && (
              <>
                {body.lesson.body ? (
                  <pre className="whitespace-pre-wrap break-words text-xs">{body.lesson.body}</pre>
                ) : (
                  <p className="text-xs text-muted-foreground">{t('memory.lessons.noBody', { defaultValue: 'No body was staged — the summary is the whole lesson.' })}</p>
                )}
                {body.lesson.tags.length > 0 && (
                  <p className="mt-2 break-words text-xs text-muted-foreground">{`${t('memory.lessons.tags', { defaultValue: 'Tags' })}: ${body.lesson.tags.join(', ')}`}</p>
                )}
                {body.lesson.draftPath && (
                  <p className="mt-1 break-all text-xs text-muted-foreground">{`${t('memory.lessons.draftPath', { defaultValue: 'Draft' })}: ${body.lesson.draftPath}`}</p>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 px-4 pb-4">
          <Button size="sm" variant="default" disabled={busy} title={t('memory.lessons.approveTitle', { defaultValue: 'approve — later sessions can read this lesson' })} onClick={() => onApprove(lesson.id)}>
            <CheckIcon aria-hidden="true" />
            {t('memory.lessons.approve', { defaultValue: 'approve' })}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} title={t('memory.lessons.rejectTitle', { defaultValue: 'reject — no session ever reads it' })} onClick={() => onReject(lesson.id)}>
            <XIcon aria-hidden="true" />
            {t('memory.lessons.reject', { defaultValue: 'reject' })}
          </Button>
          {/* Said on the row being written, in words: the other rows are merely held, and a ring
              alone tells the reader only that time is passing. */}
          {writing && (
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground" data-lesson-writing>
              <Spinner size={14} />
              <span>{t('memory.lessons.writing', { defaultValue: 'writing…' })}</span>
            </div>
          )}
        </div>
      </Card>
    </li>
  );
}
