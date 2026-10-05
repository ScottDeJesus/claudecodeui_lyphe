import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useWorkedSeconds } from '@/modules/dispatcher/hooks/useWorkedSeconds';
import { DISPATCHER_ALL_TOPIC, useLiveTopic } from '@/modules/live-bus';
import { humanizeDuration } from '@/shared/spend';
import { Badge } from '@/shared/ui';
import type { DispatcherLanePicture } from '@/shared/types';

/**
 * How long agents have worked on a feature or an epic, as one more pill beside its token pills: a clock
 * glyph and the figure (`3h 42m`, `humanizeDuration`). The figure is the dispatcher's `runtime_s` — the
 * UNION of the intervals agents were out, so two tasks walking at once count once and a pause counts not
 * at all — and it TICKS each second only while `running` (`planAgentOut`, `arcAgentOut`: an agent is out
 * on it), counting from the moment this browser received the reading (`received_at`); otherwise it stands
 * still. It is drawn once anything has been worked OR an agent is out now: a feature's very first agent
 * reads 0 at the dispatcher's read when it launched under a second before it, and the lane sends no frame
 * for the figure alone, so a pill gated on the figure would stay unmounted for the whole first outing.
 *
 * It reads the receipt stamp itself, off the same retained topic every card reads, so the card that draws
 * it passes only what it knows: its figure, whether an agent is out on it, and what it is the time of —
 * the title says which, because a feature's figure and an epic's are not the same kind of count. The
 * stamp is the BROWSER's clock, not the server's frame `at`, so a browser whose clock is off by minutes
 * still paints the server's figure; a picture with none (no feed published it) falls back to `at`.
 *
 * Every element is phrasing content, and the pill is `tone="neutral"` like the spend pills beside it: a
 * duration is a fact, not a verdict. The mark is the clock; the word rides a visually hidden node, so a
 * screen reader reads `3h 42m working` once and not the figure's every second.
 *
 * Used by `PlanCard` (a feature's) and `DispatchArcDeck` (an epic's), as the last pill of the head's books.
 */
export function WorkingPill({ seconds, running, subject }: { seconds: number; running: boolean; subject: 'feature' | 'epic' }) {
  const { t } = useTranslation();
  const frame = useLiveTopic<DispatcherLanePicture>(DISPATCHER_ALL_TOPIC);
  const worked = useWorkedSeconds(seconds, running, frame?.payload?.received_at ?? frame?.at ?? null);
  if (worked <= 0 && !running) return null;
  const figure = humanizeDuration(worked);
  return (
    <Badge as="span" tone="neutral" className="min-w-0 gap-1" title={t(`dispatcher.pill.workingTitle.${subject}`)} data-working-pill={subject}>
      <Clock className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
      <span className="tabular-nums" aria-hidden="true">{figure}</span>
      <span className="sr-only">{t('dispatcher.pill.working', { time: figure })}</span>
    </Badge>
  );
}
