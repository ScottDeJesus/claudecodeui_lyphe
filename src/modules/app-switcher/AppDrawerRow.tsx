import { Columns2, ExternalLink, MoreHorizontal, PanelRightClose, RotateCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAppSwitcher } from '@/modules/app-switcher/context/AppSwitcherContext';
import { isSelfOrigin, resolveAppUrl } from '@/modules/app-switcher/utils/resolveAppUrl';
import type { AppEntry } from '@/shared/app-types';
import { ActionMenu, Card } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * A resolved url's `host:port` — the row's second line, where the application answers.
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
  /** Takes the row out of the registry. The drawer owns it, so a refusal is reported in one place. */
  onRemove: (appId: string) => void;
  /** Turns dual screen on with this app in the second half. The drawer owns it. */
  onOpenInDualScreen: (appId: string, src: string) => void;
};

/**
 * One application, as a card: a lettered tile, the name over where it answers, and a kebab holding
 * everything the body cannot say. Rendered by AppDrawer only.
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
export function AppDrawerRow({ app, onRemove, onOpenInDualScreen }: AppDrawerRowProps) {
  const { t } = useTranslation();
  const { panes, dual, selfPorts, open, reload, toggleDual, setDrawerOpen } = useAppSwitcher();

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
  const dualItem: ActionMenuItem = holdsSecondHalf
    ? { key: 'close-dual', label: t('applications.closeDual'), icon: PanelRightClose, onSelect: handleCloseDualScreen }
    : { key: 'open-in-dual', label: t('applications.openInDual'), icon: Columns2, onSelect: handleOpenInDualScreen };
  // Reload is shown on every framed row and live only while that app is up: a greyed item says
  // "nothing to reload" where a missing one would not.
  const items: ActionMenuItem[] = isSelf
    ? [newTabItem, removeItem]
    : [
        { key: 'reload', label: t('applications.reload'), icon: RotateCw, disabled: !onScreen, onSelect: handleReload },
        newTabItem,
        dualItem,
        removeItem,
      ];

  return (
    <li>
      <Card className="flex min-h-[58px] items-center gap-1 pr-2 transition-colors duration-200 hover:border-input">
        <button
          type="button"
          aria-pressed={isSelf ? undefined : onScreen}
          onClick={handleSelect}
          className="flex min-w-0 flex-1 items-center gap-3 self-stretch rounded-[11px] py-2.5 pl-3 text-left"
        >
          {/* Green while it is up: the one row a returning reader is looking for reads first. */}
          <span
            aria-hidden="true"
            data-initial={initialOf(app.name)}
            className={cn(
              'grid h-9 w-9 flex-none place-items-center rounded-[9px] border font-serif text-[19px] leading-none before:content-[attr(data-initial)]',
              onScreen ? 'border-primary/30 bg-primary/10 text-accent-ink' : 'border-border bg-secondary text-muted-foreground',
            )}
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[14.5px] font-medium leading-[1.65] text-foreground">{app.name}</span>
              {isSelf && <ExternalLink className="h-3 w-3 flex-none text-ink-faint" aria-hidden="true" />}
            </span>
            <span className="truncate text-xs leading-[1.65] text-ink-faint">
              {onScreen ? t('applications.hostOnScreen', { host }) : host}
            </span>
          </span>
        </button>

        {/* Portalled: the list scrolls inside an overflow-hidden ScrollArea, which would clip an
            in-place menu at the sheet's edge. Named by the app alone, and the trigger announces
            itself as a menu. */}
        <ActionMenu
          label={app.name}
          items={items}
          icon={MoreHorizontal}
          iconOnly
          portal
          variant="ghost"
          size="icon"
          triggerClassName="h-10 w-10 rounded-[9px] text-ink-faint hover:text-foreground"
        />
      </Card>
    </li>
  );
}
