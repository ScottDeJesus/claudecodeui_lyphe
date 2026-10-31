import type { TFunction } from 'i18next';
import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { QuestionText } from '@/modules/chat';
import { useActionLapse } from '@/modules/companion/hooks/useActionLapse';
import { useWithdraw } from '@/modules/companion/hooks/useWithdraw';
import { ACTION_SENTENCE, CARRIED_OTHER, CARRIED_TITLE, hourMinute } from '@/modules/companion/utils/actionWords';
import type { CompanionActionTarget, CompanionPendingAction } from '@/shared/companion-types';
import { Button, Card, CardFoldBody, Collapsible, CollapsibleTrigger, FoldChevron, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

type CompanionActionCardProps = {
  /** The one action waiting for his word, as her picture holds it. */
  pending: CompanionPendingAction;
  /** Her name, for the hint on the Withdraw ×. */
  name: string;
  /**
   * Takes the action off his panel, and nothing is done. A refusal rejects with the server's sentence, which the card says
   * at its foot. Absent, the × is not drawn: a page that cannot withdraw the action does not offer to.
   */
  onWithdraw?: () => Promise<void>;
};

/** The house's caption type (MAN-742), here naming his carried lines; the ink is the muted one, which holds AA where the faint does not. */
const CAPTION = 'text-xs uppercase tracking-[0.14em] text-muted-foreground';

/** The well the prompt, a follow-up's words and his lines each stand in. */
const WELL = 'rounded-md border border-border bg-background px-2.5 py-2';

/** A well that scrolls inside its own cap: the prompt's alone. His lines never do. */
const SCROLLS = 'scrollbar-thin min-h-0 overflow-y-auto overscroll-contain';

/**
 * The target's kind and the house's own names for it, beside the name she says: what tells it apart from a card of a like
 * name. A feature names its plan and its epic, an epic its name (the wire marks one `<name>.arc`), a run its plan and its
 * id (two runs of one task differ only at the id's end, so the line wraps rather than cut it), a page its id and the block
 * an open lands on, a follow-up its number, her memory how many things it keeps, a check its node and its key. (A check is what
 * her open records; no pending action holds one, so the card never draws this branch — the switch is closed for the type's sake.)
 */
function targetFacts(target: CompanionActionTarget, t: TFunction): string {
  switch (target.kind) {
    case 'card':
      return target.name.endsWith('.arc')
        ? [t('companion.action.kind.epic', 'Epic'), target.name.slice(0, -'.arc'.length)].join(' · ')
        : [
          t('companion.action.kind.feature', 'Feature'),
          target.name,
          ...(target.arc ? [t('companion.action.inEpic', { epic: target.arc, defaultValue: 'epic {{epic}}' })] : []),
        ].join(' · ');
    case 'run':
      return [t('companion.action.kind.run', 'Run'), ...(target.plan ? [target.plan] : []), target.runId].join(' · ');
    case 'page':
      return [
        t('companion.action.kind.page', 'DocSpace page'),
        target.pageId,
        ...(target.blockId ? [t('companion.action.atBlock', { block: target.blockId, defaultValue: 'block {{block}}' })] : []),
      ].join(' · ');
    case 'chat':
      return t('companion.action.kind.chat', 'Chat');
    case 'followup':
      return t('companion.action.kind.followup', { id: target.id, defaultValue: 'Follow-up #{{id}}' });
    case 'memory':
      return t('companion.action.kind.memory', { count: target.count, defaultValue_one: 'Your memory, {{count}} thing kept', defaultValue_other: 'Your memory, {{count}} things kept' });
    case 'check':
      return [t('companion.action.kind.check', 'Check'), target.node, target.key].join(' · ');
  }
}

/**
 * THE ACTION WAITING FOR HIS WORD: the one thing on screen that says what will happen. She reads it back to him in her own
 * words and judges from the conversation whether he agreed, so all of it is here to be read at a glance, on a phone too, while
 * she does. The card gives him no phrase to say: there is none. Drawn by this module's CompanionPanel in
 * her dock, above the draft: the draft's sibling, with the same Card, the same eyebrow's type and a target line under it.
 * Its second home is the head of the station module's right rail, "What needs you" (`WhatNeedsYouView`, through the
 * barrel), drawn there exactly as here: the rail's scroller is the edge its foot sticks to.
 * On the station's phone it stands in one line too, over the bar (`CompanionActionLine`: its sentence and lapse from
 * `utils/actionWords.ts`, its deadline this one's), and that line's press leads to this card.
 *
 * TOP, standing: the waiting mark and "Waiting for your word" in the warn tone (an amber pulse, the Roadmap's own mark for a
 * prompt waiting on him, and words beside it, never the colour alone), and the × that withdraws it. Then the action as a
 * sentence — "Queue **Lane drag**", the target in the weight of the thing acted on — and under it the target's kind and
 * house names, wrapping to a second line rather than cut, so a card or a run of a like name is told apart. BODY, bounded:
 * the prompt (the Accept census whole, or the questions with their options), or a follow-up's own words, drawn as the
 * Roadmap draws the census (QuestionText), in a well that scrolls inside its cap; then his carried lines, quoted, each with
 * the time he said it, under the question each answers — one group per question for a round, a question he left unanswered
 * said as such ("No answer — it goes as “(no answer)”"), one unlabelled group for notes or rulings — in a well of their own.
 * HIS LINES ARE THE LAST TO GIVE WAY: they are what travels, word for word, so their well has no cap, no scroll and no tab
 * stop, and they stand whole in the card at whatever length he spoke them. The prompt gives way instead: beside his lines it
 * keeps a 12% peek of the panel's height (it is a size container), and in a round, where every question already heads his
 * answers to it, the questions with their options fold away behind one press. A prompt alone takes 30%. FOOT, set apart in
 * the tone's wash: "Lapses at 14:07", in the 24-hour clock she says it in, and a refused Withdraw's sentence under it. It is
 * sticky to the dock's bottom edge: whenever the dock is too short for the whole card (a phone's keyboard up, a phone on its
 * side), when it lapses stays in sight while any of the card is.
 *
 * It never shrinks. While it stands the dock has no cap of its own, so the room it needs comes first from the log, down to the
 * log's floor, then from the notes and the draft's field, down to theirs; past that the dock scrolls as one region, this card
 * whole within it and its foot in sight. A lapsed card draws nothing, and the dock with nothing else in it closes.
 */
export function CompanionActionCard({ pending, name, onWithdraw }: CompanionActionCardProps) {
  const { t } = useTranslation();
  const headId = useId();
  const carriedId = useId();
  // Whether a round's questions, with their options, are unfolded. Folded at first: each question already heads his answers
  // to it, so the room goes to what travels. One action's own, as the panel keys this card by the action.
  const [questionsShown, setQuestionsShown] = useState(false);

  // His × (`useWithdraw`): busy while the call is out, and a refusal said at the card's foot; withdrawn, the card goes by its own frame.
  const { withdrawing, refusal, withdraw } = useWithdraw(onWithdraw);
  // The page's one deadline (`useActionLapse`): from `pending.expiresAt` the card draws nothing.
  const lapsed = useActionLapse(pending.expiresAt);

  if (lapsed) return null;

  const sentence = ACTION_SENTENCE[pending.action];
  const carriedTitle = CARRIED_TITLE[pending.action] ?? CARRIED_OTHER;
  const facts = targetFacts(pending.target, t);
  // What the action acts on, in words of its own: the prompt she read back, else a follow-up's text (its words are what closes).
  const subject = pending.prompt ?? (pending.target.kind === 'followup' ? pending.target.text : null);
  // A question with no lines is one he left unanswered, and stays to say so; notes or rulings with none say nothing.
  const carried = pending.carried.filter((group) => group.label !== null || group.lines.length > 0);
  const beside = subject !== null && carried.length > 0;
  // In a round the questions fold away: each already heads his answers to it. Opened, they take what he asked to read.
  const round = beside && pending.action === 'answer';

  const promptWell = subject !== null && (
    <div
      role="region"
      aria-label={pending.prompt === null ? t('companion.action.followup', 'The follow-up') : t('companion.action.prompt', 'The prompt')}
      tabIndex={0}
      data-companion-action-prompt=""
      className={cn(WELL, SCROLLS, round ? 'max-h-[24cqh]' : beside ? 'max-h-[12cqh]' : 'max-h-[30cqh]')}
    >
      <QuestionText text={subject} />
    </div>
  );

  return (
    <Card
      role="region"
      aria-labelledby={headId}
      data-tone="warn"
      data-companion-action={pending.action}
      data-companion-action-target={pending.target.kind}
      className="flex shrink-0 flex-col gap-2 border-tone-ink/40 p-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className="vv-pulse size-2 shrink-0 rounded-full bg-tone-ink" />
        <p id={headId} data-companion-action-head="" className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-[0.14em] text-tone-ink">
          {t('companion.action.waiting', 'Waiting for your word')}
        </p>
        {onWithdraw && (
          // Lent 6px of the padding above and below, so the row stands at its words' height and the × keeps its 28px.
          <div className="-my-1.5 flex shrink-0">
            {/* To the ×'s left: it stands at the window's right edge, where a bubble centred over it runs off the screen. */}
            <Tooltip content={t('companion.action.withdrawHint', { name, defaultValue: 'Withdraw: {{name}} won\'t do it' })} position="left">
              <Button
                variant="ghost"
                size="icon"
                busy={withdrawing}
                aria-label={t('companion.action.withdraw', 'Withdraw')}
                onClick={withdraw}
                // 28px to look at, a 40px catch under a mouse and 44px under a finger (Verve's touch floor), as a note's ✕: below
                // 768 px as well as under a coarse pointer (`max-md:` beside it, the station's touch law being keyed on width).
                className="relative h-7 w-7 text-muted-foreground before:absolute before:-inset-1.5 before:content-[''] hover:text-foreground max-md:before:-inset-2 [@media(pointer:coarse)]:before:-inset-2"
              >
                <X aria-hidden="true" />
              </Button>
            </Tooltip>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 data-companion-action-what="" className="break-words text-base leading-snug text-foreground">
          <Trans
            t={t}
            i18nKey={sentence.key}
            defaults={sentence.english}
            // The name rides as the slot's own child, so a name holding "<" reads as written.
            components={{ target: <strong className="font-semibold">{pending.target.spoken}</strong> }}
          />
        </h3>
        <p data-companion-action-facts="" title={facts} className="line-clamp-2 break-words text-xs text-muted-foreground">{facts}</p>
      </div>

      {round ? (
        <Collapsible open={questionsShown} onOpenChange={setQuestionsShown} data-companion-action-questions="" className="flex min-w-0 flex-col">
          <CollapsibleTrigger className="flex items-center gap-1.5 self-start rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground max-md:min-h-11 [@media(pointer:coarse)]:min-h-11">
            <FoldChevron collapsed={!questionsShown} />
            {t('companion.action.questions', 'The questions, with their options')}
          </CollapsibleTrigger>
          {/* Inert while folded, so the well's tab stop and its words leave with it. */}
          <CardFoldBody>
            <div className="pt-1.5">{promptWell}</div>
          </CardFoldBody>
        </Collapsible>
      ) : promptWell}

      {carried.length > 0 && (
        <div data-companion-action-carried="" className="flex min-w-0 flex-col gap-1">
          <p id={carriedId} className={CAPTION}>{t(carriedTitle.key, carriedTitle.english)}</p>
          {/* No cap, no scroll, no tab stop: his lines are what travels, and they stand whole (the dock scrolls past them). */}
          <div role="region" aria-labelledby={carriedId} className={cn(WELL, 'flex flex-col gap-2')}>
            {carried.map((group, groupIndex) => (
              // A round's questions are its labels, one group each in the round's order, and two may read alike: the group's
              // place is its key, as it is on the wire. Notes and rulings are the one unlabelled group.
              <div key={groupIndex} data-companion-action-group="" className="flex min-w-0 flex-col gap-1">
                {group.label !== null && <p className="break-words text-xs font-semibold leading-snug text-foreground">{group.label}</p>}
                {group.lines.length === 0 ? (
                  <p data-companion-action-unanswered="" className="flex items-start gap-1.5 text-xs leading-snug text-tone-ink">
                    <span aria-hidden="true">▲</span>
                    {t('companion.action.noAnswer', 'No answer — it goes as “(no answer)”')}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {group.lines.map((line, lineIndex) => (
                      // The same line may answer twice; its place keeps the key whole.
                      <li key={`${line.logId}:${lineIndex}`} data-companion-action-line="" className="break-words text-sm leading-snug text-foreground">
                        {t('companion.action.quoted', { text: line.text, defaultValue: '“{{text}}”' })}{' '}
                        <time dateTime={line.at} className="whitespace-nowrap pl-0.5 text-xs text-muted-foreground">
                          {hourMinute(line.at)}
                        </time>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sticky to the dock's bottom edge (its wash is opaque): in a dock too short for the card, it rides over the wells,
          and a refused Withdraw is said inside it, so the refusal is in sight with the lapse it stands beside. It sits on the
          edge itself (`-bottom-1` takes back the dock's 4px foot padding), and a ring of the card's own ground masks the words
          passing under its rounded corners; resting in the card, the ring is the card's colour and draws nothing. */}
      <div data-companion-action-foot="" className="sticky -bottom-1 z-[1] flex min-w-0 flex-col gap-1 rounded-md bg-tone-soft px-2.5 py-2 shadow-[0_0_0_0.375rem_var(--surface)]">
        <p className="text-xs leading-snug text-tone-ink">
          <time data-companion-action-lapse="" dateTime={pending.expiresAt}>
            {t('companion.action.lapses', { time: hourMinute(pending.expiresAt), defaultValue: 'Lapses at {{time}}' })}
          </time>
        </p>
        {refusal !== null && (
          <p role="alert" className="flex items-start gap-1.5 text-xs leading-relaxed text-tone-ink">
            <span aria-hidden="true">▲</span>
            {refusal}
          </p>
        )}
      </div>
    </Card>
  );
}
