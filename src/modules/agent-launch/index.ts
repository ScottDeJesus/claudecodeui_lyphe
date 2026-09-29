import { lazy } from 'react';

// The agent-launch module's public surface: the panel the Agents tab renders, and nothing else. Lazy,
// the way the API, Heal, Memory and Runner panels are: the panel is its tab's whole tree and loads on
// the tab's first open, so importing this barrel never pulls it into the first page load.
export const AgentLaunchPanel = lazy(() =>
  import('@/modules/agent-launch/AgentLaunchPanel').then((m) => ({ default: m.AgentLaunchPanel })),
);
