import { AudioLines, Crosshair, Square, X } from 'lucide-react';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { CompanionVoiceSwitch } from '@/modules/companion/CompanionVoiceSwitch';
import { errorMessage } from '@/shared/api';
import type { CompanionModel, CompanionPicture } from '@/shared/companion-types';
import { useToast } from '@/shared/context/ToastContext';
import type { CompanionPageState, CompanionVoice, Tone } from '@/shared/types';
import { Button, ConfirmDialog, Select, Switch, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

type CompanionHeaderProps = {
  /** Her name as he set it, or the default while the picture loads. */
  name: string;
  /** Null while the picture loads: the status line says so and every control waits. */
  picture: CompanionPicture | null;
  /**
   * The page's own state, already resolved in its order (cut > listening > transcribing > speaking): the status line
   * reads Cut, Listening, Transcribing or Speaking in place of her own state. Absent or null, the line is hers alone.
   */
  pageState?: CompanionPageState | null;
  /**
   * This page's voice switch: drawn in a row of its own under the controls, "Voice on this device". Absent, there is no
   * row.
   */
  voice?: Pick<CompanionVoice, 'on' | 'setOn'>;
  onModelChange: (model: CompanionModel) => Promise<void>;
  onLiveChange: (live: boolean) => Promise<void>;
  onInterrupt: () => Promise<void>;
  onClear: () => Promise<void>;
  onClose: () => void;
};

/**
 * The status line: the key of its words and their numbers, the part of them that may give way (`subject`, the chat's name
 * or the files', drawn in the words' `<subject/>` slot), the tone of its dot, whether the dot breathes, and the English
 * words (`fallback`) for a key a locale may not carry yet.
 */
type Status = { key: string; values?: Record<string, number>; subject?: string; tone: Tone; moving: boolean; fallback?: string };

/** At most this many file names ride the "Reading code" line; more are counted instead. */
const FILES_NAMED = 2;

/** A path's last segment: the status line names a file, never where it lives. */
const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/**
 * Her state as one line. The process speaks first — asleep, waking and failed say nothing about a turn — and an awake
 * process is its activity: Idle, Thinking, Reading <chat>, Reading code, Drafting for <chat>, Walking <chat> · item k of
 * n. The dot's tone is the line's colour word: grey asleep, green idle (ready), blue while she works, amber failed (errors
 * are amber, never red). The words carry the state on their own, so the dot is never the whole signal. A failed process
 * says "Stopped": she fails after starting too (her process ending mid-conversation, a turn breaking), and the line
 * claims no cause — the Banner under the header carries the server's sentence.
 *
 * THE PAGE SPEAKS BEFORE ALL OF IT, its state resolved by the panel in one order. While his talk press is out the line is
 * Listening (green, breathing: the mic is open, so it wins even over a picture still loading or a process asleep or
 * failed) or Transcribing (blue, breathing, like her own work); while this page's player sounds her voice it is Speaking
 * (blue, breathing). A press that cuts her off mid-sentence reads Cut for a breath (900 ms; grey and still, her voice just
 * stopped) before Listening takes the line: the talk button below is lit the whole time, so the open mic is never unshown.
 * Her own state comes back the moment the page has none.
 */
function statusOf(picture: CompanionPicture | null, pageState: CompanionPageState | null): Status {
  if (pageState === 'cut') return { key: 'companion.status.cut', fallback: 'Cut', tone: 'neutral', moving: false };
  if (pageState === 'listening') return { key: 'companion.status.listening', fallback: 'Listening', tone: 'positive', moving: true };
  if (pageState === 'transcribing') return { key: 'companion.status.transcribing', fallback: 'Transcribing', tone: 'info', moving: true };
  if (pageState === 'speaking') return { key: 'companion.status.speaking', fallback: 'Speaking', tone: 'info', moving: true };
  if (picture === null) return { key: 'companion.panel.loadingStatus', tone: 'neutral', moving: true };
  const { process, activity } = picture;
  if (process.state === 'failed') return { key: 'companion.status.failed', tone: 'warn', moving: false };
  if (process.state === 'asleep') return { key: 'companion.status.asleep', tone: 'neutral', moving: false };
  if (process.state === 'waking') return { key: 'companion.status.waking', tone: 'info', moving: true };
  const working = { tone: 'info', moving: true } as const;
  const chat = activity.session?.name;
  switch (activity.phase) {
    case 'idle':
      return { key: 'companion.status.idle', tone: 'positive', moving: false };
    case 'thinking':
      return { key: 'companion.status.thinking', ...working };
    case 'reading_session':
      return chat ? { key: 'companion.status.readingSession', subject: chat, ...working } : { key: 'companion.status.readingAChat', ...working };
    case 'reading_code': {
      const files = activity.files ?? [];
      if (files.length === 0) return { key: 'companion.status.readingCode', ...working };
      if (files.length <= FILES_NAMED) return { key: 'companion.status.readingFiles', subject: files.map(baseName).join(', '), ...working };
      return { key: 'companion.status.readingManyFiles', values: { count: files.length }, ...working };
    }
    case 'drafting':
      return chat ? { key: 'companion.status.draftingFor', subject: chat, ...working } : { key: 'companion.status.draftingNew', ...working };
    case 'walking':
      return chat && activity.walk
        ? { key: 'companion.status.walking', subject: chat, values: { at: activity.walk.at, total: activity.walk.total }, ...working }
        : { key: 'companion.status.walkingPlain', ...working };
  }
}

/**
 * The top of her panel, in the order the eye wants it: who and what she is doing, the chat "it" means, then the
 * controls. Drawn by this module's CompanionPanel.
 *
 * ROW ONE: her mark, her name, and the status line under it (`role="status"`, so a change is announced; the page's own
 * state, `pageState`, folds over it); at the far end Stop — only while her turn runs, the one urgent press, so it stands
 * beside the way out — and the panel's own close. ROW TWO, only while she holds one: the focus chat, "Focus · Kanban
 * lanes · its project", the chat "it" and "this" mean in what she says. ROW THREE: the model picker, the Live switch, and
 * Clear behind its question. ROW FOUR, given `voice`: "Voice on this device" (CompanionVoiceSwitch), its switch under
 * Clear. A row of its own because the third has no width to give a labelled switch (measured: 50px spare on the 400px
 * column, none at 320px), and because it is this device's where the third row's are hers, on every device.
 *
 * A model or Live choice shows at once and holds while its save is out: the picture keeps the old value until the
 * server's settings come back, and a control that snapped back meanwhile would read as refused. A refused save puts
 * the old value back and says so in a toast; so does a Stop or a Clear that fails. The voice switch is the page's own and
 * answers at once.
 */
export function CompanionHeader({ name, picture, pageState = null, voice, onModelChange, onLiveChange, onInterrupt, onClear, onClose }: CompanionHeaderProps) {
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

  const status = statusOf(picture, pageState);
  const ready = picture !== null;
  const model = pendingModel ?? picture?.settings.model ?? null;
  const live = pendingLive ?? picture?.settings.live ?? false;
  const focus = picture?.focus ?? null;
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

  return (
    <div data-companion-header="" className="shrink-0 border-b border-border bg-card">
      <div className="flex items-center gap-2.5 py-2.5 pl-3 pr-2">
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink">
          <AudioLines className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold leading-5 text-foreground">{name}</h2>
          <p role="status" data-tone={status.tone} data-companion-status="" className="flex min-w-0 items-start gap-1.5 text-xs leading-5 text-muted-foreground">
            <span aria-hidden="true" className={cn('mt-1.5 size-2 shrink-0 rounded-full bg-tone-dot', status.moving && 'motion-safe:animate-pulse')} />
            {status.subject === undefined ? (
              // No subject to give way ("Stopped · your next message starts her again"): the words wrap to a second line
              // on a narrow phone rather than lose their end, which is the next step.
              <span className="line-clamp-2 min-w-0 break-words">{t(status.key, { ...status.values, defaultValue: status.fallback })}</span>
            ) : (
              // One line in which only the subject gives way: the verb and "· item 2 of 5" are runs of text that keep their
              // width (`whitespace-pre`), and the chat's name, carried as the slot's own child so a name holding "<" reads as
              // written, truncates between them. The place in the walk is what he needs; the name is on the focus row too.
              // The name starts from nothing and grows into the room the runs leave (never past its own width, so the
              // place follows it); only when even a nameless line does not fit — a 320px phone beside Stop — does the
              // place wrap to a second line, whole.
              <span className="flex min-w-0 flex-wrap overflow-hidden whitespace-pre">
                <Trans
                  t={t}
                  i18nKey={status.key}
                  values={status.values}
                  components={{ subject: <span data-companion-status-subject="" className="min-w-0 max-w-fit flex-1 truncate">{status.subject}</span> }}
                />
              </span>
            )}
          </p>
        </div>
        {turnRunning && (
          <Button variant="outline" size="sm" busy={stopping} onClick={stop} className="shrink-0 [@media(pointer:coarse)]:h-11" aria-label={t('companion.stopHint', { name })}>
            <Square aria-hidden="true" className="fill-current" />
            {t('companion.stop')}
          </Button>
        )}
        <Tooltip content={t('companion.panel.close', { name })} position="bottom">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('companion.panel.close', { name })}
            // 32px to look at; a transparent catch makes it 40px to hit under a mouse and 44px under a finger, Verve's
            // touch floor — on a phone this is the sheet's only way out.
            className="relative h-8 w-8 shrink-0 text-muted-foreground before:absolute before:-inset-1 before:content-[''] hover:text-foreground [@media(pointer:coarse)]:before:-inset-1.5"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        </Tooltip>
      </div>

      {focus && (
        <p data-companion-focus="" className="flex min-w-0 items-center gap-1.5 px-3 pb-2.5 text-xs text-muted-foreground">
          <Crosshair aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="shrink-0">{t('companion.focus')}</span>
          <span className="min-w-0 truncate">
            <span className="font-medium text-foreground">{focus.name}</span>
            {' · '}
            {focus.project}
          </span>
        </p>
      )}

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
          // The panel holds two Clears: this one wipes her memory, the draft card's discards the brief.
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
    </div>
  );
}
