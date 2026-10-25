import { Route } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { askHeadline, askIdentity } from '@/modules/dispatcher/askState';
import { useDispatcherPlans } from '@/modules/dispatcher/hooks/useDispatcherPlans';
import { KindTag } from '@/modules/dispatcher/LaneCardHead';
import { useRevealCard } from '@/shared/hooks/useRevealCard';
import type { DispatcherAsk, DispatcherPlan, Kind } from '@/shared/types';
import { Badge, Button, Card, EmptyState, ScrollArea } from '@/shared/ui';

/** The two words of a drawn plan a row reads: its name, the feature it is, and its arc, the epic it belongs to. */
type AskPlan = Pick<DispatcherPlan, 'name' | 'arc'>;

/**
 * One open ask and the drawn plans carrying it, in the lane's order — one row of the list. An epic's lock names every
 * feature of it still owing an Accept, so several plans carry ONE ask; a round stands on one. Never empty: a group exists
 * because a plan carried its ask, and the first plan is the one Answer opens. What the row says the ask stands on is
 * read off the ask (`ask.plans`), not off how many drawn cards carry it: a feature the operator hid is still covered.
 */
type AskGroup = { ask: DispatcherAsk; plans: [AskPlan, ...AskPlan[]] };

/** What a row says the ask stands on: the one feature it names, or — one ask over several features — their epic, and how many of its features the one word covers. */
type Standing = { kind: Kind; name: string; features: number };

/**
 * The drawn plans' open asks as rows, one per ask by identity (`askIdentity`) in the lane's order — the first plan
 * carrying an ask places it, as `arcAsks` places a deck's — each with every drawn plan carrying it. The same count
 * `useDispatcherPlans().waiting` makes: an ask a lock names on three cards is still one row. A plan with no ask carries
 * `asking` null or, from a server older than the key, nothing at all, and owes no row.
 */
function groupAsks(plans: readonly DispatcherPlan[]): AskGroup[] {
  const groups = new Map<string, AskGroup>();
  for (const plan of plans) {
    const ask = plan.asking ?? null;
    if (ask === null) continue;
    const identity = askIdentity(ask);
    const group = groups.get(identity);
    if (group === undefined) groups.set(identity, { ask, plans: [plan] });
    else group.plans.push(plan);
  }
  return [...groups.values()];
}

/**
 * The feature an ask stands on, or the epic when it stands on several of one epic's features (INV-6394: never "plan" or
 * "arc"). Counted off the features the lock names (`ask.plans`), the ones its headline lists, so a feature hidden from
 * its card neither drops out of the count nor turns an epic's Accept into one feature's under that same headline.
 */
function standingOf({ ask, plans }: AskGroup): Standing {
  const covered = ask.plans.length;
  const epic = covered > 1 ? plans[0].arc : null;
  return epic !== null ? { kind: 'epic', name: epic, features: covered } : { kind: 'feature', name: plans[0].name, features: 1 };
}

/** The word the row says is owed: an Accept — over how many features, for an epic's — or a round's questions, counted. */
function owedWord(ask: DispatcherAsk, standing: Standing, t: TFunction): string {
  if (ask.kind === 'questions') return t('inbox.asks.questions', { count: ask.questions.length });
  return standing.kind === 'epic' ? t('inbox.asks.acceptFeatures', { count: standing.features }) : t('inbox.asks.accept');
}

/**
 * ONE ASK, ONE ROW: the prompt's own first line (`askHeadline` — a lock's census line, a round's first question), then
 * what it stands on with the tag the card wears (`KindTag`) and the word owed, and the Answer that opens the card where
 * the answer is given. Nothing is answered here: there is one answer form, on the card.
 *
 * The tag and the name are drawn as the card head draws them — inline, the tag, a space, the mono name — so the row
 * names its feature in the very face the card it opens wears. The meta line wraps and the name is floored at its
 * longest word, the lane card's own rule (INV-4449), so a long epic name breaks by word rather than to a letter a
 * line; Answer stands outside it and never moves. No separator glyph before the word owed: on a narrow row that word
 * wraps under the name, where a dot would be left hanging at a line's end; the gap, the name's ink and mono face
 * against the word's muted sans keep the two apart.
 */
