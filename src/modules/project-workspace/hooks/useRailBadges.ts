import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCerberusNeeds } from '@/modules/cerberus';
import { useChatHost } from '@/modules/chat-host';
import { useInboxWaiting } from '@/modules/inbox';
import type { AppTab, RailBadge } from '@/shared/types';

/**
 * Read by this module's WorkspaceRail: the badge each view wears on the rail, keyed by view id. A view with nothing
 * waiting has no entry, so a zero is never drawn.
 *
 * Badges are the rail's alone — the views list (`useWorkspaceViews`) carries no count, so the palette and the phone
 * header do not re-render when one moves. What each badge counts is what its own view already says:
 *   - Cerberus: the checks that need a person (the figure its headline prints);
 *   - Inbox: everything waiting on the operator, the sum of the Inbox's three sections;
 *   - Chat: a reply landed while the chat was out of sight. A reply is not a number of anything, so the badge is
 *     the figure 1 — the rail carries no bare dot, and a collapsed rail still says a reply is there.
 *
 * `words` is the sentence a screen reader hears after the view's name, since the drawn figure is hidden from it.
 */
export function useRailBadges(): Partial<Record<AppTab, RailBadge>> {
  const { t } = useTranslation('common');
  const cerberusNeeds = useCerberusNeeds();
  const { total: inboxWaiting } = useInboxWaiting();
  const { unread: chatUnread } = useChatHost();

  // `t` changes identity with the language, so it stands in for "the language" in the deps.
  return useMemo(() => {
    const badges: Partial<Record<AppTab, RailBadge>> = {};
    if (chatUnread) badges.chat = { count: 1, words: t('rail.badge.chat') };
    if (cerberusNeeds > 0) badges.cerberus = { count: cerberusNeeds, words: t('rail.badge.cerberus', { count: cerberusNeeds }) };
    if (inboxWaiting > 0) badges.inbox = { count: inboxWaiting, words: t('rail.badge.inbox', { count: inboxWaiting }) };
    return badges;
  }, [chatUnread, cerberusNeeds, inboxWaiting, t]);
}
