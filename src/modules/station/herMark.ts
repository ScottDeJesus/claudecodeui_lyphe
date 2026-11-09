import type { TFunction } from 'i18next';

import type { CompanionActivity, CompanionPhase } from '@/shared/companion-types';
import type { StationHerMark } from '@/shared/types';

/** The phases in which the companion's activity names a chat it is looking at, each with its words; in every other phase it draws no mark. */
const HER_WORDS: Partial<Record<CompanionPhase, { key: string; english: string }>> = {
  reading_session: { key: 'station.sessions.her.reading', english: '{{name}} is reading {{chat}}' },
  drafting: { key: 'station.sessions.her.drafting', english: '{{name}} is drafting for {{chat}}' },
  walking: { key: 'station.sessions.her.walking', english: '{{name}} is walking {{chat}}' },
};

/**
 * The companion's mark, from its activity: the chat it names, the companion's initial (its name's first letter, as its disc
 * draws it) and its words, the presence's own verbs ("reading", "drafting for", "walking") with the chat named. Null when it
 * looks at no chat: an idle or thinking turn, a read of code, a draft for a chat not yet started. Read by "Where things stand"
 * (`WhereThingsStand`) and by the scene's start rim (`LiveSessions`), so the two mark the same chat with the same words.
 */
export function herMarkOf(t: TFunction, activity: CompanionActivity | null, name: string): StationHerMark | null {
  const words = activity === null ? undefined : HER_WORDS[activity.phase];
  if (activity === null || activity.session === null || words === undefined) return null;
  return {
    sessionId: activity.session.sessionId,
    initial: Array.from(name)[0]?.toUpperCase() ?? '',
    words: t(words.key, { name, chat: activity.session.name, defaultValue: words.english }),
  };
}

