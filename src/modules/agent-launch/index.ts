import { lazy } from 'react';

// The agent-launch module's public surface: the panel the settings module opens in its Edit Agent Chains
// window (Settings → Agents), and nothing else. Lazy, the way the API, Heal, Memory and Runner panels are:
// the panel is the window's whole tree and loads on its first open, so importing this barrel never pulls it
// into the first page load.
export const AgentLaunchPanel = lazy(() =>
  import('@/modules/agent-launch/AgentLaunchPanel').then((m) => ({ default: m.AgentLaunchPanel })),
);
