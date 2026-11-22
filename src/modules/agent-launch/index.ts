import { lazy } from 'react';

// The agent-launch module's public surface: the panel the settings module opens in its Edit Agent Chains
// window (Settings → Agents), and the one slot of a launch row (its model or its effort), which the rnd
// module's settings sheet draws the scout's and the spike's rows with. The panel is lazy, the way the API,
// Heal, Memory and Runner panels are: it is the window's whole tree and loads on its first open, so importing
// this barrel never pulls it into the first page load. The slot is a caption and a list, and is imported whole.
export const AgentLaunchPanel = lazy(() =>
  import('@/modules/agent-launch/AgentLaunchPanel').then((m) => ({ default: m.AgentLaunchPanel })),
);
export { AgentLaunchChoice } from '@/modules/agent-launch/AgentLaunchChoice';
