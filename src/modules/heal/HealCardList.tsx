import { HeartPulseIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { HealCardView } from '@/modules/heal/HealCardView';
import { byMotionThenNewest } from '@/modules/heal/healState';
import type { HealCard } from '@/modules/heal/healTypes';
import { useOpenHealBrief } from '@/modules/heal/hooks/useOpenHealBrief';
import { EmptyState } from '@/shared/ui';

/**
 * Every heal the reflex has run, each as a whole card in the run card's shape.
 *
 * A running card leads. A PARKED card says why it is waiting and when it fires, in a banner above
 * its facts, so a heal that is standing still is never mistaken for one nobody started.
 */
export function HealCardList({ heals }: { heals: HealCard[] }) {
  const { t } = useTranslation();
  const onOpenChain = useOpenHealBrief();

  const ordered = [...heals].sort(byMotionThenNewest);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-heal-heals>
      {ordered.length === 0 ? (
        <div className="flex items-center justify-center px-4 py-8">
          <EmptyState
            icon={HeartPulseIcon}
            title={t('heal.cards.empty.title', { defaultValue: 'No heal has run yet' })}
            message={t('heal.cards.empty.message', { defaultValue: 'A cycle fires them — nightly on the schedule, or Run a cycle now.' })}
          />
        </div>
      ) : (
        <ul className="flex min-w-0 flex-col gap-3" data-heal-cards>
          {ordered.map((heal) => (
            <li key={heal.id} className="min-w-0">
              <HealCardView heal={heal} onOpenChain={onOpenChain} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
