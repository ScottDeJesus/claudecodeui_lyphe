import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { useCerberus } from '@/modules/cerberus/context/CerberusContext';
import { NeedFix } from '@/modules/cerberus/fleet/NeedFix';
import { useLeavingNeeds } from '@/modules/cerberus/hooks/useLeavingNeeds';
import { StatusGlyph } from '@/modules/cerberus/StatusMarks';
import { STATUS_TABLE } from '@/modules/cerberus/utils/cerberusStatus';
import { hm, hms } from '@/modules/cerberus/utils/cerberusTime';
import type { CerberusCheckView, CerberusNeed, CerberusOverview } from '@/shared/cerberus-types';
import type { CerberusSheetTarget } from '@/shared/types';
import { Button, Card } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** "48 min left", "1 h 12 min left": how long a mute has before it lifts on its own, never under a minute. */
function timeLeft(t: TFunction, until: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((until - now) / 60_000));
  return minutes >= 60
    ? t('cerberus.time.hoursMinutesLeft', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
    : t('cerberus.time.minutesLeft', { count: minutes });
}

type NeedCardProps = {
  /** The card's whole need: its check, the fix offered for it and its recent run, which `NeedFix` reads. */
  need: CerberusNeed;
  /** It stopped needing you: drawn for .55 s more as it leaves, and no longer pressable. */
  leaving: boolean;
  onOpen: (target: CerberusSheetTarget) => void;
  onMute: (check: CerberusCheckView) => void;
};

/**
 * One check that needs you: its glyph (ringing while it fails), its name and word, where it runs and
 * since when, its raw key, and what it last reported, cut at two lines so a health document's prose
 * cannot stretch a row of cards (the whole of it on hover, and in the sheet); then its actions. A check
 * with no label yet is named by its key, in mono, which then is not written a second time under it.
 * The glyph is decoration: its word is written beside it.
 */
function NeedCard({ need, leaving, onOpen, onMute }: NeedCardProps) {
  const { t } = useTranslation();
  const { check } = need;
  const look = STATUS_TABLE[check.status];
  const service = check.serviceLabel ?? check.service;
  return (
    <li
      aria-hidden={leaving || undefined}
      className={cn(
        'flex min-w-0 max-w-[560px] flex-[1_1_320px] flex-col gap-[9px] rounded-[10px] border border-border bg-card px-3.5 pb-3.5 pt-3',
        leaving
          ? 'pointer-events-none motion-safe:animate-[vv-toast-out_.55s_ease_both] motion-reduce:hidden'
          : 'motion-safe:animate-[vv-pop_.5s_theme(transitionTimingFunction.enter)_both]',
      )}
    >
      <div className="flex items-start gap-2.5">
        <StatusGlyph status={check.status} still={leaving} decorative />
        <button
          type="button"
          disabled={leaving}
          // The sheet on this check, at now: the root's onOpenCell with the check's id inside its service.
          onClick={() => onOpen({ node: check.node, service: check.service, check: check.id })}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block text-[14.5px] font-medium">
            {check.label ?? <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{check.key}</span>}{' '}
            <span data-tone={look.tone} className="text-tone-ink">{t('cerberus.needs.word', { word: t(look.wordKey) })}</span>
          </span>
          <span className="block text-[12.5px] tabular-nums text-muted-foreground">
            {check.since === null
              ? t('cerberus.needs.whereNoSince', { service, node: check.node })
              : t('cerberus.needs.where', { service, node: check.node, time: hms(check.since) })}
          </span>
          {check.label !== null && <span className="block font-mono text-[11.5px] text-ink-faint [overflow-wrap:anywhere]">{check.key}</span>}
        </button>
      </div>
      {check.value !== null && (
        <p title={check.value} className="line-clamp-2 pl-[34px] text-[13px] text-secondary-foreground [overflow-wrap:anywhere]">
          {check.value}
        </p>
      )}
      <div className="flex flex-wrap gap-2 pl-[34px]">
        {/* The run strip on a line of its own above the row's buttons, then Run “<fix>” (tonal). */}
        <NeedFix need={need} leaving={leaving} onOpen={onOpen} />
        {/* SLOT: actions — the diagnosis plan's Diagnose / Diagnosing… / See diagnosis (outline), after the fix and before Mute. */}
        <Button
          variant="ghost"
          size="sm"
          disabled={leaving}
          // The Mute dialog on this check, which the root opens.
          onClick={() => onMute(check)}
        >
          {t('cerberus.needs.mute')}
        </Button>
      </div>
    </li>
  );
}

type NeedsYouCardProps = {
  /** The overview's checks that need a person, oldest `since` first: the read model's own order, kept. */
  needs: CerberusNeed[];
  /** The checks a mute covers now. */
  muted: CerberusCheckView[];
  counts: CerberusOverview['counts'];
  /** The read's own moment: what a mute's "min left" counts down from. */
  now: number;
  /** Opens the check sheet on a card's check, at now. */
  onOpen: (target: CerberusSheetTarget) => void;
  /** Opens the Mute dialog on a card's check. */
  onMute: (check: CerberusCheckView) => void;
};

