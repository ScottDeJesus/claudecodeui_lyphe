import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/shared/api';

/**
 * His × on the action card, as a press: calls `onWithdraw()` once and keeps the two facts the card draws around it. `withdrawing`
 * is true while the call is out (the × is busy, so a second press goes nowhere); `refusal` is the line the card says at its
 * foot when the call is refused, the server's sentence after the card's own words or the card's words alone when it sent none,
 * and is cleared when the next press starts. A withdrawal that goes through needs no state: the provider folds it into the
 * picture and the card goes with the action.
 *
 * Used by this module's CompanionActionCard.
 */
export function useWithdraw(onWithdraw: (() => Promise<void>) | undefined): { withdrawing: boolean; refusal: string | null; withdraw: () => void } {
  const { t } = useTranslation();
  // Whether the call is out, for the × to be busy. The press cannot tell this from the outside.
  const [withdrawing, setWithdrawing] = useState(false);
  // Why the last press was refused; the card's foot says it.
  const [refusal, setRefusal] = useState<string | null>(null);

  const withdraw = () => {
    if (!onWithdraw || withdrawing) return;
    setRefusal(null);
    setWithdrawing(true);
    onWithdraw()
      .catch((error: unknown) => {
        const reason = errorMessage(error);
        setRefusal(reason === null ? t('companion.action.withdrawRefusedPlain') : t('companion.action.withdrawRefused', { reason }));
      })
      .finally(() => setWithdrawing(false));
  };

  return { withdrawing, refusal, withdraw };
}
