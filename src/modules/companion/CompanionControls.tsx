import { Square } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { CompanionVoiceSwitch } from '@/modules/companion/CompanionVoiceSwitch';
import { errorMessage } from '@/shared/api';
import type { CompanionModel, CompanionPicture } from '@/shared/companion-types';
import { useToast } from '@/shared/context/ToastContext';
import type { CompanionPresence, CompanionVoice } from '@/shared/types';
import { Button, ConfirmDialog, Select, Switch, Tooltip } from '@/shared/ui';

type CompanionControlsProps = {
  /** Her name as he set it, or the default while the picture loads: Stop's hint, Clear's label and question, and the toast of a refused Clear. */
  name: string;
  /** Null while the picture loads: every control waits. Model, Live and whether a turn runs (Stop) are read from it. */
  picture: CompanionPicture | null;
  /**
   * What she is doing on this page, from `useCompanionPresence`. The rows read the picture's turn for Stop, as the panel's
   * controls always have (MAN-9089: a consumer may read its own source for its own part), so nothing in this layout reads it.
   */
  presence: CompanionPresence;
  /**
   * This page's voice switch: drawn in a row of its own under the controls, "Voice on this device". Absent, there is no
   * row.
   */
  voice?: Pick<CompanionVoice, 'on' | 'setOn'>;
  /** `rows` is the panel's: the controls row, and the voice row under it. */
  layout: 'rows';
  onModelChange: (model: CompanionModel) => Promise<void>;
  onLiveChange: (live: boolean) => Promise<void>;
  onInterrupt: () => Promise<void>;
  onClear: () => Promise<void>;
  /**
   * Where `rows` draws Stop: the node the panel's title row keeps beside her way out. Stop is drawn into it and nowhere
   * else, so until the node exists (null) it waits. Required, so a caller that forgets the node fails to compile rather
   * than lose the one urgent press without a word.
   */
  stopSlot: HTMLElement | null;
};

/**
 * Her controls: Stop, the model picker, the Live switch, Clear (asked first) and, given `voice`, this device's voice.
 * Consumed by this module's `CompanionHeader` (the panel's `rows`) and by the station module, so a rule of a control is
 * kept in this one place (MAN-9090).
 *
 * ROWS, the panel's. ROW ONE of the header, far end: Stop — only while her turn runs, the one urgent press, so the title row keeps its place
 * beside the way out and this draws it there (`stopSlot`). THE CONTROLS ROW: the model picker, the Live switch, and Clear
 * behind its question. THE VOICE ROW, given `voice`: "Voice on this device" (CompanionVoiceSwitch), its switch under
 * Clear. A row of its own because the controls row has no width to give a labelled switch (measured: 50px spare on the
 * 400px column, none at 320px), and because it is this device's where the controls row's are hers, on every device.
 *
 * A model or Live choice shows at once and holds while its save is out: the picture keeps the old value until the
 * server's settings come back, and a control that snapped back meanwhile would read as refused. A refused save puts
 * the old value back and says so in a toast; so does a Stop or a Clear that fails. Clear asks first. The voice switch is
 * the page's own and answers at once.
 */
