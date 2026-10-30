import { useNavigate } from 'react-router-dom';

import { useStation } from '@/modules/station/context/StationContext';
import { openInCloudcli } from '@/shared/cloudcliDoors';
import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';

/**
 * "Open the chat": a press that takes a chat to CloudCLI, where its Next steps widget and its own permission prompt stand. The
 * window named `cloudcli` on a desktop, this same window on a phone or in the home-screen app (`openInCloudcli`'s rule, with the
 * station's own reading of a phone). Used by the ask's stage and the follow-ups' stage, once each, for the chat the focus names.
 */
export function useOpenChatInCloudcli(): (sessionId: string) => void {
  const navigate = useNavigate();
  const { phone } = useStation();
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  return (sessionId) => openInCloudcli(`/session/${encodeURIComponent(sessionId)}`, navigate, { phone, pwa: isPWA });
}
