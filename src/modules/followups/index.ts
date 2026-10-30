// The followups module's whole public surface, read by src/modules/chat-gutters (ChatGutterLayout) and by
// src/modules/station (FollowupsStage, a chat's follow-ups on the station's stage): the hook that reads a chat's next
// steps and known gaps once (the gutter's badge number and the body's rows), the context that hands that reading to the
// body, and the Next steps widget's body. The row and the contexts' reader stay inside.
export { FollowupsContext } from '@/modules/followups/context/FollowupsContext';
export { useFollowups } from '@/modules/followups/hooks/useFollowups';
export { FollowupsWidgetBody } from '@/modules/followups/FollowupsWidgetBody';
