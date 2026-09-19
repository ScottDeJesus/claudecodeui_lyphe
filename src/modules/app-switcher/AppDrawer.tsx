import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppDrawerDivider } from '@/modules/app-switcher/AppDrawerDivider';
import { AppDrawerHeader } from '@/modules/app-switcher/AppDrawerHeader';
import { AppDrawerRow } from '@/modules/app-switcher/AppDrawerRow';
import { useAppSwitcher } from '@/modules/app-switcher/context/AppSwitcherContext';
import { useDrawerLayout } from '@/modules/app-switcher/hooks/useDrawerLayout';
import type { PaneSide, PaneSlot } from '@/modules/app-switcher/context/AppSwitcherContext';
import { NewApplicationForm } from '@/modules/app-switcher/NewApplicationForm';
import { addRegistryApp, removeRegistryApp } from '@/modules/app-switcher/utils/registryRequests';
import type { AppEntry } from '@/shared/app-types';
import { useTheme } from '@/shared/context/ThemeContext';
import {
  Banner,
  Button,
  Card,
  Dialog,
  DialogContent,
  EmptyState,
  Pill,
  PillBar,
  ScrollArea,
  Switch,
} from '@/shared/ui';

/** The half holding this app, or null — the sheet's one answer to "is this app on screen". */
function paneHolding(panes: Record<PaneSide, PaneSlot>, appId: string): PaneSide | null {
  if (panes.left.appId === appId) return 'left';
  if (panes.right.appId === appId) return 'right';
  return null;
}

type RemoveRefusal = {
  /** The server's own sentence, printed as it came. */
  message: string;
  /** The app the press had already taken off the screen, or null when nothing was up. */
  closedName: string | null;
};

/**
 * The applications drawer, opened from the FAB, on the kit.
 *
 * A SHEET DOWN THE LEFT, min(88vw, 364px) on the canvas ground: the FAB it answers docks in the left
 * rail, so the sheet opens from the side the reader's hand is already on, and the strip of backdrop
 * left showing is how a reader dismisses it without touching the panes.
 *
 * Read top to bottom it answers the reader's questions in the order they are asked: what is this and
 * how do I leave (the header), which half what I pick lands in (the Opens-in strip, while dual screen is on),
 * what can I pick (the rows, in the registry file's own order), and — pinned below the scroll — how
 * do I add one and which appearance am I in.
 *
 * Rendered by AppSwitcherFab only.
 */
