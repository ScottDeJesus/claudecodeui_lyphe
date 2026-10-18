import { Suspense, type ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';

import { Banner, Button, Spinner } from '@/shared/ui';

/**
 * The lazy Tours view's own surround: a waiting ring while its chunk loads, and, when the chunk cannot load (a hashed
 * file the server no longer has, a dropped connection) or the view crashes while drawing, one warn banner in place of
 * the view alone. Without it the failure climbs to the app's tab-level boundary, which replaces the whole Cerberus tab,
 * fleet monitor included, and a load that is merely slow leaves an empty, zero-high panel.
 *
 * The banner offers a reload of the page, not a retry: a `lazy` import that failed stays failed until the page loads
 * again, so a retry button would answer nothing. Its gutter is the view's own.
 *
 * Used by the cerberus module's `CerberusPanel`, around `AffectedAreasView`.
 */
export function ViewBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <ErrorBoundary
      onError={(error) => console.error('The Tours view failed to load', error)}
      fallbackRender={() => (
        <div role="alert" className="max-w-[1180px] px-[clamp(16px,4cqi,32px)] pb-7 pt-5">
          <Banner
            tone="warn"
            action={(
              <Button variant="tonal" size="sm" className="h-8 flex-none px-2.5 text-xs max-md:h-11" onClick={() => window.location.reload()}>
                {t('affectedAreas.view.reload')}
              </Button>
            )}
          >
            <p className="text-sm font-medium">{t('affectedAreas.view.failed')}</p>
            <p className="mt-0.5 text-xs">{t('affectedAreas.view.failedDetail')}</p>
          </Banner>
        </div>
      )}
    >
      <Suspense
        fallback={(
          <div className="flex justify-center px-[clamp(16px,4cqi,32px)] py-10">
            <Spinner label={t('affectedAreas.view.loading')} />
          </div>
        )}
      >
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}