export function CompanionControls({ name, picture, voice, onModelChange, onLiveChange, onInterrupt, onClear, stopSlot }: CompanionControlsProps) {
  const { t } = useTranslation();
  const pushToast = useToast();
  // The model he just chose, shown until its save settles; null when none is out. Needed because the picture only
  // learns the new model when the save comes back.
  const [pendingModel, setPendingModel] = useState<CompanionModel | null>(null);
  // The Live position he just chose, shown until its save settles; null when none is out. Same reason as the model.
  const [pendingLive, setPendingLive] = useState<boolean | null>(null);
  // Whether Clear's question is up. The dialog is the only way to clear, so the question is the press's first half.
  const [confirmingClear, setConfirmingClear] = useState(false);
  // Clear's answer is out: the dialog's confirm is busy, and a second press is refused rather than sent twice.
  const [clearing, setClearing] = useState(false);
  // Stop is out: the button is busy until her turn has stopped or the stop is refused.
  const [stopping, setStopping] = useState(false);

  const ready = picture !== null;
  const model = pendingModel ?? picture?.settings.model ?? null;
  const live = pendingLive ?? picture?.settings.live ?? false;
  const turnRunning = picture?.turnId != null;

  const refused = (title: string, error: unknown) => pushToast({ tone: 'warn', title, message: errorMessage(error) ?? undefined });

  const chooseModel = (next: string) => {
    const chosen = next as CompanionModel;
    setPendingModel(chosen);
    onModelChange(chosen)
      .catch((error: unknown) => refused(t('companion.modelRefused'), error))
      .finally(() => setPendingModel(null));
  };

  const switchLive = (next: boolean) => {
    setPendingLive(next);
    onLiveChange(next)
      .catch((error: unknown) => refused(t(next ? 'companion.liveOnRefused' : 'companion.liveOffRefused'), error))
      .finally(() => setPendingLive(null));
  };

  const stop = () => {
    setStopping(true);
    onInterrupt()
      .catch((error: unknown) => refused(t('companion.stopRefused'), error))
      .finally(() => setStopping(false));
  };

  const clear = () => {
    setClearing(true);
    onClear()
      .then(() => setConfirmingClear(false))
      .catch((error: unknown) => refused(t('companion.clearRefused', { name }), error))
      .finally(() => setClearing(false));
  };

  const stopButton = (
    <Button variant="outline" size="sm" busy={stopping} onClick={stop} className="shrink-0 [@media(pointer:coarse)]:h-11" aria-label={t('companion.stopHint', { name })}>
      <Square aria-hidden="true" className="fill-current" />
      {t('companion.stop')}
    </Button>
  );

  return (
    <>
      {turnRunning && stopSlot && createPortal(stopButton, stopSlot)}

      <div className="flex items-center gap-3 border-t border-border px-3 py-2">
        {/* The picker gives way at the narrowest (a 320px phone), so Live and Clear always stand inside the sheet. */}
        <div className="min-w-0 basis-36">
          <Select
            size="sm"
            ariaLabel={t('companion.model')}
            options={(picture?.models ?? []).map((option) => ({ value: option.value, label: option.label }))}
            value={model ?? ''}
            placeholder={t('companion.model')}
            disabled={!ready || pendingModel !== null}
            onChange={chooseModel}
          />
        </div>
        <Tooltip content={t('companion.liveHint')} showOnFocus position="bottom">
          {/* A label around the word and the switch, so a press anywhere on it presses the switch: the kit's 30px switch
              gets a 44px catch under a finger. The switch carries the name; the word beside it is for the eye. */}
          <label className="flex cursor-pointer items-center gap-2 [@media(pointer:coarse)]:min-h-11">
            <span aria-hidden="true" className="text-xs font-medium text-foreground">{t('companion.live')}</span>
            <Switch checked={live} label={t('companion.live')} disabled={!ready || pendingLive !== null} onChange={switchLive} />
          </label>
        </Tooltip>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          disabled={!ready}
          // The panel holds two Clears: this one wipes her conversation, the draft card's discards the brief.
          aria-label={t('companion.clearLabel', { name })}
          onClick={() => setConfirmingClear(true)}
          className="shrink-0 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:h-11"
        >
          {t('companion.clear')}
        </Button>
      </div>

      {voice && (
        // Under the controls, its switch closing the row as Clear closes the one above. On a touch screen the switch's
        // 44px label is the row's height, so the row adds no padding of its own there.
        <div data-companion-voice-row="" className="flex items-center border-t border-border px-3 py-1.5 [@media(pointer:coarse)]:py-0">
          <CompanionVoiceSwitch on={voice.on} onChange={voice.setOn} />
        </div>
      )}

      <ConfirmDialog
        open={confirmingClear}
        title={t('companion.clearTitle', { name })}
        message={t('companion.clearMessage')}
        actions={[
          { label: t('companion.cancel'), variant: 'outline', onSelect: () => setConfirmingClear(false), disabled: clearing },
          { label: t('companion.clearConfirm'), variant: 'destructive', onSelect: clear, busy: clearing },
        ]}
        onDismiss={() => { if (!clearing) setConfirmingClear(false); }}
      />
    </>
  );
}
