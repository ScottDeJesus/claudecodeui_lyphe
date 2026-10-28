import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, SettingRow } from '@/shared/ui';

type TalkBindingFieldProps = {
  /** What the talk button is bound to, as Settings shows it ("F8", "Ctrl+Space", "Mouse back"); null when nothing is. */
  label: string | null;
  /** Bind was pressed and the next key or mouse press is being waited for. */
  capturing: boolean;
  /** Why the last press offered was refused, in a sentence that says what to use instead; null when none was. */
  refusal: string | null;
  /** Enter capture: the next accepted key or mouse press becomes the binding. */
  onBind: () => void;
  /** Unbind the talk button. */
  onClear: () => void;
  /** Leave capture with the binding as it was (the Cancel button; Escape does the same). */
  onCancel: () => void;
};

/**
 * Settings > Voice > Companion's "Talk button": what the press that talks to her is bound to, and the way to bind it.
 * Composed for this module's CompanionSettingsSection, in its own card above her fields; `.verify/kaylee-talk-scaffold.mjs`
 * draws it in each state.
 *
 * A SettingRow, "Talk button" and what may be bound, then one line under it at the card's width — the Gemini key row's
 * shape — so no state squeezes the words beside it: the bound control as a keycap ("Mouse back") or "Not bound" in the
 * muted ink, then Bind, and Clear while something is bound.
 *
 * CAPTURING, that line becomes a lit field, "Press a key or mouse button… Escape cancels", with Cancel beside it; the
 * field's element carries `data-talk-binding-capture` the whole time, which is what tells the bound press to stand aside
 * (`useTalkBinding`) while he presses the control he wants. The field takes focus when capture starts, so a reader hears
 * what to do, and Bind takes it back when capture ends: the prompt and Cancel leave the page then, and focus with them.
 *
 * A REFUSAL stands in place of the helper, amber with the ▲ (an error replaces the helper rather than stacking under
 * it), and is announced: the sentence already says what to use instead.
 */
export function TalkBindingField({ label, capturing, refusal, onBind, onClear, onCancel }: TalkBindingFieldProps) {
  const { t } = useTranslation('settings');
  const promptRef = useRef<HTMLDivElement>(null);
  const bindRef = useRef<HTMLButtonElement>(null);
  // The capture state the focus last followed, so only a change moves focus: a row that mounts takes none.
  const followedCapture = useRef(capturing);

  // Focus follows capture: into the prompt when it starts; back to Bind when it ends, where the prompt or Cancel that held
  // it has left the page (focus fell to the body). Focus he has put somewhere else meanwhile stays where he put it.
  useEffect(() => {
    if (capturing === followedCapture.current) return;
    followedCapture.current = capturing;
    if (capturing) promptRef.current?.focus({ preventScroll: true });
    else if (document.activeElement === null || document.activeElement === document.body) bindRef.current?.focus({ preventScroll: true });
  }, [capturing]);

  const help = refusal === null ? (
    t('voiceSettings.companion.talkBinding.help', {
      defaultValue: "Press it once to talk to her and again to send. A function key, a key held with Ctrl, Alt or Meta, or the mouse's middle, back or forward button.",
    })
  ) : (
    <span role="alert" data-tone="warn" className="font-medium text-tone-ink">
      <span aria-hidden="true">▲ </span>
      {refusal}
    </span>
  );

  return (
    <div data-talk-binding={capturing ? 'capturing' : label === null ? 'unbound' : 'bound'} data-talk-binding-capture={capturing ? '' : undefined}>
      <SettingRow label={t('voiceSettings.companion.talkBinding.label', { defaultValue: 'Talk button' })} description={help} className="pb-3">
        {null}
      </SettingRow>
      <div className="flex min-h-9 flex-wrap items-center gap-2 px-4 pb-4">
        {capturing ? (
          <>
            {/* Up to a field's width, giving way to Cancel in a narrow card (its words wrap inside), so Cancel stays beside it. */}
            <div
              ref={promptRef}
              role="status"
              tabIndex={-1}
              data-talk-binding-prompt=""
              className="flex min-h-9 min-w-0 max-w-sm flex-1 items-center gap-2 rounded-md border border-primary bg-accent-soft px-3 py-1.5 text-sm font-medium leading-snug text-accent-ink"
            >
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" />
              {t('voiceSettings.companion.talkBinding.capturing', { defaultValue: 'Press a key or mouse button… Escape cancels' })}
            </div>
            {/* A left press here is the way out, never a press offered as the binding: the capture passes it over. */}
            <Button variant="ghost" size="sm" data-talk-binding-cancel="" onClick={onCancel}>
              {t('voiceSettings.companion.talkBinding.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </>
        ) : (
          <>
            {label === null ? (
              <span className="text-sm text-muted-foreground">
                {t('voiceSettings.companion.talkBinding.notBound', { defaultValue: 'Not bound' })}
              </span>
            ) : (
              <kbd
                data-talk-binding-label=""
                className="rounded-md border border-b-2 border-border bg-muted px-2 py-0.5 font-mono text-xs leading-5 text-foreground"
              >
                {label}
              </kbd>
            )}
            <Button
              ref={bindRef}
              variant="outline"
              size="sm"
              aria-label={t('voiceSettings.companion.talkBinding.bindLabel', { defaultValue: 'Bind the talk button' })}
              onClick={onBind}
            >
              {t('voiceSettings.companion.talkBinding.bind', { defaultValue: 'Bind' })}
            </Button>
            {label !== null && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('voiceSettings.companion.talkBinding.clearLabel', { defaultValue: 'Clear the talk button' })}
                onClick={onClear}
                className="text-muted-foreground hover:text-foreground"
              >
                {t('voiceSettings.companion.talkBinding.clear', { defaultValue: 'Clear' })}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
