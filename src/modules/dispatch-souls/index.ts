// The launcher-souls lane's public surface: the feed App mounts (the only thing here that names
// the `soul_launch_state` frame) and the hook a screen reads the lane with. The PIN that draws one
// of these souls is the chat's own (`src/modules/chat/transcript/SoulLaunchPinRow.tsx`), because
// the strip it lands in is the chat's and the lane must not reach back into it.
export { SoulLaunchFeed } from '@/modules/dispatch-souls/SoulLaunchFeed';
export { useSoulLaunches } from '@/modules/dispatch-souls/hooks/useSoulLaunches';
