import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import type { StationNeed } from '@/shared/station-types';
import { Button, QuestionOptionRow, TextArea } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** Every answer: 36 px to look at on a desk, a 44 px catch under a finger below 768 px (the touch law). */
const ANSWER = 'max-md:h-11';

type AnswerProps = {
  /** The ask as the needs hold it: its kind, the rule an always keeps, a question's options. */
  need: Extract<StationNeed, { kind: 'ask' }>;
  /** The answer whose press is out, or null: it reads busy, and every other answer refuses a press until it settles. */
  answering: string | null;
  onAnswer: (answer: string) => void;
  /** The id of the ask's kind word (Permission, Plan) over the stage, which names the answers' group. */
  labelId: string;
  /** The id of the well that holds what the ask would do, which describes the answers' group. */
  whatId: string;
};

/**
 * THE ANSWERS' ROW, and where the rail's press sends the keyboard (`data-station-fire`): a group that takes the focus
 * (`tabIndex={-1}`) and is never itself a press, labelled by the ask's kind and described by the well, so what a press would
 * approve is read as the keyboard lands, and its first answer is one Tab away. A second Enter from the rail approves nothing.
 */
function AnswersRow({ labelId, whatId, children }: { labelId: string; whatId: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={whatId} tabIndex={-1} data-station-fire="" className="flex flex-wrap gap-2 rounded-md">
      {children}
    </div>
  );
}

/**
 * Whether the ask's whole is not what the stage shows (`need.cut`): then the answers that let work go are withheld, because a press
 * fires only what it shows whole. Read as `!== false`, so a server that sends no flag at all is treated as cut, never as whole.
 */
const isCut = (need: AnswerProps['need']): boolean => need.cut !== false;

/** Said where Allow, Always allow or Approve would stand when the ask is cut: why they are not there, and where the whole is. */
function CutNote() {
  const { t } = useTranslation();
  return (
    <p role="note" data-station-ask-cut="" data-tone="warn" className="flex min-w-0 items-start gap-1.5 text-sm leading-snug text-tone-ink">
      <span aria-hidden="true">▲</span>
      <span className="min-w-0 break-words">
        {t('station.needs.ask.cut', 'Only part of this is shown here, so a yes waits for the chat, where the whole stands.')}
      </span>
    </p>
  );
}

/** One answer's press: busy while it is out, refused while another is, and the server's word for it when pressed. */
function pressOf(answer: string, { answering, onAnswer }: Pick<AnswerProps, 'answering' | 'onAnswer'>) {
  return {
    busy: answering === answer,
    'aria-disabled': (answering !== null && answering !== answer) || undefined,
    onClick: () => onAnswer(answer),
  };
}

/**
 * A PERMISSION'S THREE, one press each, their words the server's (`allow`, `deny`, `always`, decided by `answerFor` as the
 * chat's own banner decides them): Allow, the press that lets work go, in the strongest paint and first in the answers' row
 * the keyboard lands on; Deny, quiet; and Always allow, with the rule it keeps written under it, so the one answer that
 * changes more than this ask says what else it changes before it is pressed. An ask that names no rule offers no Always. An ask the
 * stage shows cut (`need.cut`: the command ran past 600 characters, or a Write's or an Edit's body is not in the line) offers neither
 * Allow nor Always allow, only Deny and the sentence that says where the whole stands; a plan cut offers no Approve the same way.
 */
function PermissionAnswers({ need, labelId, whatId, ...press }: AnswerProps) {
  const { t } = useTranslation();
  const ruleId = useId();
  const cut = isCut(need);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <AnswersRow labelId={labelId} whatId={whatId}>
        {!cut && (
          <Button data-station-answer="allow" className={ANSWER} {...pressOf('allow', press)}>
            {t('station.needs.ask.allow', 'Allow')}
          </Button>
        )}
        <Button variant="outline" data-station-answer="deny" className={ANSWER} {...pressOf('deny', press)}>
          {t('station.needs.ask.deny', 'Deny')}
        </Button>
        {need.rule !== null && !cut && (
          <Button variant="tonal" data-station-answer="always" aria-describedby={ruleId} className={ANSWER} {...pressOf('always', press)}>
            {t('station.needs.ask.always', 'Always allow')}
          </Button>
        )}
      </AnswersRow>
      {cut && <CutNote />}
      {need.rule !== null && !cut && (
        <p id={ruleId} data-station-ask-rule="" className="break-words text-xs leading-relaxed text-muted-foreground">
          <Trans
            t={t}
            i18nKey="station.needs.ask.rule"
            defaults="Always allow also keeps <rule/> as a standing rule for every later chat of yours."
            // The rule rides as the slot's own child, so a rule holding "<" reads as written.
            components={{ rule: <code className="font-mono text-[12px] text-foreground [overflow-wrap:anywhere]">{need.rule}</code> }}
          />
        </p>
      )}
    </div>
  );
}