/**
 * NEEDS YOU: the top of the Fleet, the checks a person should look at now, oldest first.
 *
 * Each card says what is wrong in words before anything else ("Session is valid · Failing"), then
 * where and since when, then what it reported, then what can be done: first the card's fix (`NeedFix`,
 * its run's strip on a line of its own, then Run “<fix>”), then Mute (the diagnosis plan adds its buttons
 * before it). A card that stops needing you does not blink out: it stays where it
 * was for .55 s, its strip as it was drawn, and leaves on `vv-toast-out`. With motion reduced it is simply gone.
 *
 * With nothing to ask for, the card says so: "✓ Nothing needs you" and "N of M checks passing." Then, while
 * any catalog entry is set to run on its own, "Fixes set to auto-run will run on their own and show up below."
 *
 * Under them, while any mute is set, "Muted · N": each muted check, "Until 18:40 · 48 min left · <the
 * reason>", and Unmute.
 *
 * Used by Fleet's `FleetView`, above the fleet.
 */
export function NeedsYouCard({ needs, muted, counts, now, onOpen, onMute }: NeedsYouCardProps) {
  const { t } = useTranslation();
  // Each of `needs` in its order, then a card that stopped needing you kept at its place while it leaves.
  const cards = useLeavingNeeds(needs);
  // The catalog says whether any entry runs on its own, which the quiet line's last sentence is about.
  const { liftMute, catalog } = useCerberus();
  // The mute lifts early; `liftMute` reads the overview again, so the row leaves Muted and, when the
  // check still fails, its card is back in Needs you. A refused lift raises its own toast.
  const onUnmute = (muteId: string) => {
    void liftMute(muteId);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-baseline justify-between px-[18px] pb-3 pt-4">
        <h2 className="text-xs uppercase tracking-[.14em] text-ink-faint">{t('cerberus.needs.title')}</h2>
        {needs.length > 0 && <span className="text-xs text-ink-faint">{t('cerberus.needs.count', { count: needs.length })}</span>}
      </div>

      {cards.length > 0 && (
        <ul className="flex flex-wrap gap-2.5 px-3.5 pb-3.5">
          {/* Each card is handed its whole need: `useLeavingNeeds` keeps a leaving card's need, so it leaves with its strip as it was drawn. */}
          {cards.map(({ need, leaving }) => (
            <NeedCard key={`${need.check.node}/${need.check.key}`} need={need} leaving={leaving} onOpen={onOpen} onMute={onMute} />
          ))}
        </ul>
      )}

      {needs.length === 0 && (
        <div className="flex flex-col gap-1 px-[18px] pb-[18px]">
          <div className="flex items-center gap-3">
            {/* The ✓ grows in, then rings once: two motions on two boxes, because one box runs one animation. */}
            <span className="flex-none rounded-full motion-safe:animate-[vv-ring_1.4s_.5s_ease-out_1]">
              <span className="block motion-safe:animate-cerberus-check" style={{ animationDelay: '100ms' }}>
                <StatusGlyph status="ok" size="lg" decorative />
              </span>
            </span>
            <span className="font-serif text-[22px] italic motion-safe:animate-shape-rise">{t('cerberus.needs.quiet')}</span>
          </div>
          <p className="text-[13.5px] text-muted-foreground">
            {t('cerberus.needs.quietPassing', { passing: counts.passing, count: counts.checks })}
            {catalog?.some((entry) => entry.auto) && ` ${t('cerberus.fix.quiet')}`}
          </p>
        </div>
      )}

      {muted.length > 0 && (
        <div className="flex flex-col gap-2.5 border-t border-border bg-background px-[18px] pb-3.5 pt-3">
          <h3 className="text-xs uppercase tracking-[.14em] text-ink-faint">{t('cerberus.needs.mutedTitle', { count: muted.length })}</h3>
          <ul className="flex flex-col gap-2.5">
            {muted.flatMap((check) => (check.mute === null ? [] : [{ check, mute: check.mute }])).map(({ check, mute }) => (
              <li key={mute.id} className="flex items-center gap-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-secondary-foreground [overflow-wrap:anywhere]">
                    {t('cerberus.needs.mutedItem', { label: check.label ?? check.key, service: check.serviceLabel ?? check.service })}
                  </div>
                  <div className="text-[12.5px] text-muted-foreground">
                    {t('cerberus.needs.mutedMeta', { time: hm(mute.until), left: timeLeft(t, mute.until, now), reason: mute.reason })}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => onUnmute(mute.id)}>
                  {t('cerberus.needs.unmute')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
