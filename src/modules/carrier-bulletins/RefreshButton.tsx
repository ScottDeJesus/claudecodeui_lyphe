import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';

type RefreshButtonProps = {
  onRefresh: () => void;
};

/**
 * Refresh: reads again what the shown screen draws. The view reads when it opens and on this press, never on a timer and
 * never while the tab shows another view, so this is how a person sees a reading that landed while they looked.
 *
 * Used by the carrier-bulletins module's three screens, each at the top right of its header, in the same place.
 */
export function RefreshButton({ onRefresh }: RefreshButtonProps) {
  const { t } = useTranslation();
  return (
    <Button variant="outline" size="sm" className="h-8 flex-none max-md:h-11" onClick={onRefresh}>
      <RefreshCw aria-hidden="true" />
      {t('cerberus.bulletins.refresh')}
    </Button>
  );
}
