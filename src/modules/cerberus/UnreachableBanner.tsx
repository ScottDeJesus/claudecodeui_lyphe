import { useTranslation } from 'react-i18next';

import { Banner, Button } from '@/shared/ui';

/**
 * "Cerberus can't be reached" with Try again: what a card draws where its read of center did not
 * answer. It is warn, not danger, because nothing was refused: the server did not answer, and the next
 * read may. `detail` is a second line about what the reader is still looking at ("Showing the last
 * answer it gave."), set apart by weight alone: the first line is medium, and dimming the second put it
 * under AA on the light banner (3.24:1). Try again stands 44 px tall below `md`, Verve's touch minimum.
 *
 * The wrapper is an alert, and an alert is heard when it MOUNTS. A retry that fails again is heard only
 * where the caller mounts the banner afresh for it:
 * - the root keys it by Try again's finished reads;
 * - History's feed puts its placeholder back while the read is out, and so does its index read.
 * The check sheet and History's look-up keep it mounted through a retry of a check's read. There, a
 * second failure is neither repainted nor heard.
 *
 * Used by the tab's root (`CerberusPanel`) while its first read of the fleet has failed and while the
 * fleet it holds is stale, by History's two cards, `LookupCard` and `EventsCard`, by the check sheet
 * (`CheckSheet`), and by the sheet's Fix output (`FixOutput`) when its run's own read failed: one spelling
 * of the state for the whole tab.
 */
export function UnreachableBanner({ onRetry, detail }: { onRetry: () => void; detail?: string }) {
  const { t } = useTranslation();
  return (
    <div role="alert">
      <Banner
        tone="warn"
        action={(
          <Button variant="tonal" size="sm" className="h-8 flex-none px-2.5 text-xs max-md:h-11" onClick={onRetry}>
            {t('cerberus.errors.retry')}
          </Button>
        )}
      >
        <p className="text-sm font-medium">{t('cerberus.errors.unreachable')}</p>
        {detail !== undefined && <p className="mt-0.5 text-xs">{detail}</p>}
      </Banner>
    </div>
  );
}