/**
 * A PLAN'S TWO: Approve lets it go ahead (`allow`), Send back returns it to its chat to revise (`deny`), in the answers' row
 * the keyboard lands on.
 */
function PlanAnswers({ need, labelId, whatId, ...press }: AnswerProps) {
  const { t } = useTranslation();
  const cut = isCut(need);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <AnswersRow labelId={labelId} whatId={whatId}>
        {!cut && (
          <Button data-station-answer="allow" className={ANSWER} {...pressOf('allow', press)}>
            {t('station.needs.ask.approve', 'Approve')}
          </Button>
        )}
        <Button variant="outline" data-station-answer="deny" className={ANSWER} {...pressOf('deny', press)}>
          {t('station.needs.ask.sendBack', 'Send back')}
        </Button>
      </AnswersRow>
      {cut && <CutNote />}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t('station.needs.ask.sendBackHint', 'Send back returns the plan to its chat to revise.')}
      </p>
    </div>
  );
}

/**
 * A QUESTION'S ANSWER: its options as the house draws an option (`QuestionOptionRow`, one of them picked at a time), or his
 * own words in the field under them, then Send the answer. One answer stands at a time — a pick clears the field and words in
 * the field clear the pick — and Send refuses a press until one does. The options are the keyboard's landing (a group that
 * takes the focus, so Tab walks into its rows); with none, the field is.
 */
function QuestionAnswers({ need, answering, onAnswer }: AnswerProps) {
  const { t } = useTranslation();
  const ownId = useId();
  // The option he picked, or null. Essential: it is the answer until he sends it, and nothing else holds it.
  const [picked, setPicked] = useState<string | null>(null);
  // His own words as typed. Essential: a free answer goes word for word, and typing is what clears the pick.
  const [own, setOwn] = useState('');
  const answer = own.trim() !== '' ? own.trim() : picked;
  const hasOptions = need.options.length > 0;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {hasOptions && (
        <div role="radiogroup" aria-label={t('station.needs.ask.options', 'Its options')} data-station-fire="" tabIndex={-1} className="flex min-w-0 flex-col gap-2 rounded-lg">
          {need.options.map((label, at) => (
            // An option's place is its key: two may read alike, as a round's questions may.
            <QuestionOptionRow
              key={at}
              label={label}
              selected={picked === label}
              choice="radio"
              onClick={() => { setPicked(label); setOwn(''); }}
            />
          ))}
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={ownId} className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {hasOptions ? t('station.needs.ask.ownWords', 'Or answer in your own words') : t('station.needs.ask.yourAnswer', 'Your answer')}
        </label>
        <TextArea
          id={ownId}
          rows={2}
          value={own}
          data-station-fire={hasOptions ? undefined : ''}
          onChange={(event) => {
            setOwn(event.target.value);
            if (event.target.value.trim() !== '') setPicked(null);
          }}
        />
      </div>
      <Button
        data-station-answer="send"
        busy={answering !== null}
        aria-disabled={answer === null || undefined}
        className={cn('self-start', ANSWER)}
        onClick={() => { if (answer !== null) onAnswer(answer); }}
      >
        {t('station.needs.ask.send', 'Send the answer')}
      </Button>
    </div>
  );
}

/**
 * THE ANSWERS TO A CHAT'S ASK, by its kind: a permission's Allow, Deny and Always allow with the rule it keeps; a plan's
 * Approve and Send back; a question's options and his own words, keyed by the ask so a pick or half-typed words stay with
 * the ask they were for. Each press hands its word to `onAnswer` and the server decides it (`answerFor`), as the chat's own
 * forms decide theirs. Where the rail's press sends the keyboard (`data-station-fire`) is never a button: a permission's or a
 * plan's answers' row and a question's options are groups that take the focus, and a question with no options lands in its
 * field, where Enter only writes.
 *
 * Used by this module's `AskStageView`, under what the ask would do.
 */
export function AskAnswers(props: AnswerProps) {
  switch (props.need.ask) {
    case 'permission':
      return <PermissionAnswers {...props} />;
    case 'plan':
      return <PlanAnswers {...props} />;
    case 'question':
      return <QuestionAnswers key={props.need.requestId} {...props} />;
  }
}
