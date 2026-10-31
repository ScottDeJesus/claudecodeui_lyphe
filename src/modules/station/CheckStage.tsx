import { PanelRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CheckSheet, NeedCard, useCerberusNeedOf } from '@/modules/cerberus';
import { useStation } from '@/modules/station/context/StationContext';
import { StageGone } from '@/modules/station/FocusFallback';
import type { CerberusNeed } from '@/shared/cerberus-types';
import type { StationFocus } from '@/shared/station-types';
import type { CerberusSheetTarget, StationTier } from '@/shared/types';
import { Button, Spinner } from '@/shared/ui';

/** A service check on the stage, by its node and its key (`<service>/<id>`). */
type CheckFocus = Extract<StationFocus, { kind: 'check' }>;

/**
 * What the stage holds of its check: `loading` while Cerberus's overview has not been read; `needs`, the check as Cerberus's
 * "Needs you" holds it — its view, the fix offered for it, its recent run and its diagnosis, whatever its status is now; `gone`
 * once it needs no one (it recovered, or a mute covers it); `unread`, Cerberus's overview could not be read at all, so whether the check
 * is red is not known.
 */
type CheckFound = { kind: 'loading' } | { kind: 'unread' } | { kind: 'needs'; need: CerberusNeed } | { kind: 'gone' };

/**
 * THE CHECK SHEET'S WIDTH in each arrangement: over the station's right side, never over her face. Wide, the kit's own
 * `min(600px, 100%)` from the right edge covers the rail and the stage and stops short of her column (it begins at 708 px at
 * most, and the sheet at 760 px at the narrowest wide window, 1360 px). On a laptop the stage stands in her column under her
 * face, so the sheet takes the right rail's own 296 px. Below 1024 px (compact) a sheet takes the screen, as every sheet does there.
 */
const CHECK_SHEET_WIDTH: Readonly<Record<StationTier, string | undefined>> = {
  wide: undefined,
  laptop: '296px',
  narrow: undefined,
};

/** Where "Open the check" opens the sheet when only the focus is left: its node, and its key split at its first `/`. */
function targetOfKey(node: string, key: string): CerberusSheetTarget | null {
  const slash = key.indexOf('/');
  return slash <= 0 || slash === key.length - 1 ? null : { node, service: key.slice(0, slash), check: key.slice(slash + 1) };
}

type CheckStageViewProps = {
  focus: CheckFocus;
  found: CheckFound;
  /** The card's own presses (its name, its run's strip, Diagnose once started, See diagnosis) and "Open the check": the sheet on that check. */
  onOpenSheet: (target: CerberusSheetTarget) => void;
  /** Try again, while the overview could not be read: Cerberus's overview read once more. */
  onRetry: () => void;
};

/**
 * A RED CHECK ON THE STAGE, drawn by its owner and never redrawn here: Cerberus's own need card (`NeedCard`) for the check,
 * its status in its tone and its word, where it runs and since when, what it reported — whole (`wholeValue`), as the line the
 * rail cut must stand on the stage its press opens, with no hover to read it by — and what can be done as the Cerberus
 * tab offers it — its fix to run (`Run “<fix>”`, its run's strip once one goes) and Diagnose — with no Mute: muting stays the
 * Cerberus tab's, whose dialog the station does not host. Then "Open the check", the Cerberus check sheet on it, which stands
 * over the station's right side (`CHECK_SHEET_WIDTH`).
 *
 * A check that needs no one any more draws its kind's line, "<label> is no longer red", with "Open the check" still under it,
 * where its history says what happened. While the overview has not been read, a quiet "Looking for the check…".
 *
 * The card is the keyboard's landing from the rail's Open (`data-station-fire`, a list that takes the focus, so Tab walks into
 * its presses). Every press on the card and "Open the check" is a 44 px catch under a finger below 768 px (the touch law; the
 * card's presses are sized in the cerberus module).
 *
 * A pure view: `CheckStage` below binds it. Drawn on the stage for a `check` focus (`stageViews.ts`),
 * and by `.verify/kaylee-station-shots.mjs` on its fixture (`fake/needs.ts`), inside Cerberus's own provider.
 */
export function CheckStageView({ focus, found, onOpenSheet, onRetry }: CheckStageViewProps) {
  const { t } = useTranslation();

  const openCheck = (target: CerberusSheetTarget) => (
    <Button variant="outline" size="sm" data-station-check-open="" className="self-start max-md:h-11" onClick={() => onOpenSheet(target)}>
      <PanelRight aria-hidden="true" />
      {t('station.needs.check.open', 'Open the check')}
    </Button>
  );

  switch (found.kind) {
    case 'loading':
      return (
        <div data-station-check="loading" className="grid place-items-center py-10">
          <Spinner size={32} label={t('station.needs.check.looking', 'Looking for the check…')} />
        </div>
      );
    case 'unread': {
      const target = targetOfKey(focus.node, focus.key);
      return (
        <div data-station-check="unread" className="flex min-w-0 flex-col gap-3">
          <p role="status" data-tone="warn" className="flex min-w-0 items-start gap-1.5 text-sm leading-snug text-tone-ink">
            <span aria-hidden="true">▲</span>
            <span className="min-w-0 break-words">{t('station.needs.fault.check', 'Couldn’t read the checks just now')}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" data-station-check-retry="" className="max-md:h-11" onClick={onRetry}>
              {t('station.needs.retry', 'Try again')}
            </Button>
            {target !== null && openCheck(target)}
          </div>
        </div>
      );
    }
    case 'gone': {
      const target = targetOfKey(focus.node, focus.key);
      return (
        <div data-station-check="gone" className="flex min-w-0 flex-col gap-3">
          <StageGone focus={focus} />
          {target !== null && openCheck(target)}
        </div>
      );
    }
    case 'needs':
      break;
  }

  const { check } = found.need;
  return (
    <div data-station-check={check.status} className="flex min-w-0 flex-col gap-3">
      <ul
        aria-label={t('station.needs.check.card', { label: focus.label, defaultValue: '{{label}} in Cerberus' })}
        tabIndex={-1}
        data-station-fire=""
        className="flex min-w-0 rounded-[10px]"
      >
        <NeedCard need={found.need} leaving={false} onOpen={onOpenSheet} wholeValue />
      </ul>
      {openCheck({ node: check.node, service: check.service, check: check.id })}
    </div>
  );
}

/**
 * The check's stage on the page: registered for the `check` kind in `stageViews.ts`, drawn by `StationStage`. It finds the
 * check in Cerberus's overview, hands it to `CheckStageView`, and holds the check sheet its presses open.
 */
export function CheckStage({ focus }: { focus: CheckFocus }) {
  const { tier } = useStation();
  const { need, unreachable, retry } = useCerberusNeedOf(focus.node, focus.key);
  // The check the sheet is open on, null while it is shut. State, because the sheet is drawn from it and it opens on a press of the card or of "Open the check".
  const [sheet, setSheet] = useState<CerberusSheetTarget | null>(null);
  const found: CheckFound = need === undefined ? { kind: unreachable ? 'unread' : 'loading' } : need === null ? { kind: 'gone' } : { kind: 'needs', need };

  return (
    <>
      <CheckStageView focus={focus} found={found} onOpenSheet={setSheet} onRetry={retry} />
      {sheet !== null && (
        <CheckSheet
          open
          onClose={() => setSheet(null)}
          node={sheet.node}
          service={sheet.service}
          check={sheet.check}
          lookupAt={sheet.lookupAt}
          run={sheet.run}
          width={CHECK_SHEET_WIDTH[tier]}
        />
      )}
    </>
  );
}
