import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import { Shimmer, SignalLoop } from '@/shared/ui';
import type { SessionActivity } from '@/shared/types';

type ActivityIndicatorProps = {
  activity: SessionActivity | null;
};

const ACTION_KEYS = [
  'claudeStatus.actions.thinking',
  'claudeStatus.actions.processing',
  'claudeStatus.actions.analyzing',
  'claudeStatus.actions.working',
  'claudeStatus.actions.computing',
  'claudeStatus.actions.reasoning',
];
const DEFAULT_ACTION_WORDS = ['Thinking', 'Processing', 'Analyzing', 'Working', 'Computing', 'Reasoning'];
const EXIT_ANIMATION_MS = 220;

/**
 * Minimal response-in-progress indicator, in the spirit of the inline status
 * lines in Claude Code / Codex / OpenCode: the agent's thinking loop (Astrolabe's
 * `SignalLoop`), a shimmering activity word in the instrument's mono, and the
 * elapsed time. Rendered only while the viewed session has an entry in the
 * processing map; it disappears the instant that entry is removed.
 *
 * IT CARRIES NO STOP OF ITS OWN. The line's button under it is the Stop while a
 * turn runs (`ChatComposer`'s submit), and Escape stops a turn too; a second
 * Stop floating over that one said the same thing twice.
 *
 * Rendered by chat's ChatComposer above the input so the user can see the
 * in-flight turn without leaving the composer.
 */
export default function ActivityIndicator({ activity }: ActivityIndicatorProps) {
  const { t } = useTranslation('chat');
  // Both timers below pace what the reader sees (the leave animation, the seconds clock), so they run
  // on the window the reader is in: a hidden opener throttles its timers hard.
  const hostWindow = useHostWindow();
  const [renderedActivity, setRenderedActivity] = useState<SessionActivity | null>(activity);
  const [isExiting, setIsExiting] = useState(false);
  const startedAt = renderedActivity?.startedAt ?? null;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (activity) {
      setRenderedActivity(activity);
      setIsExiting(false);
      return;
    }

    if (!renderedActivity) return;

    setIsExiting(true);
    const timer = hostWindow.setTimeout(() => {
      setRenderedActivity(null);
      setIsExiting(false);
    }, EXIT_ANIMATION_MS);

    return () => hostWindow.clearTimeout(timer);
  }, [activity, renderedActivity, hostWindow]);

  useEffect(() => {
    if (startedAt === null) return;
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = hostWindow.setInterval(update, 1000);
    return () => hostWindow.clearInterval(timer);
  }, [startedAt, hostWindow]);

  if (!renderedActivity) return null;

  const actionWords = ACTION_KEYS.map((key, i) => t(key, { defaultValue: DEFAULT_ACTION_WORDS[i] }));
  const label = (renderedActivity.statusText || actionWords[Math.floor(elapsedSeconds / 4) % actionWords.length])
    .replace(/\.+$/, '');

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const elapsedLabel = minutes < 1
    ? t('claudeStatus.elapsed.seconds', { count: seconds, defaultValue: '{{count}}s' })
    : t('claudeStatus.elapsed.minutesSeconds', { minutes, seconds, defaultValue: '{{minutes}}m {{seconds}}s' });

  // THE WORKING LINE: what the chat is doing and for how long, over the line the reader types in. A line on the page's ground, not a
  // tab: the loop, the word, the time.
  return (
    <div
      data-chat-activity=""
      className={`pointer-events-none bg-transparent pb-1.5 ${
        isExiting ? 'chat-activity-exit' : 'chat-activity-enter'
      }`}
    >
      <div className="inline-flex h-8 items-center gap-2 bg-background pr-2 text-xs">
        {/* The agent's loop: dashes that turn while the turn is worked on, the same sign the companion's face makes when thinking. */}
        <SignalLoop state="thinking" size={13} />
        <Shimmer className="font-mono text-[11px] uppercase tracking-[0.14em]">{`${label}…`}</Shimmer>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{elapsedLabel}</span>
      </div>
    </div>
  );
}
