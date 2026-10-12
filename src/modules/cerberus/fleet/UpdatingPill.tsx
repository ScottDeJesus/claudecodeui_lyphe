import { useTranslation } from 'react-i18next';

import type { CerberusNodeView } from '@/shared/cerberus-types';
import { Badge } from '@/shared/ui';

/**
 * The pill a node wears while its warden's update is queued or running: "Updating · Uploading warden 0.4.3
 * · 2.1 MB", "Updating · Restarting the warden", "Updating · Waiting its turn". The words after the dot are
 * `updating.text` as center sends them — the warden's own sentence for its latest step, or center's while the
 * update has no step yet — and the pill breathes in the info tone on Verve's `vv-pulse` at the prototype's
 * 1.6 s, as a thing in progress does elsewhere on the tab; with reduced motion it stands still. A narrow
 * row cuts the sentence with an ellipsis rather than wrap, as `StatusPill` cuts its own.
 *
 * Used by this module's `NodeCard`, on a list row and on an open grid card, before the warden line. A
 * collapsed tile has no room for a pill, so its line says "Updating its warden" instead.
 */
export function UpdatingPill({ updating }: { updating: NonNullable<CerberusNodeView['updating']> }) {
  const { t } = useTranslation();
  return (
    <Badge as="span" tone="info" className="max-w-full whitespace-nowrap motion-safe:animate-[vv-pulse_1.6s_ease-in-out_infinite]">
      <span className="truncate">{t('cerberus.node.updating', { step: updating.text })}</span>
    </Badge>
  );
}
