import { Suspense } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';

import { ThemeProvider } from '@/shared/context/ThemeContext';
import { ToastProvider } from '@/shared/context/ToastContext';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import { ToastStack } from '@/shared/ui';
import { AuthProvider, ProtectedRoute } from '@/modules/auth';
import { TaskMasterProvider,TasksSettingsProvider } from '@/modules/task-master';
import { MemoryIntakeProvider } from '@/modules/memory-intake';
import { NotesProvider } from '@/modules/notes';
import { HealProvider } from '@/modules/heal';
import { CerberusProvider } from '@/modules/cerberus';
import { LiveBusProvider } from '@/modules/live-bus';
import { DispatcherFeed } from '@/modules/dispatcher';
import { SoulLaunchFeed } from '@/modules/dispatch-souls';
import { RoadmapFeed } from '@/modules/roadmap';
import { UniverseFeed } from '@/modules/universe';
import { SessionHostLivenessProvider } from '@/shared/context/SessionHostLivenessContext';
import { WebSocketProvider } from '@/shared/context/WebSocketContext';
import { PluginsProvider } from '@/modules/plugins';
import { ProjectWorkspaceRoute } from '@/modules/project-workspace';
import { StationRoute } from '@/modules/station';
import { i18n } from '@/modules/i18n';
import { routerBasename } from '@/shared/cloudcliDoors';

/** Rendered by main.tsx; mounts the shared providers, the auth gate and the project workspace routes. */
export default function App() {
  const basename = routerBasename();

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        {/* Inside ThemeProvider so a toast is painted in the theme the app is actually in, and
            outside everything else so any screen can raise one. ToastStack is its LAST child:
            the stack is a fixed overlay that must sit above the routes, not inside them. */}
        <ToastProvider>
        <UiPreferencesProvider>
        <AuthProvider>
          <WebSocketProvider>
            {/* Directly under the socket and above the auth gate: the server sends which chats have a live
                session host ONCE, as the socket connects, so the provider that keeps it must have
                subscribed before the connection exists. */}
            <SessionHostLivenessProvider>
            <PluginsProvider>
              <TasksSettingsProvider>
                <TaskMasterProvider>
                <ProtectedRoute>
                  {/* The feed sits INSIDE the bus because it publishes into it, and both sit inside the
                      auth gate so the REST seed never fires against the login screen — and below
                      WebSocketProvider above, because the feed subscribes to the one socket. */}
                  <LiveBusProvider>
                    {/* The dispatcher's lane: the plan cards' whole picture, kept by a feed in its
                        own module. */}
                    <DispatcherFeed>
                    {/* Nested rather than chained because a feed is a wrapper, not a sibling: each
                        one subscribes to the one socket and renders what it wraps, so the innermost
                        thing here is still the router. One feed per lane, in the lane's own module. */}
                    <SoulLaunchFeed>
                    {/* The estate's lane: a digest of its activity, and the map fetch the fresh
                        check needs. Its canvas reads the socket itself, inside the tab. */}
                    <UniverseFeed>
                    {/* The roadmap's lane: the picture the Roadmap tab draws one roadmap of, kept by a
                        feed in its own module. */}
                    <RoadmapFeed>
                    {/* Inside the auth gate, so the memory poll never fires against the login screen. */}
                    <MemoryIntakeProvider>
                      {/* The notes: the account's cards, read once for every home that draws them.
                          Inside the auth gate like its neighbours, so the read never fires against
                          the login screen, and below WebSocketProvider, whose one socket carries
                          the `notes_changed` frame that re-reads it. */}
                      <NotesProvider>
                      {/* Above the Router, so every route under it reads ONE 60-second poll of the
                          reflex's summary — the Inbox's waiting count included, which weighs
                          the ledger's live count for the rail's Inbox badge. */}
                      <HealProvider>
                      {/* The fleet's health: ONE read of Cerberus's overview for every reader — the
                          tab's views and the rail's Cerberus badge — above the Router so the badge is
                          honest on every view. Inside the auth gate like its neighbours, so the read
                          never fires against the login screen, and below WebSocketProvider, whose one
                          socket carries the `cerberus_changed` hint that re-reads it. */}
                      <CerberusProvider>
                      <Router basename={basename}>
                        <Routes>
                          <Route path="/" element={<ProjectWorkspaceRoute />} />
                          <Route path="/session/:sessionId" element={<ProjectWorkspaceRoute />} />
                          {/* Kaylee Station stands beside the workspace, inside every provider above and outside its shell.
                              The route loads on its first visit (`lazyStationRoute`); until then a quiet page that is
                              already dark, so a station opened at midday does not flash light. */}
                          <Route path="/station" element={<Suspense fallback={<div className="dark fixed inset-0 bg-background" />}><StationRoute /></Suspense>} />
                        </Routes>
                      </Router>
                      </CerberusProvider>
                      </HealProvider>
                      </NotesProvider>
                    </MemoryIntakeProvider>
                    </RoadmapFeed>
                    </UniverseFeed>
                    </SoulLaunchFeed>
                    </DispatcherFeed>
                  </LiveBusProvider>
                </ProtectedRoute>
                </TaskMasterProvider>
              </TasksSettingsProvider>
            </PluginsProvider>
            </SessionHostLivenessProvider>
          </WebSocketProvider>
        </AuthProvider>
        </UiPreferencesProvider>
        <ToastStack />
        </ToastProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
