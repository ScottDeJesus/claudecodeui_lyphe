import { Suspense, type ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';

import { Banner } from '@/shared/ui/Banner';
import { Button } from '@/shared/ui/Button';
import { Spinner } from '@/shared/ui/Spinner';

type ViewBoundaryProps = {
  /** The name of the view it surrounds, as its tab names it ("Tours"): the failure and the waiting ring say it in their words. */
  view: string;
  children: ReactNode;
};

/**
 * A lazy view's own surround: a waiting ring while its chunk loads, and, when the chunk cannot load (a hashed file the
 * server no longer has, a dropped connection) or the view crashes while drawing, one warn banner in place of the view
 * alone. Without it the failure climbs to the app's tab-level boundary, which replaces the whole Cerberus tab, fleet
 * monitor included, and a load that is merely slow leaves an empty, zero-high panel.
 *
 * The banner offers a reload of the page, not a retry: a `lazy` import that failed stays failed until the page loads
 * again, so a retry button would answer nothing. Its gutter is the view's own.
 *
 * Used by the cerberus module's `KeptView`, around the Tours view (`AffectedAreasView`) and the Bulletins view
 * (`BulletinsView`): two feature modules' lazy views, one surround, the view's name given by the view it surrounds.
 */
export function ViewBoundary({ view, children }: ViewBoundaryProps) {
  const { t } = useTranslation();
  return (
    <ErrorBoundary
      onError={(error) => console.error(`The ${view} view failed to load`, error)}
      fallbackRender={() => (
        <div role="alert" className="max-w-[1180px] px-[clamp(16px,4cqi,32px)] pb-7 pt-5">
          <Banner
            tone="warn"
            action={(
              <Button variant="tonal" size="sm" className="h-8 flex-none px-2.5 text-xs finger:h-11" onClick={() => window.location.reload()}>
                {t('viewBoundary.reload')}
              </Button>
            )}
          >
            <p className="text-sm font-medium">{t('viewBoundary.failed', { view })}</p>
            <p className="mt-0.5 text-xs">{t('viewBoundary.failedDetail', { view })}</p>
          </Banner>
        </div>
      )}
    >
      <Suspense
        fallback={(
          <div className="flex justify-center px-[clamp(16px,4cqi,32px)] py-10">
            <Spinner label={t('viewBoundary.loading', { view })} />
          </div>
        )}
      >
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}
