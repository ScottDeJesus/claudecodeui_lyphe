import { HeartPulseIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { usePaletteOps } from '@/modules/command-palette';
import {
  agoWord,
  athenaTone,
  byMotionThenNewest,
  fileName,
  statusTone,
  statusWord,
  usd,
} from '@/modules/heal/healState';
import { bookedBy } from '@/modules/heal/healTypes';
import type { HealCard, HealQueueItem } from '@/modules/heal/healTypes';
import { Badge, Button, Card, CardContent, CardFooter, CardHeader, CardTitle, Chip, EmptyState } from '@/shared/ui';

/** How many claimed shapes a card NAMES before the rest are counted. A card is a summary and one heal
 *  can cure hundreds of shapes at once; the full list is in the heal's own brief, one press away. The
 *  COUNT comes from `heal.shapes_claimed` (the heal's total) and never from the array's length — the
 *  worker ships only the first `SIGNATURES_SHOWN` (12) shapes, so the array is a head, not the set. */
const SHAPE_CHIPS = 3;

/**
 * Every heal the reflex has run, each as a whole card in the run card's shape, and beneath them the
 * runner heal queue's own items — THE SECOND DOOR, in a group of its own and read-only here: the
 * runner writes that queue and nothing on this tab may.
 *
 * A running card leads. A PARKED card says why it is waiting and when it fires, in a banner above
 * its facts, so a heal that is standing still is never mistaken for one nobody started.
 */
export function HealCardList({ heals, queue }: { heals: HealCard[]; queue: HealQueueItem[] }) {
  const { t } = useTranslation();
  const { openFileReference } = usePaletteOps();
  /**
   * What a heal's chain can be opened BY. The record itself
   * (`state/dispatch-chains/chain-<slug>-<stamp>-<hex>/chain.json`) is not addressable from here: the
   * runner mints that trailing hex, no route in this app lists that store, and the Runner tab carries
   * the runner's own runs (`state/runner`), which a heal's chain is not. The heal's OWN id is exact,
   * and it names the brief the chain was handed — `state/heal_reflex/briefs/<heal id>.md`, written for
   * every heal whose chain started, and that is what a reader wants open: the friction that heal was
   * told to fix. The briefing is written before the launch and only a PROVED launch gets a
   * `chain_id`, which is why this press is offered exactly where the button is.
   */
  const onOpenChain = (heal: HealCard) => {
    if (heal.chain_id === null) return;
    openFileReference(`state/heal_reflex/briefs/${heal.id}.md`, 1);
  };

  const ordered = [...heals].sort(byMotionThenNewest);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-heal-heals>
      {ordered.length === 0 ? (
        <div className="flex items-center justify-center px-4 py-8">
          <EmptyState
            icon={HeartPulseIcon}
            title={t('heal.cards.empty.title', { defaultValue: 'No heal has run yet' })}
            message={t('heal.cards.empty.message', { defaultValue: 'A cycle fires them — nightly on the schedule, or Run a cycle now.' })}
          />
        </div>
      ) : (
        <ul className="flex min-w-0 flex-col gap-3" data-heal-cards>
          {ordered.map((heal) => (
            <li key={heal.id} className="min-w-0">
              <HealCardView heal={heal} onOpenChain={onOpenChain} />
            </li>
          ))}
        </ul>
      )}

      {/* The runner's queue is a different door with a different owner, and the dashed frame and
          the read-only mark say so before the reader looks for a verb that is not here. */}
      <section aria-labelledby="heal-queue-title" className="flex min-w-0 flex-col gap-2 rounded-lg border border-dashed border-border p-3" data-heal-queue>
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="heal-queue-title" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('heal.queue.title', { defaultValue: 'Runner heal queue — the second door' })}
          </h3>
          <Badge as="span" tone="neutral">{t('heal.queue.readOnly', { defaultValue: 'read-only' })}</Badge>
        </div>
        {queue.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('heal.queue.empty', { defaultValue: 'The runner’s queue is empty.' })}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {queue.map((item) => (
              <li key={item.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-2 text-xs" data-heal-queue-item={item.id}>
                <span className="font-mono">{fileName(item.plan)}</span>
                <span className="text-muted-foreground">{t('heal.queue.phase', { defaultValue: 'phase {{phase}}', phase: item.phase })}</span>
                <Badge as="span" tone={item.status === 'queued' ? 'info' : 'neutral'}>{item.status}</Badge>
                <span className="w-full min-w-0 break-words text-muted-foreground">{item.cause}</span>
                <span className="text-muted-foreground">
                  {item.next
                    ? t('heal.queue.next', { defaultValue: 'next: {{next}}', next: item.next })
                    : t('heal.queue.noNext', { defaultValue: 'no next step named' })}
                  {' · '}
                  {agoWord(item.enqueued_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Athena's verdict in as few words as it needs: clean, or only the severities that are non-zero. */
function athenaLine(counts: HealCard['athena'], t: ReturnType<typeof useTranslation>['t']): string {
  if (counts === null) return t('heal.cards.athenaPending', { defaultValue: 'Athena · not yet' });
  const parts = (['blocking', 'high', 'medium', 'low'] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}`);
  return parts.length === 0
    ? t('heal.cards.athenaClean', { defaultValue: 'Athena · clean' })
    : `Athena · ${parts.join(' · ')}`;
}

/**
 * Whose figure the number beside the row is — one clause per recipe, because one clause for both would
 * be false of half the cards this tab can draw. `bookedBy` reads the change off the row's own ending;
 * a walking heal has booked nothing, and one that landed before 2026-09-23 12:32 carries the Claude
 * stages its chain rode, which were never DeepSeek dollars even though the daily cap counts them.
 */
function costTitle(heal: HealCard, t: ReturnType<typeof useTranslation>['t']): string {
  const booked = bookedBy(heal);
  if (booked === 'unbooked') {
    return t('heal.cards.costTitleUnbooked', { defaultValue: 'Nothing booked yet — a heal books its cost when it ends' });
  }
  if (booked === 'chain-total') {
    return t('heal.cards.costTitleOld', { defaultValue: 'Booked before 2026-09-23, when a heal booked its chain’s WHOLE bill: the Claude stages in this number were your subscription, not DeepSeek — though the daily cap counts them as DeepSeek all the same' });
  }
  return t('heal.cards.costTitle', { defaultValue: 'DeepSeek’s share of this heal — what the daily cap counts, never the chain’s whole bill' });
}

function HealCardView({ heal, onOpenChain }: { heal: HealCard; onOpenChain: (heal: HealCard) => void }) {
  const { t } = useTranslation();
  const chainId = heal.chain_id;
  const ended = heal.status === 'done' || heal.status === 'blocked';
  const clock = ended && heal.ended_at !== null
    ? t('heal.cards.ended', { defaultValue: 'ended {{ago}}', ago: agoWord(heal.ended_at) })
    : agoWord(heal.started_at);

  return (
    <Card className="w-full min-w-0" data-heal-card data-heal-id={heal.id} data-heal-status={heal.status}>
      <CardHeader className="gap-2 p-3 pb-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {/* The KIND is the name: it is what the heal was scoped to and what the hold was taken on. */}
          <CardTitle className="w-full min-w-0 break-words font-mono text-sm leading-snug">{heal.kind}</CardTitle>
          <p className="w-full min-w-0 break-words text-xs leading-snug text-muted-foreground">
            {t('heal.cards.by', { defaultValue: 'Fired by {{reason}} · built by {{builder}}', reason: heal.reason, builder: heal.builder })}
          </p>
          <Badge tone={statusTone(heal.status)}>{statusWord(heal.status)}</Badge>
          <span className="flex-none font-mono text-xs text-muted-foreground">{clock}</span>
        </div>
      </CardHeader>

      <CardContent className="flex min-w-0 flex-col gap-2 p-3 pt-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
          <Badge as="span" tone={athenaTone(heal.athena)}>{athenaLine(heal.athena, t)}</Badge>
          <Badge as="span" tone={heal.closed > 0 ? 'positive' : 'neutral'}>
            {t('heal.cards.closed', { defaultValue: '{{count}} rows closed', count: heal.closed })}
          </Badge>
          {/* The after-landing mark is a fact about a heal that LANDED; a running one has no "after". */}
          {heal.status === 'done' && (heal.spikes > 0 ? (
            <Badge as="span" tone="danger">{t('heal.cards.spike', { defaultValue: '↑ {{count}} filed after landing', count: heal.spikes })}</Badge>
          ) : (
            <Badge as="span" tone="positive">{t('heal.cards.quiet', { defaultValue: 'quiet after landing' })}</Badge>
          ))}
          {/* The row's `cost_usd` is today the DeepSeek share of what the chain spent — the same figure
              the daily cap counts, and not the chain's own total (a stage that rode Claude is the
              operator's subscription). WHICH OF THOSE THIS NUMBER IS DEPENDS ON WHEN THE HEAL ENDED,
              and the title says whose it is — the rows already on screen were booked before the recipe
              changed and carry their chains' whole bills. */}
          <span className="ml-auto font-mono text-muted-foreground" title={costTitle(heal, t)}>{usd(heal.cost_usd)}</span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{t('heal.cards.shapes', { defaultValue: 'Shapes claimed:' })}</span>
          {heal.shapes_claimed === 0 ? (
            <span className="text-muted-foreground">{t('heal.cards.noShapes', { defaultValue: 'none yet' })}</span>
          ) : (
            <>
              {heal.signatures_claimed.slice(0, SHAPE_CHIPS).map((signature) => (
                <Chip key={signature} size="sm" tone="neutral" title={signature} className="max-w-[18rem]">
                  <span className="block truncate font-mono">{signature}</span>
                </Chip>
              ))}
              {/* The COUNT is the heal's own total (`shapes_claimed`), not the length of the head the
                  payload carries: the worker ships `SIGNATURES_SHOWN` shapes, so a card whose claim is
                  larger would otherwise say "+9 more" when the heal cured five hundred. */}
              {heal.shapes_claimed > SHAPE_CHIPS && (
                <span className="text-muted-foreground"
                      title={heal.signatures_claimed.slice(SHAPE_CHIPS).join('\n')}>
                  {t('heal.cards.moreShapes', { defaultValue: '+{{count}} more', count: heal.shapes_claimed - SHAPE_CHIPS })}
                </span>
              )}
            </>
          )}
        </div>
      </CardContent>

      {chainId !== null && (
        <CardFooter className="gap-2 p-3 pt-0">
          {/* The press opens the heal's BRIEF, so the label says brief — a button labelled "chain"
              handing back a different file is a control that lies about its own reach. The file it
              opens is named in the tooltip, since that is what a reader wants to know. */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenChain(heal)}
            title={`state/heal_reflex/briefs/${heal.id}.md`}
            data-heal-open-chain
          >
            {t('heal.cards.openBrief', { defaultValue: 'Open brief' })}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
