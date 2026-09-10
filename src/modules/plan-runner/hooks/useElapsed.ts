import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Below this many seconds the reader wants seconds; above it, minutes. */
const ONE_MINUTE = 60;
/** And above this many minutes, hours — the point where a seconds figure stops carrying meaning. */
const ONE_HOUR_IN_MINUTES = 60;

/**
 * How long something has been going, ticking once a second, spelled in the app's OWN words.
 *
 * THE SPELLING IS NOT THIS FILE'S TO INVENT. The chat composer's clock has said elapsed for as
 * long as there has been a composer, through three keys in the `chat` namespace
 * (`src/modules/chat/composer/ActivityIndicator.tsx`, `claudeStatus.elapsed.*`), and this reads
 * exactly those. A private helper here would be a SECOND spelling of the same idea — two clocks in
 * one app saying "5m 3s" and "05:03" for the same fact, drifting apart the first time either is
 * touched, and untranslatable besides. Phase 5 added the third key, `hoursMinutes`, beside the two
 * that were already there; a run can last hours and the composer's longest turn cannot, so the
 * vocabulary grew rather than forked. Nothing here is zero-padded, for the same reason: the
 * composer does not pad, so neither does this.
 *
 * ONE INTERVAL PER HOOK INSTANCE, and `null` buys none at all. That second half is what keeps a
 * card cheap: a phase list calls this once per row, but only the row that is actually RUNNING
 * passes a number — the other four pass `null`, take the early return, and cost nothing. So a
 * five-phase card holds two timers (its own header and the one running phase), not six.
 *
 * `sinceEpochSeconds` is epoch SECONDS, because that is what the runner's Python wrote with
 * `time.time()` and what every timestamp inside a snapshot carries. Handing it milliseconds
 * yields an elapsed measured from 1970.
 */
export function useElapsed(sinceEpochSeconds: number | null, tickMs = 1000): string {
  const { t } = useTranslation('chat');

  // The clock's own reading. It is essential and cannot be derived: nothing else in the app
  // re-renders when a second passes, and a run's elapsed changes for no other reason.
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (sinceEpochSeconds === null) return;

    // Read once on the way in as well as on the tick: the first paint after a stage change would
    // otherwise show the previous stage's age for up to a second.
    const read = () => setNowSeconds(Math.floor(Date.now() / 1000));
    read();
    // The tick is the caller's: a moving run's clock changes every second; an ended run's age
    // changes once a minute at best, and a per-second interval on every finished card would
    // re-render a pane of them sixty times a minute for up to a day. Coarsened, never stopped —
    // a reading taken once said "ended 2s ago" an hour later.
    const timer = window.setInterval(read, tickMs);
    return () => window.clearInterval(timer);
  }, [sinceEpochSeconds, tickMs]);

  if (sinceEpochSeconds === null) return '';

  // Clamped at zero: the runner's clock and the browser's are two machines' ideas of now, and a
  // snapshot written a moment in the future would otherwise render a negative age.
  const total = Math.max(0, nowSeconds - Math.floor(sinceEpochSeconds));

  if (total < ONE_MINUTE) {
    return t('claudeStatus.elapsed.seconds', { count: total, defaultValue: '{{count}}s' });
  }

  const minutes = Math.floor(total / ONE_MINUTE);
  if (minutes < ONE_HOUR_IN_MINUTES) {
    return t('claudeStatus.elapsed.minutesSeconds', {
      minutes,
      seconds: total % ONE_MINUTE,
      defaultValue: '{{minutes}}m {{seconds}}s',
    });
  }

  return t('claudeStatus.elapsed.hoursMinutes', {
    hours: Math.floor(minutes / ONE_HOUR_IN_MINUTES),
    minutes: minutes % ONE_HOUR_IN_MINUTES,
    defaultValue: '{{hours}}h {{minutes}}m',
  });
}
