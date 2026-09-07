import { useTranslation } from 'react-i18next';

import { Badge } from '@/shared/ui';
import { TOOL_OUTCOME_GLYPH, TOOL_OUTCOME_TONE, type ToolOutcome } from '@/modules/chat/tools/toolOutcome';

/**
 * The words a tool row says about what happened to it, in plain English.
 * Used by chat's ToolRenderer, ToolGroupContainer, OneLineDisplay and
 * BashCommandDisplay.
 */
export function ToolOutcomeBadge({ outcome }: { outcome: ToolOutcome }) {
  const { t } = useTranslation('chat');
  // No glyph in the words: ToolOutcomeGlyph draws the mark beside them, and
  // carrying it in both places printed "▲ ▲ Waiting for you".
  const label = {
    automatic: t('tools.doneAutomatically', { defaultValue: 'Done automatically' }),
    waiting: t('tools.waitingForYou', { defaultValue: 'Waiting for you' }),
    approved: t('tools.allowedByYou', { defaultValue: 'Allowed by you' }),
    finished: t('tools.finished', { defaultValue: 'Finished' }),
  }[outcome];

  return <Badge tone={TOOL_OUTCOME_TONE[outcome]}>{label}</Badge>;
}

/**
 * The outcome's mark, sized for a card header. Used beside the row's title by
 * the same four callers, so the state reads with the colour drained out.
 */
export function ToolOutcomeGlyph({ outcome }: { outcome: ToolOutcome }) {
  return (
    <span aria-hidden="true" className="flex-shrink-0 text-[11px] text-muted-foreground">
      {TOOL_OUTCOME_GLYPH[outcome]}
    </span>
  );
}
