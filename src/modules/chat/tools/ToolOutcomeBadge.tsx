import { useTranslation } from 'react-i18next';

import { Badge } from '@/shared/ui';
import { TOOL_OUTCOME_TONE, type ToolOutcome } from '@/modules/chat/tools/toolOutcome';

/**
 * The words a tool row says about what happened to it, in plain English, when
 * that is not ordinary: waiting on the reader, or allowed by the reader. A call
 * that simply finished draws nothing. The words carry the state on their own,
 * so the row draws no mark beside them.
 * Used by chat's ToolRenderer, ToolGroupContainer, OneLineDisplay and
 * BashCommandDisplay, always as the row's rightmost item.
 */
export function ToolOutcomeBadge({ outcome }: { outcome: ToolOutcome }) {
  const { t } = useTranslation('chat');
  // A row says how it came out only when that is not ordinary: a call that ran and came back says nothing.
  if (outcome === 'finished') return null;
  const label = {
    waiting: t('tools.waitingForYou', { defaultValue: 'Waiting for you' }),
    approved: t('tools.allowedByYou', { defaultValue: 'Allowed by you' }),
    finished: t('tools.finished', { defaultValue: 'Finished' }),
  }[outcome];

  return <Badge tone={TOOL_OUTCOME_TONE[outcome]} className="vv-badge--compact">{label}</Badge>;
}
