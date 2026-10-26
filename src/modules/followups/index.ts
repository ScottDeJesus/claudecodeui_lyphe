// The followups module's whole public surface, read by src/modules/chat-gutters (ChatGutterLayout): the hook that
// reads the open chat's next steps and known gaps once (the badge's number and the body's rows), the context that
// hands that reading to the body, and the Next steps widget's body. The row and the contexts' reader stay inside.
export { FollowupsContext } from '@/modules/followups/context/FollowupsContext';
export { useFollowups } from '@/modules/followups/hooks/useFollowups';
export { FollowupsWidgetBody } from '@/modules/followups/FollowupsWidgetBody';
