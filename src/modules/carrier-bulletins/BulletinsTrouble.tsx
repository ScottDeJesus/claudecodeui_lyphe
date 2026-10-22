import { useTranslation } from 'react-i18next';

import type { AffectedAreasTrouble } from '@/shared/types';
import { Banner, Button } from '@/shared/ui';

type BulletinsTroubleProps = {
  /**
   * Why the read brought no answer. The bulletins lane and the Tours lane ride one forwarder
   * (`server/shared/shadow-connector-lane.ts`), so they fail the same five ways and share the one type that names them.
   */
  trouble: AffectedAreasTrouble;
  /** What the read was of, which names a missing or failed one: the overview, a carrier's pages, or one page. */
  subject: 'overview' | 'pages' | 'page';
  onRetry: () => void;
};

/**
 * What a Bulletins screen draws where its read brought no answer: a warn banner (the shape of Cerberus's own
 * `UnreachableBanner` and of Tours' `LaneTrouble`) with Try again, saying the cause in the lane's words and what follows
 * from it on a second line:
 * - the lane could not read shadow-connector's secret: nothing can be read until the env file holds it;
 * - shadow-connector did not answer in time, or answered what CloudCLI cannot read;
 * - the bulletin or the page is not there, or the read failed some other way, named by what was being read.
 *
 * Warn, not danger: nothing was refused by a person. The wrapper is an alert, heard when it mounts.
 *
 * Used by the carrier-bulletins module's `OverviewScreen`, `CarrierPages` and `PageScreen`.
 */
export function BulletinsTrouble({ trouble, subject, onRetry }: BulletinsTroubleProps) {
  const { t } = useTranslation();
  return (
    <div role="alert">
      <Banner
        tone="warn"
        action={(
          <Button variant="tonal" size="sm" className="h-8 flex-none px-2.5 text-xs max-md:h-11" onClick={onRetry}>
            {t('cerberus.bulletins.trouble.retry')}
          </Button>
        )}
      >
        <p className="text-sm font-medium">{t(`cerberus.bulletins.trouble.${trouble}`, { context: subject })}</p>
        <p className="mt-0.5 text-xs">{t(`cerberus.bulletins.trouble.${trouble}Detail`, { context: subject })}</p>
      </Banner>
    </div>
  );
}
