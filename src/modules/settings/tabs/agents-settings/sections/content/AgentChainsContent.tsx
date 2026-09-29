import { XIcon } from 'lucide-react';
import { Suspense, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from 'react-error-boundary';

import { AgentLaunchPanel } from '@/modules/agent-launch';
import SettingsCard from '@/modules/settings/SettingsCard';
import { Banner, Button, Dialog, DialogContent, DialogTrigger, SettingRow, Spinner } from '@/shared/ui';

/**
 * The window's own chrome for the stretch when the panel is not there — its chunk still loading, or
 * failed to load: the title, the way out, and `children` in the body.
 *
 * The close button is the point. On a phone the window is the whole screen, above Settings, with no
 * Escape and its scrim underneath, so a window with nothing to press until a lazy chunk arrives is a
 * screen the reader can leave only by reloading the page.
 */
function WindowStandIn({ titleId, onClose, children }: { titleId: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation('common');
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2 id={titleId} className="text-sm font-medium">{t('agentLaunch.title')}</h2>
        {/* `autoFocus` for the same reason the panel's own close button has it: the dialog's first-focus
            pass finds nothing to focus when it opens ahead of a lazy chunk. */}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto text-muted-foreground hover:text-foreground"
          aria-label={t('buttons.close')}
          onClick={onClose}
          autoFocus
        >
          <XIcon aria-hidden="true" />
        </Button>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 py-10">{children}</div>
    </div>
  );
}

/**
 * Rendered by AgentCategoryContentSection first in the house-wide stack under Claude's "account" panel:
 * the one row that opens the launch table — the model and effort every soul, and Metis, launches at.
 *
 * A ROW AND A WINDOW, NOT A SECOND SETTINGS TAB. The table is the house's, so it sits with the other
 * house-wide switches under Claude, but it is a wide screen of its own (up to three columns of souls),
 * and squeezed into Settings' content column it would be a stack. The button opens it as a window
 * ABOVE Settings; the panel inside is the same one, unchanged, and reads the table fresh on every open
 * because the kit's `DialogContent` renders nothing while closed.
 *
 * THE WINDOW SITS AT `z-[10000]` because Settings is a hand-built backdrop at `z-[9999]`, not a kit
 * Dialog — a bare kit Dialog opens BEHIND it (`ProviderSkills` passes the same class for the same reason).
 * From `md` up it is centred with the page's margin round it and 72rem wide, which is what gives the
 * panel its three columns; below `md` it is the whole screen, notch-safe, with no centring and no
 * radius. The panel's own close button is then the only way out, so it is handed `onClose`.
 *
 * THE PANEL IS LAZY, SO THE WINDOW HAS A STAND-IN for both ways it can be absent. While its chunk loads
 * the stand-in carries a spinner; if the chunk fails the boundary carries a sentence and a reload,
 * because `React.lazy` remembers a rejected import and a second render of it would only fail again.
 * The boundary is what keeps that rejection from reaching the app-wide one, which replaces Settings
 * and everything under it.
 *
 * Escape closes THIS window only: the kit dialog takes the key in the capture phase and stops it, so
 * Settings never sees it, and focus goes back to the button because it is the dialog's trigger.
 */
export default function AgentChainsContent() {
  const { t } = useTranslation('settings');
  // Whether the window is up. Owned here, beside the button that opens it: nothing else in Settings
  // needs to know, and closing it leaves Settings exactly as it was.
  const [open, setOpen] = useState(false);
  // The panel's title names the window, so the label the reader hears is the one they see.
  const titleId = useId();
  const close = () => setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <SettingsCard>
        <SettingRow
          label={t('agents.agentChains.label', { defaultValue: 'Agent chains' })}
          description={t('agents.agentChains.description', {
            defaultValue: 'The model and effort every soul, and Metis, launches at in each lane.',
          })}
        >
          {/* `asChild` makes the button the dialog's trigger, which is what returns focus to it on close. */}
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              {t('agents.agentChains.button', { defaultValue: 'Edit Agent Chains' })}
            </Button>
          </DialogTrigger>
        </SettingRow>
      </SettingsCard>

      <DialogContent
        wrapperClassName="z-[10000]"
        // The kit's own entrance carries the centring in its keyframes, so it must not run on the
        // phone, where the centring translate is dropped: there it would slide the sheet off-screen.
        animationClassName="md:animate-dialog-content-show max-md:animate-shape-rise motion-reduce:animate-none"
        aria-labelledby={titleId}
        className="pwa-notch-safe flex flex-col overflow-hidden p-0 max-md:left-0 max-md:top-0 max-md:h-full max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none md:h-[calc(100dvh-2rem)] md:w-[calc(100vw-2rem)] md:max-w-6xl"
      >
        {/* The panel fills a DEFINITE height (`h-full` inside), so it gets a flex item that has one. */}
        <div className="min-h-0 flex-1">
          <ErrorBoundary
            onError={(error) => console.error('The Agent Chains panel failed to load', error)}
            fallbackRender={() => (
              <WindowStandIn titleId={titleId} onClose={close}>
                <div role="alert" className="w-full max-w-lg">
                  <Banner
                    tone="warn"
                    action={(
                      <Button variant="outline" size="sm" className="flex-none" onClick={() => window.location.reload()}>
                        {t('agents.agentChains.reload', { defaultValue: 'Reload the page' })}
                      </Button>
                    )}
                  >
                    <p className="font-medium">
                      {t('agents.agentChains.loadFailed', { defaultValue: 'Agent Chains could not be loaded.' })}
                    </p>
                  </Banner>
                </div>
              </WindowStandIn>
            )}
          >
            <Suspense
              fallback={(
                <WindowStandIn titleId={titleId} onClose={close}>
                  <Spinner label={t('agentLaunch.reading', { ns: 'common' })} />
                </WindowStandIn>
              )}
            >
              <AgentLaunchPanel onClose={close} titleId={titleId} />
            </Suspense>
          </ErrorBoundary>
        </div>
      </DialogContent>
    </Dialog>
  );
}
