import { useTranslation } from 'react-i18next';

/**
 * The transcript's "still working" mark while "Show work" hides the tool calls: three
 * dots that hop in turn, darkening at the top of the hop and settling with a small
 * overshoot. Rebuilt in CSS from the LottieFiles "Chat typing indicator" keyframes
 * (a 1.83s loop, a 178ms stagger, a grey ramp) so it follows the theme and needs no
 * animation runtime.
 *
 * Rendered by ChatMessagesPane at the foot of the turn while the session is processing.
 */
export default function TypingIndicator() {
  const { t } = useTranslation('chat');

  return (
    <div
      className="chat-typing-indicator"
      role="status"
      aria-label={t('claudeStatus.actions.working', { defaultValue: 'Working' })}
    >
      <span className="chat-typing-dot" />
      <span className="chat-typing-dot" />
      <span className="chat-typing-dot" />
    </div>
  );
}
