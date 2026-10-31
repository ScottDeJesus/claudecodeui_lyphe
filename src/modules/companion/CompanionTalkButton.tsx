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
   * button takes the warn ink and carries it as its description; at the default size the composer says it above the box
   * beside it, at `large` the button says it in its own line, beside it or under it, and at `round` the phone's
   * arrangement says it in the flow above its bar.
   */
  error: string | null;
  /** One press: open the mic and record, or stop it and send the clip. Taken in every state. */
  onToggle: () => void;
  /** Her name as he set it, for the button's name: "Talk to Kaylee". */
  name: string;
} & (
  | {
      /** `default` (or absent): send's size, in the composer's slot before send. */
      size?: 'default';
    }
  | {
      /** `large`: the station's talk control, a labelled button 56 px tall. */
      size: 'large';
      /**
       * The key or mouse button he bound, as Settings names it ("F8", "Mouse back"), said under the button; null when none is;
       * undefined while his settings are not read (the line stands empty, never "Bind a key" over a key he has bound).
       */
      bindingLabel: string | null | undefined;
      /** 44 px tall rather than 56, its words kept (two lines at most, set tighter): the station's compact head. */
      compact?: boolean;
    }
  | {
      /** `round`: the phone's talk control, 64 px round in the center of its bottom bar, the mic alone in it. */
      size: 'round';
      /** 52 px rather than 64: the phone on its side, whose bar is slimmer (48 px). */
      compact?: boolean;
    }
);

/** The bound control as Settings draws it (TalkBindingField): a keycap. */
const KEYCAP = 'rounded-md border border-b-2 border-border bg-muted px-1.5 font-mono text-xs leading-5 text-foreground';

/**
 * THE LARGE SIZE, the station's talk control: the same press and the same three looks, drawn larger and labelled, so the words
 * a finger needs are on the button and never only in a tooltip. Idle, the kit's outline button (it stands alone beside the
 * typing box, where a ghost would read as words); listening, the tonal ground with the breathing ring; transcribing, the
 * spinner turning round the mic. Its words (`label`) wrap to a second line rather than cut, inside a width the caller gives.
 * 56 px tall; `compact`, 44 px (the station's compact head), its words set tighter so their two lines still stand inside it.
 * ITS LINE: "or press F8" with the bound control as Settings' keycap, or "Bind a key in Settings", empty at its height while
 * his settings are not read; drawn only where a keyboard or a mouse can press it (`any-pointer: fine`): a phone has neither.
 * While an error stands, the error stands in its place on every device, amber with the ▲ (an error replaces the helper rather
 * than stacking under it, as Settings' own talk row does), and is the button's description, so a reader hears it with its
 * name; the binding's words follow the button in reading order, and a phone, which hides them, is never told them.
 * BESIDE THE BUTTON where its box has the room (a query container of its own width: 20rem and more, the station's laptop
 * column, and the station's 360 px column, where the button stands across it), so the row is the button's 56 px; UNDER IT in a
 * narrower box (a laptop column under 38rem gives the button a 12rem cell, holding the button and the typing box in one row only
 * with the line beneath).
 */
