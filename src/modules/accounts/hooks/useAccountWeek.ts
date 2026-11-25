import { useAccountsContext } from '@/modules/accounts/context/AccountsContext';
import { useMinuteTick } from '@/modules/accounts/hooks/useMinuteTick';
import { accountInUse, accountInUseUsage, usageAgeWords } from '@/modules/accounts/utils/accountInUseUsage';
import { WINDOW_NAMES, ringTone, windowPercent } from '@/modules/accounts/utils/usageWindows';

/** The account in use's week, as a ring reads it: its percent (null while nobody has measured it), its tone, and the sentence that says both. */
export type AccountWeek = { percent: number | null; tone: 'quiet' | 'warn' | 'danger'; words: string };

/**
 * How much of this week the account in use has spent. Quiet until the week runs high: `warn` from 75% and `danger` from 90%
 * (`ringTone`, the rule every usage ring in the app is coloured by). It reads `AccountsProvider` and starts no read of its own.
 *
 * Used by this module's `AccountWeekRing`, and through the accounts barrel by the chat module's `ChatCore`, which hands the reading to
 * its core to wear as a ring in orbit.
 */
export function useAccountWeek(): AccountWeek {
  const { accounts, usage } = useAccountsContext();
  // A clock, not a read: it carries a week whose reset has just passed to the week that began there.
  const now = useMinuteTick();
  const reading = accountInUseUsage(usage, accounts, now);
  const windows = reading !== null && reading.reachable && Array.isArray(reading.windows) ? reading.windows : [];
  const week = windows.find((usageWindow) => usageWindow.key === 'seven_day') ?? null;
  const percent = week === null ? null : windowPercent(week);
  const tone = ringTone(percent);
  const inUse = accountInUse(accounts);
  const owner = inUse?.email ?? inUse?.slug ?? null;
  const age = percent === null ? null : usageAgeWords(reading, now);
  const words = `${owner === null ? 'Account' : `Account ${owner}`}. ${WINDOW_NAMES.seven_day} ${percent === null ? 'has no reading yet' : `${percent}%`}${age === null ? '' : `, ${age}`}`;
  return { percent, tone: tone === 'danger' ? 'danger' : tone === 'warn' ? 'warn' : 'quiet', words };
}
