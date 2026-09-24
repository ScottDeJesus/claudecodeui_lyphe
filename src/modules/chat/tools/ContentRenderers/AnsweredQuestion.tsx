import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown } from 'lucide-react';

import type { Question } from '@/shared/types';
import { Badge } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { QuestionText } from '@/modules/chat/tools/ContentRenderers/QuestionText';
import { QuestionOptionRow } from '@/modules/chat/tools/InteractiveRenderers/QuestionOptionRow';

/** The separator AskUserQuestionPanel joins a multi-select answer with — chosen labels, then the typed note. */
const ANSWER_SEPARATOR = ', ';

type ParsedAnswer = { chosen: string[]; custom: string | null };

/**
 * Splits an answer string back into the option labels it names, or the operator's own words.
 *
 * The panel writes a multi-select answer as the chosen labels joined with ", ", any typed "Other"
 * note last. That string cannot tell "Accept" + a note from a note that happens to OPEN with
 * "Accept, but…", and the card is the transcript's record of a decision — so it never shows a tap
 * the string does not prove. An answer becomes option rows only when it is WHOLLY a list of known
 * labels (longest first, since one label may contain another or a ", " of its own); anything else
 * is ONE note, exactly as sent. A single-select answer is one label or one note, never both.
 */
function parseAnswer(answer: unknown, labels: string[], multiSelect: boolean): ParsedAnswer {
  if (typeof answer !== 'string' || answer.trim() === '') return { chosen: [], custom: null };
  if (labels.includes(answer)) return { chosen: [answer], custom: null };
  if (!multiSelect) return { chosen: [], custom: answer };

  const byLength = [...labels].sort((a, b) => b.length - a.length);
  const chosen: string[] = [];
  let rest = answer;
  for (;;) {
    const label = byLength.find((l) => rest === l || rest.startsWith(l + ANSWER_SEPARATOR));
    if (!label) break;
    if (!chosen.includes(label)) chosen.push(label);
    if (rest === label) return { chosen, custom: null };
    rest = rest.slice(label.length + ANSWER_SEPARATOR.length);
  }
  return { chosen: [], custom: answer };
}

/** A question this long is shown clamped until asked for; a short one is shown whole. */
const isLongQuestion = (text: string) => text.split('\n').length > 4 || text.length > 320;

type AnsweredQuestionProps = {
  question: Question;
  answer: unknown;
  index: number;
  total: number;
  /** Some question in this card was answered — so an unanswered one here was skipped, not pending. */
  anyAnswered: boolean;
};

/**
 * One answered AskUserQuestion question, as the transcript's record of it: the question (clamped
 * when long), then what was chosen — the option rows as they looked when picked, and the
 * operator's own words as one quoted note. Rendered by chat's QuestionAnswerContent, once per
 * question, after the run has its answer.
 */
export const AnsweredQuestion: React.FC<AnsweredQuestionProps> = ({ question, answer, index, total, anyAnswered }) => {
  const { t } = useTranslation('chat');
  // The reader opened this record: the whole question, and every option including those not chosen.
  const [expanded, setExpanded] = useState(false);

  // `options` comes from untrusted transcript data; keep only well-formed entries.
  const options = Array.isArray(question.options)
    ? question.options.filter((o) => o && typeof o === 'object' && typeof o.label === 'string')
    : [];
  const { chosen, custom } = parseAnswer(answer, options.map((o) => o.label), Boolean(question.multiSelect));
  const answered = chosen.length > 0 || custom !== null;
  const long = isLongQuestion(question.question);
  const shownOptions = expanded ? options : options.filter((o) => chosen.includes(o.label));
  const detailsLabel = expanded
    ? t('question.hideDetails', { defaultValue: 'Hide the full question' })
    : t('question.showDetails', { defaultValue: 'Show the full question and every option' });

  return (
    // No box of its own: the tool row's frame is the card, and questions are parted by a rule.
    <section data-question-card="answered" className="py-3 first:pt-0 last:pb-0">
      <header className="flex items-center gap-2">
        <span
          className={cn(
            'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full',
            answered ? 'bg-primary/15 text-accent-ink' : 'bg-muted text-muted-foreground',
          )}
        >
          {answered ? <Check aria-hidden className="h-3 w-3" strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
        </span>
        {question.header && <Badge as="span" tone="neutral" className="vv-badge--compact uppercase tracking-wider">{question.header}</Badge>}
        {total > 1 && <span className="text-xs tabular-nums text-ink-faint">{index + 1}/{total}</span>}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={detailsLabel}
          title={detailsLabel}
          className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform duration-quick', expanded && 'rotate-180')} />
        </button>
      </header>

      {/* Clamped, not hidden: the list stays in the page, faded out after a few lines. */}
      <div
        className={cn(
          'relative mt-1.5',
          long && !expanded && 'max-h-48 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]',
        )}
      >
        <QuestionText text={question.question} className="[&_.prose]:text-secondary-foreground" />
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-1 text-xs font-medium text-accent-ink hover:underline"
        >
          {expanded
            ? t('question.showLess', { defaultValue: 'Show less' })
            : t('question.showFull', { defaultValue: 'Show full question' })}
        </button>
      )}

      {answered ? (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">
              {t('question.yourAnswer', { defaultValue: 'Your answer' })}
            </span>
            {custom !== null && (
              <Badge as="span" tone="positive" className="vv-badge--compact">
                {t('question.yourWords', { defaultValue: 'In your words' })}
              </Badge>
            )}
          </div>
          {shownOptions.map((o) => (
            <QuestionOptionRow key={o.label} label={o.label} description={o.description} selected={chosen.includes(o.label)} />
          ))}
          {custom !== null && (
            // ONE block of the operator's own words, as typed — never split at its commas.
            <blockquote
              data-question-custom
              className="whitespace-pre-wrap break-words rounded-r-lg border-l-[3px] border-primary bg-primary/10 px-3 py-2 text-sm leading-relaxed text-foreground"
            >
              {custom}
            </blockquote>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          <p className="text-xs italic text-muted-foreground">
            {anyAnswered
              ? t('question.noAnswer', { defaultValue: 'No answer provided' })
              : t('question.skipped', { defaultValue: 'Skipped' })}
          </p>
          {expanded && options.map((o) => (
            <QuestionOptionRow key={o.label} label={o.label} description={o.description} selected={false} />
          ))}
        </div>
      )}
    </section>
  );
};
