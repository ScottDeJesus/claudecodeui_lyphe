import type { TFunction } from 'i18next';

import { LLM_PROVIDER_LABELS } from '@/shared/constants';
import type { LLMProvider } from '@/shared/types';

type SidebarSessionMetaProps = {
  provider: LLMProvider;
  messageCount: number;
  /** Already formatted ("4m", "2hr", "3d"); empty when the session carries no usable timestamp. */
  age: string;
  t: TFunction;
};

/**
 * One session row's second line — `Claude · 34 messages · 4m`.
 *
 * Used by SidebarSessionItem, which renders it in both of its branches (the compact card and
 * the desktop row). It lives here rather than inside that file because the file is already at
 * the module-size trigger and this is the third place the same three facts get spelled.
 *
 * A fact the session does not have is omitted rather than shown as zero: a conversation with no
 * messages yet and one whose count never arrived are different things, and "0 messages" claims
 * to know which.
 */
export default function SidebarSessionMeta({ provider, messageCount, age, t }: SidebarSessionMetaProps) {
  const parts = [LLM_PROVIDER_LABELS[provider] ?? provider];
  if (messageCount > 0) parts.push(t('sessions.messageCount', { count: messageCount }));
  if (age) parts.push(age);

  return (
    <div className="mt-0.5 truncate text-xs text-muted-foreground">{parts.join(' · ')}</div>
  );
}
