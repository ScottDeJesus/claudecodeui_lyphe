import { BellOff, Stethoscope } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DiagnoseButton } from '@/modules/cerberus/DiagnoseButton';
import { NeedFix } from '@/modules/cerberus/fleet/NeedFix';
import { StatusGlyph } from '@/modules/cerberus/StatusMarks';
import { STATUS_TABLE } from '@/modules/cerberus/utils/cerberusStatus';
import { hms } from '@/modules/cerberus/utils/cerberusTime';
import type { CerberusCheckView, CerberusNeed } from '@/shared/cerberus-types';
import type { CerberusSheetTarget } from '@/shared/types';
import { Button, IconWord } from '@/shared/ui';
import { cn } from '@/shared/utils';

type NeedCardProps = {
  /** The card's whole need: its check, the fix offered for it and its recent run, which `NeedFix` reads. */
  need: CerberusNeed;
  /** It stopped needing you: drawn for .55 s more as it leaves, and no longer pressable. */
  leaving: boolean;
  onOpen: (target: CerberusSheetTarget) => void;
  /** Mute, pressed: the host opens its Mute dialog on the check. Absent, no Mute is drawn: a page that hosts no Mute dialog does not offer one. */
  onMute?: (check: CerberusCheckView) => void;
  /**
   * What the check reported, drawn whole rather than cut at two lines: where this card is the whole of what a finger can read
   * (the station's check stage, where the rail's cut line must stand whole). Absent, the tab's cut, its whole on hover and in
   * the sheet.
   */
  wholeValue?: boolean;
};

/**
 * One check that needs you, in its status's tone (`data-tone`), on the ground of whatever holds it: no frame, no bar and no wash.
 * Its round glyph (the status's icon, ringing while it fails) and its word in the tone's ink say how bad it is before anything else
 * is read; then its name, where it runs and since when, its raw key, and what it last reported, cut at two lines so a health
 * document's prose cannot stretch the list (the whole of it on hover, and in the sheet; whole where its host asks, `wholeValue`);
 * then its actions. A check with no label yet is named by its key, in mono, which then is not written a second time under it.
 * Needs listed together are parted by hairlines (`.cerberus-needs`). Its presses are 44 px catches under a finger, the house's
 * touch floor.
 *
 * Used by the fleet's machine Opening (`NodeOpening`), once per check that needs you there, and by the station module's check stage (`CheckStage`,
 * through the barrel), which draws one red check's card on its stage, with its fix and Diagnose, no Mute, and
 * its reported value whole.
 */
export function NeedCard({ need, leaving, onOpen, onMute, wholeValue = false }: NeedCardProps) {
  const { t } = useTranslation();
  const { check } = need;
  const look = STATUS_TABLE[check.status];
  const service = check.serviceLabel ?? check.service;
  // The sheet on this check, at now: the root's onOpenCell with the check's id inside its service.
  const target: CerberusSheetTarget = { node: check.node, service: check.service, check: check.id };
  return (
    <li
      data-tone={look.tone}
      aria-hidden={leaving || undefined}
      data-cerberus-need={check.status}
      className={cn(
        'cerberus-need relative flex min-w-0 flex-1 flex-col gap-2 py-3',
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
          onClick={() => onOpen(target)}
          className="min-w-0 flex-1 text-left finger:min-h-11"
        >
          <span className="block text-[14px] font-medium leading-5">
            {check.label ?? <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{check.key}</span>}{' '}
            <span className="text-tone-ink">{t('cerberus.needs.word', { word: t(look.wordKey) })}</span>
          </span>
          <span className="block text-[12px] tabular-nums text-muted-foreground">
            {check.since === null
              ? t('cerberus.needs.whereNoSince', { service, node: check.node })
              : t('cerberus.needs.where', { service, node: check.node, time: hms(check.since) })}
          </span>
          {check.label !== null && (
            <span className="block font-mono text-[11px] text-ink-faint [overflow-wrap:anywhere]">{check.key}</span>
          )}
        </button>
      </div>
      {check.value !== null && (
        <p
          title={wholeValue ? undefined : check.value}
          className={cn('pl-[34px] text-[13px] text-secondary-foreground [overflow-wrap:anywhere]', !wholeValue && 'line-clamp-2')}
        >
          {check.value}
        </p>
      )}
      <div className="flex flex-wrap gap-2 pl-[34px]">
        {/* The run strip on a line of its own above the row's buttons, then Run “<fix>” (tonal). */}
        <NeedFix need={need} leaving={leaving} onOpen={onOpen} />
        {need.diagnosis === null ? (
          // No diagnosis since it went bad: asking for one opens the sheet, where its steps arrive.
          <DiagnoseButton node={check.node} checkKey={check.key} label={t('cerberus.diagnosis.diagnose')} disabled={leaving} onStarted={() => onOpen(target)} />
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={leaving}
            className="finger:size-11 finger:px-0"
            aria-label={t(need.diagnosis.status === 'running' ? 'cerberus.diagnosis.diagnosing' : 'cerberus.diagnosis.see')}
            title={t(need.diagnosis.status === 'running' ? 'cerberus.diagnosis.diagnosing' : 'cerberus.diagnosis.see')}
            onClick={() => onOpen(target)}
          >
            <IconWord icon={Stethoscope} word={t(need.diagnosis.status === 'running' ? 'cerberus.diagnosis.diagnosing' : 'cerberus.diagnosis.see')} />
          </Button>
        )}
        {onMute && (
          <Button
            variant="outline"
            size="sm"
            disabled={leaving}
            className="finger:size-11 finger:px-0"
            aria-label={t('cerberus.needs.mute')}
            title={t('cerberus.needs.mute')}
            // The Mute dialog on this check, which the root opens.
            onClick={() => onMute(check)}
          >
            <IconWord icon={BellOff} word={t('cerberus.needs.mute')} />
          </Button>
        )}
      </div>
    </li>
  );
}