function AskRow({ group, onAnswer }: { group: AskGroup; onAnswer: (plan: string) => void }) {
  const { t } = useTranslation();
  const standing = standingOf(group);

  return (
    <li data-ask-row={askIdentity(group.ask)} data-ask-standing={standing.kind}>
      <Card className="flex items-center gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p data-ask-headline className="line-clamp-2 break-words text-sm font-medium text-foreground">{askHeadline(group.ask)}</p>
          <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="min-w-fit break-words">
              <KindTag kind={standing.kind} />{' '}<span className="font-mono text-foreground">{standing.name}</span>
            </span>
            <span className="whitespace-nowrap">{owedWord(group.ask, standing, t)}</span>
          </p>
        </div>
        {/* Outline: the press opens the card, as the roadmap's own Open its card does, and a column of filled
            buttons would outshout the headlines the reader triages by. It is also the one press whose word clears
            4.5:1 in light (measured: outline 17.7, tonal 4.48, filled 3.01). 44px under a finger; named for what
            it answers, since a reader tabbing down the list hears every row's button. */}
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 max-md:h-11"
          aria-label={t('inbox.asks.answerOn', { name: standing.name })}
          onClick={() => onAnswer(group.plans[0].name)}
        >
          {t('inbox.asks.answer')}
        </Button>
      </Card>
    </li>
  );
}

/**
 * The list as drawn from its groups — the header, then a row per ask or the empty state. `WaitingAsks` is its one
 * caller.
 *
 * Two states and no third: the lane has no loading reading to show (`useDispatcherPlans` collapses "nothing retained
 * yet" into an empty lane on purpose), so an empty list is the one answer before the first frame and after the last
 * word. The column is the Memory section's measure, so flipping between the two keeps the rows where the eye left them.
 */
function WaitingAsksList({ groups, onAnswer }: { groups: AskGroup[]; onAnswer: (plan: string) => void }) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 flex-col" data-waiting-asks={groups.length}>
      {/* The section's own head, in the grammar the Memory and Heal panels open with — the glyph tile, the title, and
          the figure, as Memory's header prints its own — so the three bodies under the Inbox's strip read as one
          frame, and the Roadmap section prints the count its tab carries. The Roadmap's glyph, because Answer lands
          there; the card's own words for an ask, because that is where the answer is given. No figure at zero: the
          empty state says it. */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
          <Route className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-medium">{t('dispatcher.ask.waiting')}</h2>
        {groups.length > 0 && <Badge tone="neutral">{groups.length}</Badge>}
      </header>

      <ScrollArea className="min-h-0 flex-1">
        {groups.length === 0 ? (
          <div className="flex items-center justify-center px-4 py-10">
            <EmptyState icon={Route} title={t('inbox.asks.empty')} message={t('inbox.asks.emptyMessage')} />
          </div>
        ) : (
          <ul className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-5">
            {groups.map((group) => (
              <AskRow key={askIdentity(group.ask)} group={group} onAnswer={onAnswer} />
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

/**
 * Every ask still waiting on the operator's word, one row per ask (`askIdentity`), however many cards carry it — so the
 * rows agree with `useDispatcherPlans().waiting`, which counts asks the same way.
 *
 * Used by the inbox module as the Inbox's Roadmap section, through the dispatcher's barrel.
 */
export function WaitingAsks() {
  const { plans } = useDispatcherPlans();
  const groups = useMemo(() => groupAsks(plans), [plans]);
  // The card is where an answer is given: Answer goes to the house's `?runner=<plan>` landing, the door a push tap uses.
  const reveal = useRevealCard();

  return <WaitingAsksList groups={groups} onAnswer={reveal} />;
}