function LargeTalkButton({ state, error, onToggle, label, bindingLabel, compact = false }: Pick<CompanionTalkButtonProps, 'state' | 'error' | 'onToggle'> & { label: string; bindingLabel: string | null | undefined; compact?: boolean }) {
  const { t } = useTranslation();
  // The error's line, which describes the button while an error stands.
  const errorId = useId();
  const listening = state === 'listening';

  return (
    // A query container of its own width (the caller's box gives it), so its line stands beside the button where it fits.
    <div data-companion-talk={state} data-companion-talk-size="large" className="min-w-0 [container-type:inline-size]">
      <div className="flex min-w-0 flex-col gap-1.5 [@container(min-width:20rem)]:flex-row [@container(min-width:20rem)]:items-center [@container(min-width:20rem)]:gap-3">
        <span className="relative flex min-w-0 [@container(min-width:20rem)]:flex-1">
          <Button
            type="button"
            variant={listening ? 'tonal' : 'outline'}
            aria-label={label}
            aria-describedby={error === null ? undefined : errorId}
            data-tone={error === null ? undefined : 'warn'}
            onClick={onToggle}
            // Its padding, the mic's box and the gap are as small as reads well: 12rem across (StationTalk's cell) leaves its
            // words 121 px, and "press to talk again" takes 119 px of them, so no state's words are ever cut.
            // Compact, 44 px: the touch law's catch, its two lines of words set tighter so both stand inside it.
            className={cn(
              'w-full min-w-0 justify-start gap-2 rounded-lg px-3 text-left [&_svg]:size-5',
              compact ? 'h-11 py-1' : 'h-14',
              !listening && error !== null && 'text-tone-ink hover:text-tone-ink',
            )}
          >
            <span className="relative grid size-6 shrink-0 place-items-center">
              <Mic aria-hidden="true" className={cn(!listening && error === null && 'text-muted-foreground')} />
              {state === 'transcribing' && (
                // The kit's spinner round the mic, as at the default size: the status line says Transcribing out loud.
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
                  <Spinner size={30} />
                </span>
              )}
            </span>
            <span data-companion-talk-words="" className={cn('line-clamp-2 min-w-0 whitespace-normal', compact ? 'leading-tight' : 'leading-snug')}>{label}</span>
          </Button>
          {listening && (
            // The breathing ring: the mic is open. It stands over the button's edge and takes no press.
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-primary motion-safe:animate-pulse" />
          )}
        </span>
        {error === null ? (
          <p
            data-companion-talk-binding={bindingLabel === undefined ? 'unread' : bindingLabel === null ? 'unbound' : 'bound'}
            className="hidden min-h-5 flex-wrap items-center gap-x-1.5 px-1 text-xs text-muted-foreground [@container(min-width:20rem)]:max-w-36 [@container(min-width:20rem)]:shrink-0 [@media(any-pointer:fine)]:flex"
          >
            {bindingLabel === undefined ? null : bindingLabel === null ? (
              t('station.talk.bindHint', { defaultValue: 'Bind a key in Settings' })
            ) : (
              <>
                {t('station.talk.orPress', { defaultValue: 'or press' })}
                {/* A space the flex line lays out as nothing, so the words copy and read as "or press F8". */}
                {' '}
                <kbd className={KEYCAP}>{bindingLabel}</kbd>
              </>
            )}
          </p>
        ) : (
          <p
            id={errorId}
            role="alert"
            data-tone="warn"
            data-companion-talk-error=""
            className="flex items-start gap-1.5 px-1 text-xs leading-snug text-tone-ink [@container(min-width:20rem)]:max-w-36 [@container(min-width:20rem)]:shrink-0"
          >
            <span aria-hidden="true">▲</span>
            <span className="min-w-0 break-words">{error}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * THE ROUND SIZE, the phone's talk control (the station module's phone arrangement), the one press in the center of its
 * bottom bar under his thumb: the same press and the same three looks, drawn round. 64 px across, 52 px `compact` (the phone
 * on its side), both past the touch law's 44 px, so it needs no catch of its own. The mic stands alone in its center, 28 px
 * (24 px compact): the bar has no room for words, so its name is said to a reader alone, and no tooltip opens over the bar (a
 * phone's long press would leave one standing there). Idle, the kit's outline ring with the mic in the muted ink, as the
 * large size stands alone; listening, lit — the tonal ground and ink with the breathing ring; transcribing, the kit's
 * spinner turning round the mic, between it and the rim. Out of the lit state it is painted on the page's ground, so it
 * stands opaque where it rises over the bar's edge (52 px in the 48 px bar on its side).
 * AN ERROR takes the warn ink on the mic and is the button's description, as at every size; the arrangement says its
 * sentence in the flow above the bar, never over anything. Both go with the next press.
 */
function RoundTalkButton({ state, error, onToggle, label, compact = false }: Pick<CompanionTalkButtonProps, 'state' | 'error' | 'onToggle'> & { label: string; compact?: boolean }) {
  const errorId = useId();
  const listening = state === 'listening';

  return (
    <span data-companion-talk={state} data-companion-talk-size="round" className="relative inline-flex shrink-0 rounded-full">
      <Button
        type="button"
        variant={listening ? 'tonal' : 'outline'}
        aria-label={label}
        aria-describedby={error === null ? undefined : errorId}
        data-tone={error === null ? undefined : 'warn'}
        onClick={onToggle}
        className={cn(
          'rounded-full p-0',
          compact ? 'size-[3.25rem] [&_svg]:size-6' : 'size-16 [&_svg]:size-7',
          // No hover ink: a phone keeps a tapped button hovered, and the mic would stay lit in the foreground's ink.
          !listening && (error === null ? 'bg-background text-muted-foreground' : 'bg-background text-tone-ink'),
        )}
      >
        <Mic aria-hidden="true" />
      </Button>
      {listening && (
        // The breathing ring: the mic is open. It stands over the button's edge and takes no press.
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-primary motion-safe:animate-pulse" />
      )}
      {state === 'transcribing' && (
        // The kit's spinner round the mic, as at the other sizes: the status line says Transcribing out loud.
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
          <Spinner size={compact ? 40 : 48} />
        </span>
      )}
      {error !== null && <span id={errorId} className="sr-only">{error}</span>}
    </span>
  );
}

/**
 * The talk button: the same press as the key or mouse button he binds in Settings, on her panel for the phone. Composed
 * for this module's CompanionComposer, in its slot before send; at `size: 'large'` for the station module's talk control
 * (LargeTalkButton above); and at `size: 'round'` for the station module's phone arrangement, the center of its bottom bar
 * (RoundTalkButton above). `.verify/kaylee-talk-scaffold.mjs` draws the default size in each state,
 * `.verify/kaylee-station-shots.mjs` the large, and `.verify/kaylee-phone-pieces.mjs` the round.
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
export function CompanionTalkButton(props: CompanionTalkButtonProps) {
  const { state, error, onToggle, name } = props;
  const { t } = useTranslation();
  const errorId = useId();
  const listening = state === 'listening';
  const label = listening
    ? t('companion.talk.stop', { defaultValue: 'Stop and send' })
    : state === 'transcribing'
      ? t('companion.talk.transcribing', { defaultValue: 'Transcribing · press to talk again' })
      : t('companion.talk.start', { defaultValue: 'Talk to {{name}}', name });

  if (props.size === 'large') {
    return <LargeTalkButton state={state} error={error} onToggle={onToggle} label={label} bindingLabel={props.bindingLabel} compact={props.compact} />;
  }
  if (props.size === 'round') {
    return <RoundTalkButton state={state} error={error} onToggle={onToggle} label={label} compact={props.compact} />;
  }

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
