import { CheckIcon, ChevronDownIcon, FileCodeIcon, LightbulbIcon, PlugZapIcon, XIcon } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useLessonReview, type LessonBody } from '@/modules/memory-intake/hooks/useLessonReview';
import type { KanbanLessonLean } from '@/shared/kanban-types';
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
 * for the one row a person opens, and drawn only there — inside a cap that scrolls, so the two
 * buttons the row was opened for stay within a screen of its name however long the lesson runs.
 *
 * EVERY STATE IS A DIFFERENT SENTENCE: still reading, could not be read, none staged, and the rows.
 * "None staged" is a quiet line and not the kit's dashed EmptyState — that frame belongs to the
 * panel's primary queue, and a second one stacked under it would say "nothing" louder than this
 * tab ever says anything.
 *
 * A REVIEW THAT FAILED STAYS ON ITS ROW, in amber with a mark and the server's own words, and the
 * row stays where it was: the lesson was not reviewed, and a row that vanished would say it had been.
 */

/** Rendered by MemoryIntakePanel, beneath the memory queue and inside its scroll. Nothing else mounts it. */
export function LessonReviewList() {
  const { t } = useTranslation();
  const headingId = useId();

  // ── The wires: every line that carries data or acts is here, and none of the composition below
  //    does. The rows are handed what they draw and raise what they are asked. ──
  const { lessons, capped, bodies, onOpen, busyId, refusals, review } = useLessonReview();
  const onApprove = (lessonId: string): void => { void review(lessonId, true); };
  const onReject = (lessonId: string): void => { void review(lessonId, false); };

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
            have the section contradict itself in two adjacent lines. Over a list cut at the route's
            ceiling it says "at least": the badge is read against the strip's estate count, and a
            number this list cannot stand behind is exactly what must not be printed there. */}
        {Array.isArray(lessons) && (
          <Badge tone="neutral">
            {capped
              ? t('memory.lessons.stagedCapped', { defaultValue: '{{count}}+ staged', count: lessons.length })
              : t('memory.lessons.staged', { defaultValue: '{{count}} staged', count: lessons.length })}
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
              // Asked for and not yet in is `reading`, which is also what a row shows the instant
              // it opens — so an entry that is simply absent draws the truth.
              body={bodies[lesson.id] ?? { state: 'reading' }}
              onOpen={onOpen}
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
  /** This lesson read whole, as far as that read has got. Drawn only while the row is open. */
  body: LessonBody;
  /** Raised when the row OPENS — the moment its body is wanted. Closing raises nothing. */
  onOpen: (lessonId: string) => void;
  onApprove: (lessonId: string) => void;
  onReject: (lessonId: string) => void;
};

/**
 * One staged lesson, as a card a person can decide on — and, once opened, read whole. The heading
 * is the expander, exactly as a memory's is: opening to read IS the deliberate step, so there is no
 * confirmation dialog. Every string is a build's free text and reaches the DOM as a text node.
 */
function LessonRow({ lesson, refusal, writing, busy, body, onOpen, onApprove, onReject }: LessonRowProps) {
  const { t } = useTranslation();
  // One person's place in one list: nothing outside the row acts on it.
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    if (!expanded) onOpen(lesson.id);
    setExpanded((open) => !open);
  };
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
              {/* A lesson staged without a name still has to be something a person can point at.
                  `anywhere` and not `break-words`: this span is a flex item, and only `anywhere`
                  lowers the width a flex item refuses to go under — a snake_case name with no
                  space in it otherwise runs off the card and over the chevron. */}
              <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{lesson.name || lesson.id}</span>
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
          // Capped, and it scrolls inside the cap: a lesson runs to 4000 characters, which uncapped
          // is a row 2200px tall on a phone — and Approve and Reject, the reason the row was opened,
          // two and a half screens below the name. At `max-h-80` they stay within one screen of it.
          // Focusable because it scrolls: a keyboard has no other way to read past the fold.
          <div
            role="region"
            tabIndex={0}
            aria-label={t('memory.lessons.bodyLabel', { defaultValue: 'the whole lesson' })}
            className="mx-4 mb-3 max-h-80 overflow-y-auto rounded-xl border border-border bg-muted/50 p-3"
          >
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
