import { useTranslation } from 'react-i18next';
import { Mic, Square, Loader2 } from 'lucide-react';

import { PromptInputButton } from '@/shared/ui';
import type { VoiceInputState } from '@/shared/types';

type Props = {
  state: VoiceInputState;
  onToggle: () => void;
  errorMsg?: string | null;
};

// Rendered by chat's ChatComposer next to the send button.
// Push-to-talk mic button (presentational). Recording state and the stop-and-send action
// are owned by the composer so the main Send button can drive them too. This button just
// starts recording and, while recording, stops and drops the transcript into the input box.
export default function VoiceInputButton({ state, onToggle, errorMsg }: Props) {
  const { t } = useTranslation('chat');

  const icon =
    state === 'recording' ? (
      <Square className="text-red-500" />
    ) : state === 'transcribing' ? (
      <Loader2 className="animate-spin" />
    ) : (
      <Mic />
    );

  return (
    <span className="relative inline-flex">
      {errorMsg && (
        // Anchored to the mic's left edge and wrapped: the mic sits at the left of a phone's footer, where a bubble centered on it ran off
        // the screen, and a Gemini refusal is a whole sentence. `w-max` keeps a short message on one line inside the button's narrow box.
        // Where a pointer hovers, "Voice input" stands over the mic as its tooltip (the pointer is still on the mic that was just pressed)
        // and covered the sentence's first words, so the bubble rises above it there; touch has no tooltip and keeps the bubble close.
        <span className="absolute bottom-full left-0 mb-1 w-max max-w-[min(18rem,calc(100vw-4.5rem))] rounded bg-red-600 px-2 py-1 text-xs text-white shadow-lg [@media(hover:hover)]:mb-11">
          {errorMsg}
        </span>
      )}
      <PromptInputButton
        tooltip={{ content: state === 'recording' ? t('voice.stopRecording') : t('voice.input') }}
        onClick={(e: { preventDefault: () => void }) => {
          e.preventDefault();
          onToggle();
        }}
      >
        {icon}
      </PromptInputButton>
    </span>
  );
}
