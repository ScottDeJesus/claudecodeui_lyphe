import { Square } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { CompanionEarsSwitch } from '@/modules/companion/CompanionEarsSwitch';
import { CompanionVoiceSwitch } from '@/modules/companion/CompanionVoiceSwitch';
import { errorMessage } from '@/shared/api';
import type { CompanionModel, CompanionPicture } from '@/shared/companion-types';
import { useToast } from '@/shared/context/ToastContext';
import type { CompanionEars, CompanionVoice } from '@/shared/types';
import { Button, ConfirmDialog, Select, Switch, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

type CompanionControlsProps = {
  /** Her name as he set it, or the default while the picture loads: Stop's hint, Clear's label and question, and the toast of a refused Clear. */
  name: string;
  /** Null while the picture loads: every control waits. Model, Live and whether a turn runs (Stop) are read from it. */
  picture: CompanionPicture | null;
  /**
   * This page's voice switch: drawn in a row of its own under the controls, "Voice on this device". Absent, there is no
   * row.
   */
  voice?: Pick<CompanionVoice, 'on' | 'setOn'>;
  /**
   * This page's ears: "Listen for her name on this device" and, while on, what they are doing. A row of its own under the voice
   * row in `rows`, beside the voice switch in `line`. Absent, nothing is drawn.
   */
  ears?: CompanionEars;
  onModelChange: (model: CompanionModel) => Promise<void>;
  onLiveChange: (live: boolean) => Promise<void>;
  onInterrupt: () => Promise<void>;
  onClear: () => Promise<void>;
} & (
  | {
      /** `rows` is the panel's: the controls row, the voice row under it, and the ears row under that. */
      layout: 'rows';
      /**
       * Where `rows` draws Stop: the node the panel's title row keeps beside her way out. Stop is drawn into it and nowhere
       * else, so until the node exists (null) it waits. Required, so a caller that forgets the node fails to compile rather
       * than lose the one urgent press without a word.
       */
      stopSlot: HTMLElement | null;
    }
  | {
      /** `line` is the station's: every control in one line, Stop first, wrapping where the line runs out of width. */
      layout: 'line';
      /** Where the line's controls stand in its box: `start` (the default) under words that start there, `center` under her face centred over hers (the station's wide head). */
      align?: 'start' | 'center';
    }
);

/**
 * Her controls: Stop, the model picker, the Live switch, Clear (asked first), given `voice` this device's voice, and given
 * `ears` her ears on this device. Consumed by this module's `CompanionHeader` (the panel's `rows`) and by the station module,
 * so a rule of a control is kept in this one place (MAN-9090).
 *
 * ROWS, the panel's. ROW ONE of the header, far end: Stop — only while her turn runs, the one urgent press, so the title row keeps its place
 * beside the way out and this draws it there (`stopSlot`). THE CONTROLS ROW: the model picker, the Live switch, and Clear
 * behind its question. THE VOICE ROW, given `voice`: "Voice on this device" (CompanionVoiceSwitch), its switch under
 * Clear. A row of its own because the controls row has no width to give a labelled switch (measured: 50px spare on the
 * 400px column, none at 320px), and because it is this device's where the controls row's are hers, on every device. THE EARS
 * ROW, given `ears`, under it: "Listen for her name on this device" (CompanionEarsSwitch), its switch under the voice row's, and
 * while it is on what her ears are doing under the words; a row of its own for the voice row's two reasons.
 *
 * LINE, the station's (its head draws it under her state): one line, in the order the eye wants it — Stop while her turn
 * runs, the model picker, the Live switch, "Voice on this device" given `voice`, "Listen for her name on this device" given
 * `ears`, then Clear. Each keeps its words and its catch under a finger, the panel's own; the line wraps rather than cut a word
 * where its box runs out of width (her column at 1440 px, a phone), and the last switch and Clear wrap as one, so Clear never
 * stands alone on a line of its own: "Stop · model · Live" over "Voice on this device · Clear", or, given `ears`, over "Voice on
 * this device" over "Listen for her name on this device · Clear". `align` centres it under a centred head.
 *
 * WHAT LIVE DOES, IN WORDS where nothing hovers (a touch screen, `hover: none`): its tooltip's sentence, "On: she hears the
 * house's alerts and speaks up without being asked.", also stands muted under the line that holds Live: in `line` a line of its
 * own right after Live ("Stop · model · Live" over the words, over "Voice on this device · Clear"), in `rows` under the controls
 * row, inside its rules. A pointer keeps the tooltip and is drawn no words (the touch law, INV-10275: nothing said only on hover).
 *
 * A model or Live choice shows at once and holds while its save is out: the picture keeps the old value until the
 * server's settings come back, and a control that snapped back meanwhile would read as refused. A refused save puts
 * the old value back and says so in a toast; so does a Stop or a Clear that fails. Clear asks first. The voice and ears
 * switches are the page's own and answer at once.
 */
export function CompanionControls(props: CompanionControlsProps) {
  const { name, picture, voice, ears, onModelChange, onLiveChange, onInterrupt, onClear } = props;
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
    <Button variant="outline" size="sm" busy={stopping} onClick={stop} className="shrink-0 finger:h-11" aria-label={t('companion.stopHint', { name })}>
      <Square aria-hidden="true" className="fill-current" />
      {t('companion.stop')}
    </Button>
  );

  const select = (
    <Select
      size="sm"
      ariaLabel={t('companion.model')}
      options={(picture?.models ?? []).map((option) => ({ value: option.value, label: option.label }))}
      value={model ?? ''}
      placeholder={t('companion.model')}
      disabled={!ready || pendingModel !== null}
      onChange={chooseModel}
    />
  );

  const liveSwitch = (
    <Tooltip content={t('companion.liveHint')} showOnFocus position="bottom">
      {/* A label around the word and the switch, so a press anywhere on it presses the switch: the kit's 30px switch
          gets a 44px catch under a finger. The switch carries the name; the word beside it is for the eye. */}
      <label data-companion-live="" className="flex cursor-pointer items-center gap-2 finger:min-h-11">
        <span aria-hidden="true" className="text-xs font-medium text-foreground">{t('companion.live')}</span>
        <Switch checked={live} label={t('companion.live')} disabled={!ready || pendingLive !== null} onChange={switchLive} />
      </label>
    </Tooltip>
  );

  // What Live does, in words where nothing hovers to open its tooltip (a touch screen): muted, under the line that holds Live. A
  // pointer keeps the tooltip and draws no words. Outside the label, so a tap on the words never flips the switch.
  const liveWords = (className: string) => (
    <p data-companion-live-words="" className={cn('hidden text-xs leading-snug text-muted-foreground [@media(hover:none)]:block', className)}>
      {t('companion.liveHint')}
    </p>
  );

  const clearButton = (
    <Button
      variant="ghost"
      size="sm"
      disabled={!ready}
      // The panel holds two Clears: this one wipes her conversation, the draft card's discards the brief.
      aria-label={t('companion.clearLabel', { name })}
      onClick={() => setConfirmingClear(true)}
      className="shrink-0 text-muted-foreground hover:text-foreground finger:h-11"
    >
      {t('companion.clear')}
    </Button>
  );

  const voiceSwitch = voice && <CompanionVoiceSwitch on={voice.on} onChange={voice.setOn} />;
  const earsSwitch = ears && <CompanionEarsSwitch ears={ears} name={name} />;
  // The line's last switch, which Clear wraps with: the ears' where they are drawn, else the voice's.
  const lastSwitch = earsSwitch ?? voiceSwitch;

  const confirmClear = (
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
  );

  if (props.layout === 'line') {
    return (
      <>
        <div data-companion-controls="line" className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2', props.align === 'center' && 'justify-center')}>
          {turnRunning && stopButton}
          {/* A fixed width, so the line does not move as he picks a model with a longer name. */}
          <div className="w-36 min-w-0">{select}</div>
          {liveSwitch}
          {/* A line of its own, right under the one that holds Live. */}
          {liveWords(cn('basis-full', props.align === 'center' && 'text-center'))}
          {/* Given the ears, the voice switch stands on its own, and the ears' switch is the one Clear wraps with. */}
          {earsSwitch && voiceSwitch && <div className="flex min-w-0">{voiceSwitch}</div>}
          {/* The last switch and Clear as one: a lone Clear on a line of its own reads as a stray word. The switch's own box is
              as wide as its words: its row is a full-width label, made for the panel's row of its own. */}
          <div className="flex min-w-0 items-center gap-3">
            {lastSwitch && <div className="flex min-w-0">{lastSwitch}</div>}
            {clearButton}
          </div>
        </div>
        {confirmClear}
      </>
    );
  }

  return (
    <>
      {turnRunning && props.stopSlot && createPortal(stopButton, props.stopSlot)}

      <div className="flex items-center gap-3 border-t border-border px-3 py-2">
        {/* The picker gives way at the narrowest (a 320px phone), so Live and Clear always stand inside the sheet. */}
        <div className="min-w-0 basis-36">{select}</div>
        {liveSwitch}
        <span className="flex-1" />
        {clearButton}
      </div>
      {/* Inside the controls row's rules, under it: the words belong to its Live, not to the voice row below. */}
      {liveWords('-mt-1 px-3 pb-2')}

      {voiceSwitch && (
        // Under the controls, its switch closing the row as Clear closes the one above. Under a finger (a touch screen, or a window
        // under 768 px) the switch's 44px label is the row's height, so the row adds no padding of its own there.
        <div data-companion-voice-row="" className="flex items-center border-t border-border px-3 py-1.5 finger:py-0">
          {voiceSwitch}
        </div>
      )}

      {earsSwitch && (
        // Under the voice row, its switch closing the row under the voice row's. Under a finger its 44px label is the row's height,
        // as the voice row's is; while the state's words stand under the label the row keeps its padding there too, so two lines of
        // words never touch its rules.
        <div data-companion-ears-row="" className="flex items-center border-t border-border px-3 py-1.5 finger:py-0 finger:has-[[data-companion-ears-state]]:py-1.5">
          {earsSwitch}
        </div>
      )}

      {confirmClear}
    </>
  );
}
