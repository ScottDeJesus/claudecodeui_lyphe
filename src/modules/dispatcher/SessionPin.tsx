import { PinIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/shared/ui';

/**
 * The mark on a plan card THIS chat opened: a glyph AND a word.
 *
 * Colour is never the whole signal (design doctrine :147-149) and neither is a shape, so the pin
 * carries the glance and the badge carries the words. The tone is `info` — which plan is the open
 * chat's is news about which ROW this is, never a verdict on the plan itself.
 *
 * It stands on its own here because it is drawn in two places: above a plan of no arc in the chat
 * gutter's Runner widget (`RunnerWidgetBody`) and on a plan inside a dispatch arc's deck
 * (`DispatchArcDeck`). The memory gutter's own pin (`MemoryWidgetBody`, another module) is still a
 * separate copy, below design doctrine §2's promote-on-the-third rule.
 *
 * Used by `RunnerWidgetBody` and `DispatchArcDeck`.
 */
export function SessionPin() {
  const { t } = useTranslation();
  return (
    <span data-session-pin className="inline-flex items-center gap-1" title={t('gutters.pin.title')}>
      <PinIcon aria-hidden="true" className="h-3.5 w-3.5" />
      <Badge tone="info">{t('gutters.pin.label')}</Badge>
    </span>
  );
}
