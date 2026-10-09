import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';

type AcceptWhenCutProps = {
  /** Whose press this is: one plan card's, or an epic deck's (every designed member of it). */
  scope: 'plan' | 'dispatch-arc';
  /** Is there a design to Accept now that is not Accepted yet? Then the press is drawn. */
  pressable: boolean;
  /** Does a press stand (and so Cancel)? Drawn only when nothing is left to press. */
  armed: boolean;
  /** The armed word's tooltip — who pressed and when, for a plan; an arc's carries none. */
  armedTitle?: string;
  /** A verb is in flight for this plan or arc: the buttons refuse a second press until it answers. */
  busy: boolean;
  onArm: () => void;
  onCancel: () => void;
};

const HANDLES = {
  plan: { press: 'data-dispatcher-arm-accept', armed: 'data-dispatcher-arm-accepted', cancel: 'data-dispatcher-disarm-accept' },
  'dispatch-arc': { press: 'data-dispatch-arc-arm-accept', armed: 'data-dispatch-arc-arm-accepted', cancel: 'data-dispatch-arc-disarm-accept' },
} as const;

/**
 * `Accept when cut` — the operator's Accept, given on a DESIGN he has read, ahead of its cut: the
 * dispatcher approves the first cut of that exact design and walks it, without him at the keyboard; a
 * Rework disarms it. Once pressed the card reads `Accepted · starts when cut` — a fact, not a button — with
 * `Cancel` beside it. Drawn where `store_armed` would take the press, never greyed out where it would refuse.
 *
 * THE PRESS IS THE OPERATOR'S ALONE: it relays `dispatcher arm-accept --by app:card`, which refuses inside
 * a Claude session. The plan's press carries `design_loaded_at`, the stamp of the design this card drew, so
 * a press on a design that has since moved is refused rather than landing on the new one.
 *
 * An epic deck's press arms every DESIGNED member of it, each on its own current design; a member not yet
 * designed is not armed (he has not seen its design). The deck draws the press while any member is
 * armable, and the armed word with Cancel once every designed member is armed.
 *
 * 32px TALL, the height of every control in the card's `ActionBar`.
 *
 * Handles, the scope's own: `data-dispatcher-arm-accept` / `data-dispatch-arc-arm-accept` on the press,
 * `…-arm-accepted` on the armed word and `…-disarm-accept` on Cancel.
 */
export function AcceptWhenCut({ scope, pressable, armed, armedTitle, busy, onArm, onCancel }: AcceptWhenCutProps) {
  const { t } = useTranslation();
  const handles = HANDLES[scope];

  if (pressable) {
    return (
      <Button type="button" size="sm" className="h-8" disabled={busy} title={t('dispatcher.acceptWhenCutTitle')}
        onClick={onArm} {...{ [handles.press]: '' }}>
        {t('dispatcher.acceptWhenCut')}
      </Button>
    );
  }
  if (!armed) return null;
  return (
    <>
      <span className="inline-flex h-8 items-center px-1 text-sm font-medium text-muted-foreground" title={armedTitle}
        {...{ [handles.armed]: '' }}>
        {t('dispatcher.acceptWhenCutArmed')}
      </span>
      <Button type="button" variant="ghost" size="sm" className="h-8" disabled={busy} onClick={onCancel}
        {...{ [handles.cancel]: '' }}>
        {t('dispatcher.acceptWhenCutCancel')}
      </Button>
    </>
  );
}
