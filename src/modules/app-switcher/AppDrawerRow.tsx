import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Columns2, ExternalLink, MoreHorizontal, PanelRightClose, Pencil, RotateCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAppSwitcher } from '@/modules/app-switcher/context/AppSwitcherContext';
import { moveItems } from '@/modules/app-switcher/utils/moveItems';
import { describeRegistryApp } from '@/modules/app-switcher/utils/registryRequests';
import { isSelfOrigin, resolveAppUrl } from '@/modules/app-switcher/utils/resolveAppUrl';
import type { AppEntry } from '@/shared/app-types';
import { ActionMenu, Card, Input } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';
import { OWNS_ESCAPE } from '@/shared/ui/overlayEscape';
import { cn } from '@/shared/utils';

/**
 * A resolved url's `host:port` — where the application answers, the second line of a row with no description.
 *
 * An address that will not parse reads as itself. The registry is a file the operator and a builder
 * edit by hand, and a row that says `descent` is more useful to its reader than a row that says
 * nothing at all.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The tile's letter: the name's first character, whole even when it is an emoji or a surrogate pair. */
function initialOf(name: string): string {
  const [first] = Array.from(name.trim());
  return (first ?? '?').toUpperCase();
}

type AppDrawerRowProps = {
  app: AppEntry;
  /** Where the row sits in the list, which greys the Move up / Move down at its end. */
  position: { first: boolean; last: boolean };
  /** Moves the row one place. The drawer owns it, beside the dividers. */
  onMove: (direction: 'up' | 'down') => void;
  /** Takes the row out of the registry. The drawer owns it, so a refusal is reported in one place. */
  onRemove: (appId: string) => void;
  /** Turns dual screen on with this app in the second half. The drawer owns it. */
  onOpenInDualScreen: (appId: string, src: string) => void;
};

/**
 * One application, as a card: its tile, the name over its description, and a kebab holding
 * everything the body cannot say. Rendered by AppDrawer only.
 *
 * THE TILE is the app's own tab icon when the server found one (`apps.icons.ts`), else its letter.
 * THE SECOND LINE is the operator's description, or where the app answers when it has none. "Edit
 * description" in the kebab turns that line into a field in place: Enter or leaving the field saves,
 * Escape puts it back, and a blank one clears it.
 *
 * THE BODY IS ONE BUTTON — tile, name and host — and a toggle: an app already on screen reads
 * "· on screen" and comes down when it is pressed again, so `aria-pressed` carries the same fact the
 * host line prints and the tile's accent wash repeats. A self row's body opens a new tab instead, and
 * says so with the external-link glyph before it is pressed; it has no pane, so no Reload and no dual
 * screen in its menu.
 *
 * THE TILE'S LETTER IS CSS CONTENT (`attr(data-initial)`), not a text node, so the button's text
 * starts with the app's name: that is what a reader's screen reader says first, and what the UI probe
 * matches a row by.
 */
