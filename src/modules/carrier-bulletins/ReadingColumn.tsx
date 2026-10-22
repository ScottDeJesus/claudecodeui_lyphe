import { useTranslation } from 'react-i18next';

import { CommandLine } from '@/modules/carrier-bulletins/CommandLine';
import { JudgedList } from '@/modules/carrier-bulletins/JudgedList';
import { RequirementList } from '@/modules/carrier-bulletins/RequirementList';
import { SetAside } from '@/modules/carrier-bulletins/SetAside';
import { pullCommand } from '@/modules/carrier-bulletins/utils/bulletinWords';
import type { PageReading, PageWaiting } from '@/shared/carrier-bulletins-types';
import { Banner, Card } from '@/shared/ui';
import { formatRelativeTime } from '@/shared/utils';

type ReadingColumnProps = {
  /** What Claude read on the page; null while the read is out (the lane's fault is said above the columns, never here). */
  value: PageReading | null;
  /** The carrier, which names the manual pull that reads a waiting or unread page. */
  carrier: string;
};

/**
 * A waiting page: why its try ended (Claude gave no usable answer, or the house's checks refused the one it gave), when,
 * and how it is read again. It waits in this exact file until the file or the instructions change, so no automatic pull
 * tries it again: the operator's door is a manual pull of the carrier, which reads it and settles the carrier after.
 */
function WaitingNotice({ waiting, carrier }: { waiting: PageWaiting; carrier: string }) {
  const { t } = useTranslation();
  return (
    <Banner tone="warn">
      <p className="text-sm font-medium">{t(`cerberus.bulletins.waiting.${waiting.status}`)}</p>
      {waiting.reason !== null && <p className="mt-0.5 text-[13px] [overflow-wrap:anywhere]">{waiting.reason}</p>}
      <p className="mt-1.5 text-xs">{t('cerberus.bulletins.waiting.how', { when: formatRelativeTime(waiting.at), carrier })}</p>
      <div className="mt-1"><CommandLine command={pullCommand(carrier)} /></div>
    </Banner>
  );
}

/** Verve's waiting surface in the shape of the reading: two requirement cards and a list, while the page is read. */
function ReadingSurface() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <p role="status" className="sr-only">{t('cerberus.bulletins.page.reading')}</p>
      <div aria-hidden="true" className="vv-skeleton h-3 w-1/3" />
      <div aria-hidden="true" className="vv-skeleton h-[104px] w-full rounded-[14px]" />
      <div aria-hidden="true" className="vv-skeleton h-[104px] w-full rounded-[14px]" />
      <div aria-hidden="true" className="vv-skeleton h-[180px] w-full rounded-[14px]" />
    </div>
  );
}

/**
 * WHAT CLAUDE READ ON THE PAGE, beside its image: what the page requires (`RequirementList`), the rules judged there
 * (`JudgedList`), and what the house set aside (`SetAside`), in that order — the order a person asks in.
 *
 * States: the page read (Verve's waiting surface); waiting (why, when, and the manual pull that reads it again); not read
 * yet (when it will be, and the pull that reads it now); a page Claude read and found nothing on (the requirements' own
 * sentence, "Claude found no requirement on this page"); and the reading.
 *
 * Used by the carrier-bulletins module's `PageScreen`.
 */
export function ReadingColumn({ value, carrier }: ReadingColumnProps) {
  const { t } = useTranslation();
  if (value === null) return <ReadingSurface />;
  if (value.waiting !== null) return <WaitingNotice waiting={value.waiting} carrier={carrier} />;
  if (value.reading === null) {
    return (
      <Card className="flex flex-col gap-1.5 px-[18px] py-4">
        <p className="text-[15px] font-medium text-foreground">{t('cerberus.bulletins.page.unread')}</p>
        <p className="text-[13.5px] text-muted-foreground">{t('cerberus.bulletins.page.unreadMessage', { carrier })}</p>
        <div className="pt-1"><CommandLine command={pullCommand(carrier)} /></div>
      </Card>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <RequirementList requirements={value.requirements} carrier={carrier} />
      {value.judged.length > 0 && <JudgedList judged={value.judged} />}
      <SetAside notPlaced={value.not_placed} failures={value.failures} />
    </div>
  );
}
