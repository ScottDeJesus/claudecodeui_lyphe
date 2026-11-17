import { Undo2Icon } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { HealCardView, HealItemRow } from '@/modules/heal';
import type { HealCard, HealItem, HealSessionsAnswer } from '@/modules/heal';
import { agoWord } from '@/modules/upload-runs/utils/uploadsWords';
import { Banner, Button } from '@/shared/ui';

type RunFrictionSectionProps = {
  /** The heal answer for this run's Claude session; null while it is out, or when it could not be read. */
  friction: HealSessionsAnswer | null;
  /** The heal ledger could not be read. */
  frictionFailed: boolean;
  /** The run named no Claude session (it never came up), so the ledger holds nothing to ask for. */
  noSession: boolean;
  /** The clock a returning stumble's age is counted from, epoch ms. */
  now: number;
  /** Try again, when the ledger could not be read: re-reads what failed. */
  onRetry: () => void;
  /** Opens a friction row's transcript line: the heal module's own press. */
  onOpenFriction: (item: HealItem) => void;
  /** Opens a heal's brief: the heal module's own press. */
  onOpenBrief: (heal: HealCard) => void;
};

/**
 * THE AGENT'S OWN FRICTION: what tripped the agent inside this run, and what the heal reflex did about it. The rows are
 * the heal ledger's rows for the run's Claude session; the cards are the heals that claimed or cured one of them.
 *
 * DRAWN WITH THE HEAL TAB'S OWN PIECES (`HealItemRow`, `HealCardView`, through the heal barrel), so a row and a heal read
 * the same here as there and the two tabs cannot word one thing two ways. Over each card, the heal's own id and this
 * run's part in it: how many of this run's rows the heal claimed and how many it cured (or that it never recorded which: a
 * silence is not a count of none); under it, its builder's own line
 * of what the fix was (or that the builder recorded none). The card itself shows no id, and a came-back line names a heal
 * by its id, so the id over each card is how a reader sees whether that heal is one of these or an older one.
 *
 * A STUMBLE THAT CAME BACK IS NAMED ON ITS OWN ROW. The view's one red mark ("a healed stumble came back", on a type's
 * row) has to lead somewhere, and this is where: over the row a heal had already closed and that returned, a line in the
 * danger tone with its own icon says it came back and how long ago, names the heal that had closed it and prints the
 * shape that returned, both as the ledger wrote them.
 *
 * FOUR STATES, EACH ITS OWN SENTENCE. The ledger could not be read: a banner says so with Try again beside it (the
 * sheet has no Refresh of its own), and nothing here says "no friction". The answer is still out: shimmering rows. The
 * run never named a session: there is nothing to look up. The answer is empty: the agent filed no stumble in this run.
 *
 * Used by this module's `RunSheet`, as its fifth section.
 */
export function RunFrictionSection({ friction, frictionFailed, noSession, now, onRetry, onOpenFriction, onOpenBrief }: RunFrictionSectionProps) {
  const { t } = useTranslation();
  const f = 'cerberus.uploads.sheet.friction';
  const quiet = 'm-0 rounded-lg border border-dashed border-input px-4 py-3.5 text-[13px] text-muted-foreground';

  if (frictionFailed) {
    return (
      <div role="alert" data-uploads-friction="unread">
        <Banner
          tone="warn"
          action={<Button variant="tonal" size="sm" className="h-8 flex-none px-2.5 text-xs max-md:h-11" onClick={onRetry}>{t('cerberus.uploads.trouble.retry')}</Button>}
        >
          <p className="text-[13px] font-medium">{t(`${f}.unread`)}</p>
        </Banner>
      </div>
    );
  }
  if (noSession) return <p className={quiet} data-uploads-friction="no-session">{t(`${f}.noSession`)}</p>;
  if (friction === null) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2" data-uploads-friction="reading">
        {[0, 1].map((row) => <div key={row} className="vv-skeleton h-9" />)}
      </div>
    );
  }
  if (friction.items.length === 0) return <p className={quiet} data-uploads-friction="0">{t(`${f}.none`)}</p>;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-uploads-friction={friction.items.length}>
      {/* A hairline over every row but the first, and none between a came-back line and the row it stands over. */}
      <ul className="m-0 flex min-w-0 list-none flex-col rounded-lg border border-border p-0 [&>li+li]:border-t [&>li+li]:border-border [&>li[data-upload-regression]+li]:border-t-0">
        {friction.items.map((item) => (
          <Fragment key={item.id}>
            {item.regression !== null && (
              <li data-upload-regression={item.id} data-tone="danger" className="flex min-w-0 flex-col gap-1 px-3 pb-0.5 pt-2.5 text-xs leading-snug">
                <span className="flex min-w-0 items-center gap-1.5 font-medium text-tone-ink">
                  <Undo2Icon className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
                  {t(`${f}.cameBack`, { ago: agoWord(t, new Date(item.regression.since * 1000).toISOString(), now) })}
                </span>
                <span className="min-w-0 break-words text-muted-foreground">
                  {t(`${f}.closedBy`)} <span className="font-mono text-foreground">{item.regression.heal_id}</span>
                </span>
                <span className="min-w-0 break-words text-muted-foreground">
                  {t(`${f}.shape`)} <span className="font-mono text-foreground">{item.regression.signature}</span>
                </span>
              </li>
            )}
            <HealItemRow item={item} onOpen={onOpenFriction} />
          </Fragment>
        ))}
      </ul>
      {friction.heals.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">{t(`${f}.noHeal`)}</p>
      ) : (
        <ul className="m-0 flex min-w-0 list-none flex-col gap-4 p-0">
          {friction.heals.map((heal) => (
            <li key={heal.id} className="flex min-w-0 flex-col gap-2" data-upload-heal={heal.id}>
              <p className="m-0 flex min-w-0 flex-col gap-0.5 text-[13px] leading-snug text-foreground">
                <span className="min-w-0 break-words font-mono text-xs text-muted-foreground">{heal.id}</span>
                {/* A heal that never recorded which rows it cured has said nothing of them: that is not a count of none. */}
                <span>{t(`${f}.claimed`, { count: heal.claimed_here.length })} · {heal.cured_here === null ? t(`${f}.curedNotRecorded`) : t(`${f}.cured`, { count: heal.cured_here.length })}</span>
              </p>
              <HealCardView heal={heal} onOpenChain={onOpenBrief} />
              <p className="m-0 min-w-0 break-words text-[13px] leading-relaxed text-muted-foreground" data-upload-heal-fix={heal.fix_said === null ? 'none' : 'said'}>
                {heal.fix_said === null
                  ? t(`${f}.noFix`)
                  : <>{t(`${f}.fix`)} <span className="text-foreground">{heal.fix_said}</span></>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
