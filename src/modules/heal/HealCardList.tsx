import { HeartPulseIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { usePaletteOps } from '@/modules/command-palette';
import {
  agoWord,
  athenaTone,
  byMotionThenNewest,
  statusTone,
  statusWord,
} from '@/modules/heal/healState';
import { bookedBy } from '@/modules/heal/healTypes';
import type { HealCard } from '@/modules/heal/healTypes';
import { spendText } from '@/shared/spend';
import { Badge, Button, Card, CardContent, CardFooter, CardHeader, CardTitle, Chip, EmptyState } from '@/shared/ui';

/** How many claimed shapes a card NAMES before the rest are counted. A card is a summary and one heal
 *  can cure hundreds of shapes at once; the full list is in the heal's own brief, one press away. The
 *  COUNT comes from `heal.shapes_claimed` (the heal's total) and never from the array's length — the
 *  worker ships only the first `SIGNATURES_SHOWN` (12) shapes, so the array is a head, not the set. */
const SHAPE_CHIPS = 3;

/**
 * Every heal the reflex has run, each as a whole card in the run card's shape.
 *
 * A running card leads. A PARKED card says why it is waiting and when it fires, in a banner above
 * its facts, so a heal that is standing still is never mistaken for one nobody started.
 */
export function HealCardList({ heals }: { heals: HealCard[] }) {
  const { t } = useTranslation();
  const { openFileReference } = usePaletteOps();
  /**
   * What a heal's chain can be opened BY. The record itself
   * (`state/dispatch-chains/chain-<slug>-<stamp>-<hex>/chain.json`) is not addressable from here: the
   * runner mints that trailing hex, no route in this app lists that store, and the Runner tab carries
   * the dispatcher's own plans, which a heal's chain is not. The heal's OWN id is exact,
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
            message={t('heal.cards.empty.message', { defaultValue: 'A cycle fires them — Run a cycle now opens one over the live friction.' })}
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
  return t('heal.cards.costTitle', { defaultValue: 'DeepSeek’s share of this heal — what the daily cap counts, never the chain’s whole bill. The tokens beside it are the chain’s Claude souls’ own work — a vendor’s tokens are its own business, so a heal only DeepSeek walked draws none' });
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
          {/* A SPEND FIGURE IS DOLLARS **OR** TOKENS, BY WHO WAS USED (operator rule, 2026-09-24): the row's
              `cost_usd` is the DeepSeek share of what the chain spent — what the daily cap counts — and the
              `tokens*` beside it are the chain's CLAUDE half alone, so a heal that only ever paid the vendor
              draws its `$` and no tokens and one that rode the subscription draws its tokens and no `$`
              (`spendText`, the one spelling every card uses). WHICH NUMBER THE `$` IS depends on when the
              heal ended — the title says whose it is, because the rows on screen from before the 2026-09-23
              recipe change carry their chains' whole bills. An empty cell when the worker recorded neither. */}
          <span className="ml-auto font-mono text-muted-foreground" title={costTitle(heal, t)}>
            {spendText(t, heal.cost_usd, heal.tokens_in, heal.tokens_out, heal.tokens)}
          </span>
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
