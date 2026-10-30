import type { TFunction } from 'i18next';

import type { CompanionPresence } from '@/shared/types';

/** At most this many file names ride the words of "reading code"; more are counted instead. */
export const FILES_NAMED = 2;

/** A path's last segment: the words name which file, never where it lives. */
export const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/**
 * Her name, then what she is doing, in words ("Kaylee, reading Bugfixes"): the accessible name of her face and the label of
 * her button, which are one sentence so a reader of either hears the other. Used by this module's CompanionAvatar (the
 * face's `aria-label`) and CompanionFab (the button's label and tooltip).
 *
 * One word for each of the fourteen presence states, her process included: the button never says "ready" for a Kaylee who
 * is stopped, asleep, waking or still loading. The subject is the chat or the files the presence carries; a presence that
 * names none says "a chat" or "code" instead. Every word is a `t()` with its English default, since only English carries them yet.
 */
export function presenceWords(t: TFunction, name: string, presence: CompanionPresence): string {
  const chat = presence.session?.name;
  const files = presence.files ?? [];
  const words = (key: string, english: string, extra?: Record<string, unknown>) =>
    t(`companion.avatar.${key}`, { name, defaultValue: english, ...extra });
  switch (presence.state) {
    case 'idle':
      return words('idle', '{{name}}, ready');
    case 'listening':
      return words('listening', '{{name}}, listening');
    case 'transcribing':
      return words('transcribing', '{{name}}, transcribing');
    case 'thinking':
      return words('thinking', '{{name}}, thinking');
    case 'speaking':
      return words('speaking', '{{name}}, speaking');
    case 'reading_session':
      return chat ? words('readingSession', '{{name}}, reading {{chat}}', { chat }) : words('readingAChat', '{{name}}, reading a chat');
    case 'reading_code':
      if (files.length === 0) return words('readingCode', '{{name}}, reading code');
      if (files.length <= FILES_NAMED) return words('readingFiles', '{{name}}, reading {{files}}', { files: files.map(baseName).join(', ') });
      return words('readingManyFiles', '{{name}}, reading {{count}} files', { count: files.length });
    case 'drafting':
      return chat ? words('draftingFor', '{{name}}, drafting for {{chat}}', { chat }) : words('draftingNew', '{{name}}, drafting a new chat');
    case 'walking':
      return chat && presence.walk
        ? words('walking', '{{name}}, walking {{chat}}, item {{at}} of {{total}}', { chat, at: presence.walk.at, total: presence.walk.total })
        : words('walkingPlain', '{{name}}, walking a result');
    case 'cut':
      return words('cut', '{{name}}, stopped talking');
    case 'loading':
      return words('loading', '{{name}}, loading');
    case 'failed':
      return words('failed', '{{name}}, stopped');
    case 'asleep':
      return words('asleep', '{{name}}, asleep');
    case 'waking':
      return words('waking', '{{name}}, waking up');
  }
}
