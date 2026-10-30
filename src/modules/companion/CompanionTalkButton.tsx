import { Mic } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { TalkPressState } from '@/shared/types';
import { Button, Spinner, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

type CompanionTalkButtonProps = {
  /** Where the page's one press stands: the button's look and its name follow it. */
  state: TalkPressState;
  /**
   * What failed with his last press on the page itself (the mic refused, the clip not sent); null when nothing did. The
   * button takes the warn ink and carries it as its description; the composer says it above the box beside it.
   */
  error: string | null;
  /** One press: open the mic and record, or stop it and send the clip. Taken in every state. */
  onToggle: () => void;
  /** Her name as he set it, for the button's name: "Talk to Kaylee". */
  name: string;
};

/**
 * The talk button: the same press as the key or mouse button he binds in Settings, on her panel for the phone. Composed
 * for this module's CompanionComposer, in its slot before send, and for the station module's talk control;
 * `.verify/kaylee-talk-scaffold.mjs` draws it in each state.
 *
 * ONE BUTTON, THREE STATES, at send's size (32px to the eye, a 44px catch under a finger, Verve's touch floor; under a
 * finger it stands 8px further from send, so the two catches meet and neither takes the other's edge):
 * - idle: the mic in the muted ink, named "Talk to Kaylee";
 * - listening: lit — the kit's tonal ground and ink with a breathing ring, named "Stop and send". The mic is open only
 *   now, so this is the look that must never be missed. A plain button, not a toggle: its name changes with its state,
 *   and a toggle's must not (the status line's "Listening" says the state out loud);
 * - transcribing: the kit's spinner turning around the mic while the clip becomes words. Still taken: a press records
 *   again at once, so it is named for that ("Transcribing · press to talk again").
 *
 * AN ERROR is what failed with a press on the page (the mic refused, the clip not sent), never a refused transcription:
 * that is her harness's system line in the log. The composer says it in words right above the box at this end (in the
 * flow, so it stands over nothing); the mic here takes the same amber, and a reader on the button hears the sentence as
 * its description. The button's name, shown on hover, opens to its left while the error stands, so it never covers the
 * sentence. Both go with the next press.
 */
export function CompanionTalkButton({ state, error, onToggle, name }: CompanionTalkButtonProps) {
  const { t } = useTranslation();
  const errorId = useId();
  const listening = state === 'listening';
  const label = listening
    ? t('companion.talk.stop', { defaultValue: 'Stop and send' })
    : state === 'transcribing'
      ? t('companion.talk.transcribing', { defaultValue: 'Transcribing · press to talk again' })
      : t('companion.talk.start', { defaultValue: 'Talk to {{name}}', name });

  return (
    // Under a finger, 8px more from send (12px between the faces), so the two 44px catches meet and do not overlap.
    <span data-companion-talk={state} className="relative inline-flex shrink-0 [@media(pointer:coarse)]:mr-2">
      {/* The error stands right above this button, where the tooltip would open over its words: with one up, the name opens beside the button instead. */}
      <Tooltip content={label} position={error === null ? 'top' : 'left'}>
        <Button
          type="button"
          variant={listening ? 'tonal' : 'ghost'}
          size="icon"
          aria-label={label}
          aria-describedby={error === null ? undefined : errorId}
          data-tone={error === null ? undefined : 'warn'}
          onClick={onToggle}
          // Send's size and corner, so the two read as one pair; the transparent catch makes it 44px under a finger.
          className={cn(
            'relative h-8 w-8 rounded-lg before:absolute before:inset-0 before:content-[\'\'] [@media(pointer:coarse)]:before:-inset-1.5',
            !listening && (error === null ? 'text-muted-foreground hover:text-foreground' : 'text-tone-ink hover:text-tone-ink'),
          )}
        >
          <Mic aria-hidden="true" />
        </Button>
      </Tooltip>
      {listening && (
        // The breathing ring: the mic is open. It stands over the button's edge and takes no press.
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-primary motion-safe:animate-pulse" />
      )}
      {state === 'transcribing' && (
        // The kit's spinner around the mic, laid over the button so the mic stays the thing to press. The status line
        // says Transcribing out loud; the ring is for the eye alone.
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
          <Spinner size={28} />
        </span>
      )}
      {error !== null && <span id={errorId} className="sr-only">{error}</span>}
    </span>
  );
}
