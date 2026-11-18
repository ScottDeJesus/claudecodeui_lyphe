import {
  deepseekPeakStatus,
  deepseekPeakWindowsInWords,
  deepseekRateChangeInWords,
} from '@/shared/deepseekPeakHours';
import { Badge } from '@/shared/ui';

type DeepseekPeakHoursProps = {
  /** The panel's own minute tick, so the badge turns over when the rate does and not a render later. */
  now: number;
};

/**
 * Which DeepSeek rate is being billed right now, on one line under the balance: the money and the price of spending it are one
 * question, asked in one place. Used by `AccountPanelBody`.
 *
 * Green off-peak, amber at peak — the same two tones the composer's Flash chip wears while it is
 * on, off the same rule (`deepseekPeakHours.ts`), so the panel and the chip can never disagree. When the rate changes and which hours
 * are full price, on the reader's own clock, are the line's hover and its words for a reader that asks.
 */
export function DeepseekPeakHours({ now }: DeepseekPeakHoursProps) {
  const { peak, changesAt } = deepseekPeakStatus(now);
  const changes = deepseekRateChangeInWords(now, changesAt);
  const words = [
    peak ? `Full price until ${changes}.` : `Half price until ${changes}.`,
    `Full-price hours: ${deepseekPeakWindowsInWords(now).join(', ')}.`,
    'Weekends are always half price.',
  ].join(' ');

  return (
    <div data-balance="deepseek-rate" title={words} className="flex min-h-7 items-center gap-2">
      <span className="text-[13px] text-foreground">DeepSeek rate</span>
      <Badge as="span" tone={peak ? 'warn' : 'positive'} className="ml-auto">
        {peak ? 'Peak · full price' : 'Off-peak · half price'}
      </Badge>
      <span className="sr-only">{words}</span>
    </div>
  );
}
