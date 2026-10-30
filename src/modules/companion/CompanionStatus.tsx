import { Trans, useTranslation } from 'react-i18next';

import { FILES_NAMED, baseName } from '@/modules/companion/utils/presenceWords';
import type { CompanionPresence, Tone } from '@/shared/types';
import { cn } from '@/shared/utils';

type CompanionStatusProps = {
  /**
   * What she is doing on this page, from `useCompanionPresence` (the only reader of her process, her activity, the page's
   * press and its player): the line reads it alone, for its words, the chat and the files they name, and the walk's place.
   */
  presence: CompanionPresence;
  /** `panel`, the default, is the panel's small line under her name; `station` is the same words larger, under her face on the station. */
  emphasis?: 'panel' | 'station';
};

/**
 * The status line: the key of its words and their numbers, the part of them that may give way (`subject`, the chat's name
 * or the files', drawn in the words' `<subject/>` slot), the tone of its dot, whether the dot breathes, and the English
 * words (`fallback`) for a key a locale may not carry yet.
 */
type Status = { key: string; values?: Record<string, number>; subject?: string; tone: Tone; moving: boolean; fallback?: string };

/** What each emphasis changes: the line's type, and where the dot stands so it sits on the first line's middle (half of the leading, less half the dot). */
const EMPHASIS = {
  panel: { line: 'text-xs leading-5 text-muted-foreground', dot: 'mt-1.5' },
  station: { line: 'text-base leading-6 text-foreground', dot: 'mt-2' },
} as const;

/**
 * Her state as one line, read from the presence alone: the one state the button's face and label read too, so the two never
 * differ. THE PAGE'S STATES SPEAK FIRST, then her process, then her activity. While his talk press is out the line is
 * Listening (green, breathing: the mic is open, so it wins even over a picture still loading or a process asleep or
 * failed) or Transcribing (blue, breathing, like her own work); while this page's player sounds her voice it is Speaking
 * (blue, breathing). A press that cuts her off mid-sentence reads Cut for a breath (900 ms; grey and still, her voice just
 * stopped) before Listening takes the line: the talk button below is lit the whole time, so the open mic is never unshown.
 * Her own state comes back the moment the page has none.
 *
 * Under those, her process speaks — loading, failed, asleep and waking say nothing about a turn — and an awake process is
 * its activity as the presence carries it: Idle, Thinking, Reading <chat>, Reading code, Drafting for <chat>, Walking
 * <chat> · item k of n. The dot's tone is the line's colour word: grey asleep, green idle (ready), blue while she works,
 * amber failed (errors are amber, never red). The words carry the state on their own, so the dot is never the whole signal.
 * A failed process says "Stopped": she fails after starting too (her process ending mid-conversation, a turn breaking), and
 * the line claims no cause — the Banner under the header carries the server's sentence.
 */
function statusOf(presence: CompanionPresence): Status {
  if (presence.state === 'cut') return { key: 'companion.status.cut', fallback: 'Cut', tone: 'neutral', moving: false };
  if (presence.state === 'listening') return { key: 'companion.status.listening', fallback: 'Listening', tone: 'positive', moving: true };
  if (presence.state === 'transcribing') return { key: 'companion.status.transcribing', fallback: 'Transcribing', tone: 'info', moving: true };
  if (presence.state === 'speaking') return { key: 'companion.status.speaking', fallback: 'Speaking', tone: 'info', moving: true };
  if (presence.state === 'loading') return { key: 'companion.panel.loadingStatus', tone: 'neutral', moving: true };
  if (presence.state === 'failed') return { key: 'companion.status.failed', tone: 'warn', moving: false };
  if (presence.state === 'asleep') return { key: 'companion.status.asleep', tone: 'neutral', moving: false };
  if (presence.state === 'waking') return { key: 'companion.status.waking', tone: 'info', moving: true };
  const working = { tone: 'info', moving: true } as const;
  const chat = presence.session?.name;
  switch (presence.state) {
    case 'idle':
      return { key: 'companion.status.idle', tone: 'positive', moving: false };
    case 'thinking':
      return { key: 'companion.status.thinking', ...working };
    case 'reading_session':
      return chat ? { key: 'companion.status.readingSession', subject: chat, ...working } : { key: 'companion.status.readingAChat', ...working };
    case 'reading_code': {
      const files = presence.files ?? [];
      if (files.length === 0) return { key: 'companion.status.readingCode', ...working };
      if (files.length <= FILES_NAMED) return { key: 'companion.status.readingFiles', subject: files.map(baseName).join(', '), ...working };
      return { key: 'companion.status.readingManyFiles', values: { count: files.length }, ...working };
    }
    case 'drafting':
      return chat ? { key: 'companion.status.draftingFor', subject: chat, ...working } : { key: 'companion.status.draftingNew', ...working };
    case 'walking':
      return chat && presence.walk
        ? { key: 'companion.status.walking', subject: chat, values: { at: presence.walk.at, total: presence.walk.total }, ...working }
        : { key: 'companion.status.walkingPlain', ...working };
  }
}

/**
 * Her one state in words with its dot, `role="status"`, so a change is announced. Consumed by this module's `CompanionHeader`
 * (its title row, at the panel's emphasis) and by the station module (under her face, at the station's), so the panel and
 * the station read one table of words in one order from one presence (MAN-9089).
 *
 * The words always carry the state; the dot's tone only adds to them (MAN-578). With no subject to give way ("Stopped · your
 * next message starts her again") the words wrap to a second line rather than lose their end, which is the next step. With
 * one, the verb and "· item 2 of 5" keep their width (`whitespace-pre`) and only the chat's name, carried as the slot's own
 * child so a name holding "<" reads as written, truncates between them: the place in the walk is what he needs, the name
 * is on the focus row too. The name starts from nothing and grows into the room the runs leave (never past its own width,
 * so the place follows it); only when even a nameless line does not fit — a 320px phone beside Stop — does the place wrap
 * to a second line, whole.
 */
export function CompanionStatus({ presence, emphasis = 'panel' }: CompanionStatusProps) {
  const { t } = useTranslation();
  const status = statusOf(presence);
  const look = EMPHASIS[emphasis];

  return (
    <p role="status" data-tone={status.tone} data-companion-status="" className={cn('flex min-w-0 items-start gap-1.5', look.line)}>
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full bg-tone-dot', look.dot, status.moving && 'motion-safe:animate-pulse')} />
      {status.subject === undefined ? (
        <span className="line-clamp-2 min-w-0 break-words">{t(status.key, { ...status.values, defaultValue: status.fallback })}</span>
      ) : (
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
  );
}
