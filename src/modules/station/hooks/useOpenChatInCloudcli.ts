import { useStationDoors } from '@/shared/context/StationLayerContext';

/**
 * "Open the chat": a press that takes a chat to CloudCLI, where its Next steps widget and its own permission prompt stand. The station
 * leaves the screen and the workspace shows the chat, in this tab (`openChatInWorkspace`: the same act as her own order to open it). Used by the chat's stage, the
 * ask's stage and the follow-ups' stage, once each, for the chat the focus names.
 */
export function useOpenChatInCloudcli(): (sessionId: string) => void {
  return useStationDoors().openChatInWorkspace;
}