export function AppDrawer() {
  const { t } = useTranslation();
  const titleId = useId();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const {
    apps, rows, registryError, registryRead, panes, dual, nextSide, drawerOpen, setDrawerOpen,
    openInDualScreen, open, refresh, chooseSide,
  } = useAppSwitcher();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const layout = useDrawerLayout();
  // Whether the New application form stands in the list's place. The drawer's own, never persisted:
  // a half-typed form is not furniture, and the sheet opens onto the list every time.
  const [formOpen, setFormOpen] = useState(false);
  // The last refused Remove, or null. Shown above the rows until dismissed or until the next Remove,
  // so a refusal is never silent and never outlives the act that caused it.
  const [removeRefusal, setRemoveRefusal] = useState<RemoveRefusal | null>(null);

  // Escape, the backdrop and the ✕: the sheet goes, the panes stay — and so does an unsent form.
  function handleOpenChange(next: boolean) {
    setDrawerOpen(next);
    if (!next) setFormOpen(false);
  }

  function handleDismiss() {
    handleOpenChange(false);
  }

  function handleChooseSide(side: PaneSide) {
    chooseSide(side);
  }

  function handleStartAdd() {
    setFormOpen(true);
  }

  // The form goes and the focus returns to the button that opened it, which is back in the footer
  // by the next frame.
  function handleCloseForm() {
    setFormOpen(false);
    requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  // Must RESOLVE once the row is in the registry and the drawer's list will show it, and REJECT with
  // an Error whose message is the server's own sentence — NewApplicationForm prints that message.
  async function handleAddApplication(draft: Pick<AppEntry, 'name' | 'url' | 'description'>): Promise<void> {
    // POST, then re-read: the row the list draws comes from the registry, never from this draft.
    await addRegistryApp(draft);
    await refresh();
  }

  async function handleSubmitNewApplication(draft: Pick<AppEntry, 'name' | 'url' | 'description'>): Promise<void> {
    await handleAddApplication(draft);
    handleCloseForm();
  }

  // Must RESOLVE once the row is gone from the registry, and REJECT with the server's own sentence.
  //
  // The pane goes first, through the context's own way off the layer: `open`, handed the id of the
  // app already up, clears that half and moves a survivor left — and the url it takes is the slot's
  // own, read back rather than resolved a second time. The half is ARGUED IN rather than looked up
  // here, because it has to be the render the press was made in: a read taken after the await could
  // find the app already down and put it back up.
  async function handleRemoveApplication(appId: string, side: PaneSide | null): Promise<void> {
    if (side !== null) open(appId, panes[side].src ?? '');
    await removeRegistryApp(appId);
    await refresh();
  }

  function handleRemove(appId: string) {
    // Read once, in this render, for both acts: the half `handleRemoveApplication` will clear, and
    // the name the refusal banner will own up to when the server refuses the removal it cleared for.
    const side = paneHolding(panes, appId);
    const closedName = side === null ? null : apps.find((app) => app.id === appId)?.name ?? null;
    setRemoveRefusal(null);
    handleRemoveApplication(appId, side).catch((failure: unknown) => {
      setRemoveRefusal({
        message: failure instanceof Error ? failure.message : String(failure),
        closedName,
      });
    });
  }

  // Turns dual screen ON and puts this app in the second half, then closes the sheet: the design's
  // "Open in dual screen". NOT composable from today's context in one handler — `open` reads `dual` and
  // `nextSide` from the render it was made in, so `toggleDual(true)` then `open(...)` fills the LEFT half.
  function handleOpenInDualScreen(appId: string, src: string) {
    openInDualScreen(appId, src);
    setDrawerOpen(false);
  }

  // The switch shows the appearance on screen; flipping it asks for the other one.
  function handleAppearanceChange(nextDark: boolean) {
    // CloudCLI's own theme, not a second store: `toggleDarkMode` is the one writer — it persists the
    // choice and takes the theme off the sun schedule, which is what flipping the switch means.
    if (nextDark !== isDarkMode) toggleDarkMode();
  }

  // `registryRead` — whether the first read has answered — comes from the context; the hook that
  // measures it says what the placeholder case is for.
  // A failed read with no list behind it is not an empty registry either: the Banner says what
  // happened and the empty state stays away, because "no applications yet" would be a claim nobody measured.
  const showEmpty = registryRead && apps.length === 0 && registryError === null;
  const appearanceLabel = isDarkMode ? t('applications.appearanceDark') : t('applications.appearanceLight');

  return (
    <Dialog open={drawerOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-labelledby={titleId}
        animationClassName="animate-sheet-in-left motion-reduce:animate-none"
        className="left-0 top-0 flex h-full w-[min(88vw,364px)] max-w-none translate-x-0 translate-y-0 flex-col rounded-none border-0 border-r border-solid border-border bg-background p-0"
      >
        <AppDrawerHeader titleId={titleId} onDismiss={handleDismiss} />

        {/* Only while dual screen is on — a row's "Open in dual screen" turns it on, its "Close dual
            screen" off. With one pane there is no side to choose. */}
        {dual && (
          <div className="shrink-0 px-[22px] pb-3.5">
            <Card className="flex items-center gap-2 px-4 py-3.5">
              <span className="flex-none text-xs uppercase tracking-[0.14em] text-ink-faint">{t('applications.opensIn')}</span>
              <PillBar role="group" aria-label={t('applications.opensIn')} className="rounded-full">
                <Pill
                  isActive={nextSide === 'left'}
                  aria-pressed={nextSide === 'left'}
                  onClick={() => handleChooseSide('left')}
                  className="min-h-[34px] rounded-full px-3.5 py-1.5 text-[12.5px]"
                >
                  {t('applications.left')}
                </Pill>
                <Pill
                  isActive={nextSide === 'right'}
                  aria-pressed={nextSide === 'right'}
                  onClick={() => handleChooseSide('right')}
                  className="min-h-[34px] rounded-full px-3.5 py-1.5 text-[12.5px]"
                >
                  {t('applications.right')}
                </Pill>
              </PillBar>
            </Card>
          </div>
        )}

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-2 px-[22px] pb-2 pt-0.5">
            {/* Warn, not danger: the last list that did read stays usable below it. */}
            {registryError !== null && (
              <Banner tone="warn">
                <p className="text-sm font-medium">{t('applications.unreadable')}</p>
                <p className="mt-0.5 break-words text-xs opacity-80">{registryError}</p>
              </Banner>
            )}
            {/* The second line is the whole point of this one: a refused removal whose press had
                already taken a pane down changed the reader's screen, and a notice that stopped at
                "could not be removed" would leave them to work out why. */}
            {removeRefusal !== null && (
              <Banner tone="warn" onClose={() => setRemoveRefusal(null)}>
                <p className="text-sm font-medium">{t('applications.removeFailed')}</p>
                <p className="mt-0.5 break-words text-xs opacity-80">{removeRefusal.message}</p>
                {removeRefusal.closedName !== null && (
                  <p className="mt-0.5 break-words text-xs opacity-80">
                    {t('applications.removeFailedPane', { name: removeRefusal.closedName })}
                  </p>
                )}
              </Banner>
            )}

            {layout.layoutError !== null && (
              <Banner tone="warn" onClose={layout.clearLayoutError}>
                <p className="break-words text-sm">{layout.layoutError}</p>
              </Banner>
            )}

            {formOpen ? (
              <NewApplicationForm onSubmit={handleSubmitNewApplication} onCancel={handleCloseForm} />
            ) : !registryRead ? (
              <div aria-busy="true" className="flex flex-col gap-2">
                <div className="vv-skeleton h-[68px] rounded-xl" />
                <div className="vv-skeleton h-[68px] rounded-xl" />
                <div className="vv-skeleton h-[68px] rounded-xl" />
              </div>
            ) : showEmpty ? (
              <div className="rounded-xl bg-card">
                <EmptyState
                  title={t('applications.empty')}
                  message={t('applications.emptyMessage')}
                  actionLabel={t('applications.emptyAction')}
                  onAction={handleStartAdd}
                />
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {/* File order, dividers among the apps. A row whose app is missing from `apps` is skipped. */}
                {rows.map((row, index) => {
                  const position = { first: index === 0, last: index === rows.length - 1 };
                  if (row.kind === 'divider') {
                    return (
                      <AppDrawerDivider
                        key={row.id}
                        title={row.title}
                        startEditing={row.id === layout.addedDividerId}
                        position={position}
                        onRename={(title) => layout.renameDivider(row.id, title)}
                        onMove={(direction) => layout.moveRow(row.id, direction)}
                        onRemove={() => layout.removeDivider(row.id)}
                      />
                    );
                  }
                  const app = apps.find((candidate) => candidate.id === row.id);
                  return app ? (
                    <AppDrawerRow
                      key={app.id}
                      app={app}
                      position={position}
                      onMove={(direction) => layout.moveRow(app.id, direction)}
                      onRemove={handleRemove}
                      onOpenInDualScreen={handleOpenInDualScreen}
                    />
                  ) : null;
                })}
              </ul>
            )}
          </div>
        </ScrollArea>

        <footer className="flex shrink-0 flex-col gap-3 border-t border-border bg-card px-[22px] pb-[calc(env(safe-area-inset-bottom)+18px)] pt-3.5">
          {!formOpen && (
            <div className="flex gap-2.5">
              <Button ref={addButtonRef} className="h-11 flex-1 text-[15px]" onClick={handleStartAdd}>
                {t('applications.addApplication')}
              </Button>
              <Button variant="outline" className="h-11 text-[15px]" onClick={layout.addDivider}>
                {t('applications.addDivider')}
              </Button>
            </div>
          )}
          {/* Named by the appearance on screen, so what is read aloud is what is written beside it. */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13.5px] text-secondary-foreground">{appearanceLabel}</span>
            <Switch checked={isDarkMode} onChange={handleAppearanceChange} label={appearanceLabel} />
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
