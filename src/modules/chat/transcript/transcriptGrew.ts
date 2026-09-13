/**
 * The event a transcript block dispatches when it grew after it was drawn — a picture whose bytes
 * arrived after the row painted.
 *
 * It bubbles to the chat's scroll container, where `useChatSessionState` re-pins the view to the
 * bottom when the reader was there. Nothing else would: the open-session settle loop has stopped by
 * the time a late picture lands, and the stick-to-bottom effect re-runs on a new MESSAGE, not on a
 * row that grew — so a screenshot at the end of the last reply would sit under the fold.
 *
 * A plain DOM event, not a context: the block that grows is deep inside rendered markdown that also
 * renders in exports and fixtures with no chat around it, where the event simply has no listener.
 */
export const TRANSCRIPT_GREW_EVENT = 'cloudcli:transcript-grew';
