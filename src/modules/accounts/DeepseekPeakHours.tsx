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
 * Which DeepSeek rate is being billed right now, and when the peak windows are, on the reader's
 * own clock. Used by `AccountPopover`, directly under the balance: the money and the price of
 * spending it are one question, asked in one place.
 *
 * Green off-peak, amber at peak — the same two tones the composer's Flash chip wears, off the
 * same rule (`deepseekPeakHours.ts`), so the panel and the chip can never disagree.
 */
export function DeepseekPeakHours({ now }: DeepseekPeakHoursProps) {
  const { peak, changesAt } = deepseekPeakStatus(now);
  const changes = deepseekRateChangeInWords(now, changesAt);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-medium text-foreground">DeepSeek rate</span>
        <Badge as="span" tone={peak ? 'warn' : 'positive'} className="ml-auto">
          {peak ? 'Peak — full price' : 'Off-peak — half price'}
        </Badge>
      </div>
      <span className="text-xs leading-relaxed text-muted-foreground">
        {peak ? `Full price until ${changes}.` : `Half price until ${changes}.`}
      </span>
      <div className="flex flex-col text-xs leading-relaxed text-muted-foreground">
        <span>Full-price hours:</span>
        {deepseekPeakWindowsInWords(now).map((window) => (
          <span key={window} className="tabular-nums">{window}</span>
        ))}
        <span>Weekends are always half price.</span>
      </div>
    </div>
  );
}