export function AppDrawerRow({ app, position, onMove, onRemove, onOpenInDualScreen }: AppDrawerRowProps) {
  const { t } = useTranslation();
  const { panes, dual, selfPorts, icons, open, reload, toggleDual, setDrawerOpen, refresh } = useAppSwitcher();
  // The description field's text while it is open; null while the line is just a line.
  const [draft, setDraft] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const icon = icons[app.id];

  // THE MODULE'S ONE PLACE THAT READS THE PAGE'S OWN ADDRESS, and both readings happen here because
  // this is the open site. `{host}` is substituted where the viewer is, which is what lets one
  // registry serve loopback, LAN and Tailscale at once; and the port set is what recognises the
  // CloudCLI row as this app even when the tab was opened on the other one of the app's own two ports.
  const url = resolveAppUrl(app.url, window.location.hostname);
  const isSelf = isSelfOrigin(url, window.location.origin, selfPorts);
  const host = hostOf(url);
  const onScreen = panes.left.appId === app.id || panes.right.appId === app.id;
  // "Close dual screen" belongs to the app holding the second half, and only while there is one.
  const holdsSecondHalf = dual && panes.right.appId === app.id;

  function handleSelect() {
    // A self row is not frameable: this app inside itself is a mirror, and one that shares this page's
    // stored session. So its body opens a new tab — the same act its menu offers — instead of a pane.
    if (isSelf) handleOpenInNewTab();
    else open(app.id, url);
    // The sheet follows the choice: the reader picked what they came for, and it is drawn behind it.
    setDrawerOpen(false);
  }

  function handleReload() {
    // Found, not remembered: the panes say which half is showing this app. A row that is not up has
    // a disabled Reload and reaches no side at all.
    if (panes.left.appId === app.id) reload('left');
    else if (panes.right.appId === app.id) reload('right');
  }

  function handleOpenInNewTab() {
    window.open(url, '_blank', 'noopener');
  }

  function handleOpenInDualScreen() {
    onOpenInDualScreen(app.id, url);
  }

  // Turning dual screen off takes the second half down; the sheet stays, as the design's does.
  function handleCloseDualScreen() {
    toggleDual(false);
  }

  function handleRemove() {
    onRemove(app.id);
  }

  function handleEditDescription() {
    setSaveError(null);
    setDraft(app.description ?? '');
  }

  // Saved only when it changed; the row keeps the field open with the refusal under it on a failure.
  async function saveDescription() {
    if (draft === null) return;
    const next = draft.trim();
    if (next === (app.description ?? '')) {
      setDraft(null);
      return;
    }
    try {
      await describeRegistryApp(app.id, next);
      await refresh();
      setDraft(null);
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  function handleDescriptionKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveDescription();
    } else if (event.key === 'Escape') {
      // The field's own Escape: it must not also close the sheet around it.
      event.preventDefault();
      event.stopPropagation();
      setDraft(null);
    }
  }

  const newTabItem: ActionMenuItem = {
    key: 'open-in-new-tab',
    label: t('applications.openInNewTab'),
    icon: ExternalLink,
    onSelect: handleOpenInNewTab,
  };
  // Red and set apart by a rule: the one item that changes the registry rather than the screen.
  const removeItem: ActionMenuItem = {
    key: 'remove',
    label: t('applications.remove'),
    icon: Trash2,
    isDanger: true,
    showDividerBefore: true,
    onSelect: handleRemove,
  };
  const describeItem: ActionMenuItem = {
    key: 'edit-description',
    label: t('applications.editDescription'),
    icon: Pencil,
    onSelect: handleEditDescription,
  };
  const dualItem: ActionMenuItem = holdsSecondHalf
    ? { key: 'close-dual', label: t('applications.closeDual'), icon: PanelRightClose, onSelect: handleCloseDualScreen }
    : { key: 'open-in-dual', label: t('applications.openInDual'), icon: Columns2, onSelect: handleOpenInDualScreen };
  // Reload is shown on every framed row and live only while that app is up: a greyed item says
  // "nothing to reload" where a missing one would not.
  const items: ActionMenuItem[] = isSelf
    ? [newTabItem, describeItem, ...moveItems(t, position, onMove), removeItem]
    : [
        { key: 'reload', label: t('applications.reload'), icon: RotateCw, disabled: !onScreen, onSelect: handleReload },
        newTabItem,
        dualItem,
        describeItem,
        ...moveItems(t, position, onMove),
        removeItem,
      ];
  const secondLine = app.description || host;

  const tile = (
    // Green while it is up: the one row a returning reader is looking for reads first.
    <span
      aria-hidden="true"
      data-initial={icon ? undefined : initialOf(app.name)}
      className={cn(
        'grid h-7 w-7 flex-none place-items-center overflow-hidden rounded-[7px] border font-serif text-[15px] leading-none',
        !icon && 'before:content-[attr(data-initial)]',
        onScreen ? 'border-primary/30 bg-primary/10 text-accent-ink' : 'border-border bg-secondary text-muted-foreground',
      )}
    >
      {icon && <img src={icon} alt="" className="h-5 w-5 object-contain" />}
    </span>
  );

  if (draft !== null) {
    return (
      <li>
        <Card className="flex min-h-[44px] items-center gap-3 py-1.5 pl-3 pr-2">
          {tile}
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-[14.5px] font-medium leading-tight text-foreground">{app.name}</span>
            <Input
              // The field states that it owns Escape while it is open (`shared/ui/overlayEscape`).
              // Without the marker the drawer's Dialog stands the field down and closes the sheet
              // before this input's own handler below is reached — `Dialog.tsx` listens on `window`
              // in the capture phase, which no `stopPropagation` on the event's way down can stop.
              {...OWNS_ESCAPE}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleDescriptionKey}
              onBlur={() => void saveDescription()}
              placeholder={host}
              aria-label={t('applications.descriptionLabel', { name: app.name })}
              maxLength={160}
              autoFocus
              className="h-8 text-xs"
            />
            {saveError && <span className="break-words text-xs text-warn-ink">▲ {saveError}</span>}
          </span>
        </Card>
      </li>
    );
  }

  return (
    <li>
      <Card className="flex min-h-[44px] items-center gap-1 pr-2 transition-colors duration-200 hover:border-input">
        <button
          type="button"
          aria-pressed={isSelf ? undefined : onScreen}
          onClick={handleSelect}
          className="flex min-w-0 flex-1 items-center gap-3 self-stretch rounded-[11px] py-1.5 pl-3 text-left"
        >
          {tile}
          <span className="flex min-w-0 flex-col gap-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[14.5px] font-medium leading-tight text-foreground">{app.name}</span>
              {isSelf && <ExternalLink className="h-3 w-3 flex-none text-ink-faint" aria-hidden="true" />}
            </span>
            <span className="truncate text-xs leading-tight text-ink-faint">
              {onScreen ? t('applications.hostOnScreen', { host: secondLine }) : secondLine}
            </span>
          </span>
        </button>

        {/* Named by the app alone, and the trigger announces itself as a menu. */}
        <ActionMenu
          label={app.name}
          items={items}
          icon={MoreHorizontal}
          iconOnly
          variant="ghost"
          size="icon"
          triggerClassName="h-8 w-8 rounded-[9px] text-ink-faint hover:text-foreground"
        />
      </Card>
    </li>
  );
}
