import { Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import { Button, Shimmer, SignalLoop } from '@/shared/ui';
import type { SessionActivity } from '@/shared/types';

type ActivityIndicatorProps = {
  activity: SessionActivity | null;
  onAbort?: () => void;
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
 * `SignalLoop`), a shimmering activity word in the instrument's mono, the
 * elapsed time, and an interrupt affordance. Rendered only while the viewed
 * session has an entry in the processing map; it disappears the instant that
 * entry is removed.
 *
 * Rendered by chat's ChatComposer above the input so the user can see and
 * interrupt the in-flight turn without leaving the composer.
 */
export default function ActivityIndicator({ activity, onAbort }: ActivityIndicatorProps) {
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

  // THE WORKING LINE: what the chat is doing and for how long, over the line the reader types in, and the one press that stops it. A line
  // on the page's ground, not a tab: the loop, the word, the time. Stop is a button that looks like one (the kit's), its mark alone; Escape
  // stops a turn too and is named in the button's title, never drawn as a key cap.
  const stopLabel = t('claudeStatus.stop', { defaultValue: 'Stop' });
  return (
    <div
      data-chat-activity=""
      className={`pointer-events-none bg-transparent pb-1.5 ${
        isExiting ? 'chat-activity-exit' : 'chat-activity-enter'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex h-8 items-center gap-2 bg-background pr-2 text-xs">
          {/* The agent's loop: dashes that turn while the turn is worked on, the same sign Kaylee's face makes when she thinks. */}
          <SignalLoop state="thinking" size={13} />
          <Shimmer className="font-mono text-[11px] uppercase tracking-[0.14em]">{`${label}…`}</Shimmer>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{elapsedLabel}</span>
        </div>

        {renderedActivity.canInterrupt && onAbort && (
          <Button
            variant="outline"
            size="icon"
            onClick={onAbort}
            className="pointer-events-auto size-8 bg-background finger:size-11"
            aria-label={stopLabel}
            title={`${stopLabel} (Esc)`}
          >
            <Square aria-hidden="true" className="fill-current" />
          </Button>
        )}
      </div>
    </div>
  );
}
