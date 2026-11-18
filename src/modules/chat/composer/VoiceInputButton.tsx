import { Mic } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { VoiceInputState } from '@/shared/types';
import { PromptInputButton, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

type Props = {
  state: VoiceInputState;
  onToggle: () => void;
};

/**
 * THE LINE'S TALK BUTTON: speech to text, into the line. One press opens the mic, the next stops it, and the clip's words are
 * added to what is typed (the server hears it as it hears a press to the companion: the account's home server first, Gemini when
 * that cannot). It is always in the line; it needs nothing switched on.
 *
 * ONE BUTTON, THREE STATES, drawn as the companion's own talk button is, so the two read as the same press:
 * - idle: the mic in the muted ink;
 * - recording: lit (the kit's tonal ground and ink) with a breathing ring. The mic is open only now, so this is the look that
 *   must never be missed;
 * - transcribing: the kit's spinner turning round the mic while the clip becomes words.
 *
 * Presentational: the recording, the stop-and-send from the Send button and the mic's notice and error sentences are the
 * composer's (`ChatComposer`, which draws the sentences above its form). `data-chat-talk` reads the state.
 */
export default function VoiceInputButton({ state, onToggle }: Props) {
  const { t } = useTranslation('chat');
  const recording = state === 'recording';
  const label = recording ? t('voice.stopRecording') : state === 'transcribing' ? t('voice.transcribing') : t('voice.input');

  return (
    <span data-chat-talk={state} className="relative inline-flex shrink-0">
      <PromptInputButton
        tooltip={{ content: label }}
        variant={recording ? 'tonal' : 'ghost'}
        aria-label={label}
        onClick={(e: { preventDefault: () => void }) => {
          e.preventDefault();
          onToggle();
        }}
        // The kit's 32px button keeps its size to the eye and takes a 44px catch under a finger.
        className={cn("relative rounded-lg before:absolute before:inset-0 before:content-[''] finger:before:-inset-1.5", !recording && 'text-muted-foreground hover:text-foreground')}
      >
        <Mic aria-hidden="true" />
      </PromptInputButton>
      {recording && (
        // The breathing ring: the mic is open. It stands over the button's edge and takes no press.
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-primary motion-safe:animate-pulse" />
      )}
      {state === 'transcribing' && (
        // The kit's spinner round the mic, laid over the button so the mic stays the thing to press.
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
          <Spinner size={28} />
        </span>
      )}
    </span>
  );
}
