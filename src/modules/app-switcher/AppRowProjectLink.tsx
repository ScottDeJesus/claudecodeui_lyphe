import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { AppEntry } from '@/shared/app-types';
import type { ProjectChoice } from '@/shared/types';
import { Button, Select } from '@/shared/ui';
import { OWNS_ESCAPE, OWNS_ESCAPE_SELECTOR } from '@/shared/ui/overlayEscape';

// Tailwind reads a `_` inside an arbitrary variant as a space, so the placeholder class's own double
// underscore is escaped (`\_`) to reach `.vv-select__placeholder` rather than a descendant element named
// `placeholder`; `String.raw` keeps the backslashes in the string, where a plain literal would drop them.
const WARN_PLACEHOLDER_CLASS = String.raw`[&_.vv-select\_\_placeholder]:text-warn-ink`;

type AppRowProjectPickerProps = {
  /** The application's name: the picker's heading line, and the Select's accessible name. */
  appName: string;
  /** The path the row is linked to now, or `''` for none. A path no choice carries is shown as it is. */
  value: string;
  /** Every project the sidebar knows, in the order the picker lists them. The drawer supplies them. */
  choices: ProjectChoice[];
  /** The server's own sentence for a refused save, or null. Printed under the control until the next try. */
  error: string | null;
  /** A project was picked: its `fullPath`, or `''` for "No project". The drawer saves it. */
  onChoose: (fullPath: string) => void;
  /** The reader backed out: Escape while the picker is up, or its ✕. The drawer puts the row's second line back. */
  onCancel: () => void;
};

/**
 * The in-place state that stands in the row's second line while a project is being linked:
 * the application's name over a Select, with a refusal under it, and a ✕ at the row's trailing edge.
 * Rendered by AppDrawerRow only.
 *
 * IT IS THE DESCRIPTION FIELD'S SHAPE, minus the tile. The row keeps its own tile and card and
 * hands this the columns beside it (`AppDrawerRow`'s description field is the same three things:
 * tile, name, then the control), so the row does not move when it goes into or out of either state.
 *
 * THE CONTROL IS THE KIT'S `Select`: "No project" first, then every project by its name, in the order
 * the drawer hands them, because the sidebar already taught the reader that order. The trigger takes
 * focus as the picker appears, as the description field's input does; Enter or Space opens the list.
 * A path no project carries stands in the trigger in the warn tone behind the ▲, as the line does.
 * The open list is brought into view as it appears: it is drawn `position: absolute` under the
 * trigger and the drawer's scroller does not follow it, so on a long list of rows it opened below
 * the fold with nothing to show for the tap.
 *
 * LEAVING IS TWO WAYS, and neither needs the keyboard's focus to be anywhere in particular. The ✕
 * is the way out a touch reader can see: it is the 32px slot the kebab holds on a resting row, so
 * the row does not shift. Escape is heard on the DOCUMENT while the picker is mounted, not on the
 * picker's own element: the picker carries `OWNS_ESCAPE` for the reason the description field does
 * (`shared/ui/overlayEscape`) — without the marker the drawer's Dialog closes the whole sheet from its
 * `window` capture listener — and a marker that is up while focus has gone elsewhere would leave the
 * sheet deaf to Escape and the picker deaf with it. Two levels, as a reader expects: with the list
 * open, or a kebab menu drawn in front, that panel holds the key and the picker stands down; with
 * nothing in front, Escape leaves.
 */
export function AppRowProjectPicker({ appName, value, choices, error, onChoose, onCancel }: AppRowProjectPickerProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLSpanElement>(null);
  // The registry is a file edited by hand: a whitespace-only project is no link, and reads as none.
  const current = value.trim() === '' ? '' : value;
  // An empty list is a list not yet read (the sidebar's projects load after the page does), and a path
  // is not called unmatched against a list that has not arrived: see `AppRowProjectLine`.
  const unmatched = current !== '' && choices.length > 0 && !choices.some((choice) => choice.fullPath === current);

  // The Select does not take a focus prop, so the picker finds its trigger once, on mount, and
  // focuses it: the reader chose "Link project…" to type a keystroke next, not to look for a control.
  useEffect(() => {
    rootRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')?.focus();
  }, []);

  // The Select draws its list as a new child of its own root, and offers no hook for it. Watching
  // for that child is how the picker brings the list into the drawer's scroller. `nearest` moves
  // nothing when the list is already fully in view, and the margin leaves room under its last option.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (node.nodeType !== 1 || !(node as Element).classList.contains('vv-select__panel')) continue;
          const panel = node as HTMLElement;
          panel.style.scrollMarginBottom = '12px';
          panel.scrollIntoView({ block: 'nearest' });
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Escape on the document's capture phase, so it is heard wherever focus is and before any
  // bubbling listener can re-render the list away. `onCancel` is a dependency because the handler
  // calls it.
  useEffect(() => {
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape' || event.repeat) return;
      // Something else states it owns the key and is in front: the open list, a kebab menu. It closes
      // itself and the picker stays; the picker's own marker is not "something else".
      if (document.querySelector(`${OWNS_ESCAPE_SELECTOR}:not([data-app-row-picker])`)) return;
      event.preventDefault();
      onCancel();
    }
    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [onCancel]);

  const options = [
    { value: '', label: t('applications.noProject') },
    ...choices.map((choice) => ({ value: choice.fullPath, label: choice.displayName })),
  ];

  function handleChoose(fullPath: string) {
    onChoose(fullPath);
  }

  return (
    <>
      <span
        ref={rootRef}
        // The picker states that it owns Escape while it is open (`shared/ui/overlayEscape`).
        {...OWNS_ESCAPE}
        // Marks the picker's root, so its own marker is not read as "something else is in front" below.
        data-app-row-picker=""
        className="flex min-w-0 flex-1 flex-col gap-1"
      >
        <span className="truncate text-[14.5px] font-medium leading-tight text-foreground">{appName}</span>
        {/* The Select paints its placeholder in ink-faint, the grey of "nothing chosen". A path no
            project carries is a broken link, not an empty field, so it takes the warn tone here. */}
        <div className={unmatched ? WARN_PLACEHOLDER_CLASS : undefined}>
          <Select
            size="sm"
            options={options}
            value={current}
            onChange={handleChoose}
            // A path no project carries matches no option, and the trigger would say "Choose…" over it.
            // It says the path instead: that is what is linked, and the reader is here to change it.
            placeholder={unmatched ? `▲ ${current}` : current}
            ariaLabel={t('applications.projectLabel', { name: appName })}
          />
        </div>
        {error && (
          <span role="alert" className="break-words text-xs text-warn-ink">
            <span aria-hidden="true">▲ </span>
            {error}
          </span>
        )}
      </span>
      {/* The kebab's own slot, size and radius: what a resting row keeps at its trailing edge. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t('applications.form.cancel')}
        onClick={onCancel}
        className="h-8 w-8 flex-none rounded-[9px] text-ink-faint hover:text-foreground"
      >
        <X aria-hidden="true" />
      </Button>
    </>
  );
}

type AppRowProjectLineProps = {
  app: AppEntry;
  /** Every project the sidebar knows. A linked path is matched to one by `fullPath`. */
  choices: ProjectChoice[];
  /** What the line says with no project behind it: the description, or the host, with "· on screen" while the app is up. */
  fallback: string;
};

/**
 * The row's second line, with the linked project on it. Rendered by AppDrawerRow only.
 *
 * THE PROJECT COMES AFTER WHAT THE LINE ALREADY SAID — `archpulse.local:8005 · ArchPulse` — one line,
 * so the row keeps its measured 47px. The description or host is what shrinks and ellipsises first;
 * the project's name is a step brighter than it (`text-muted-foreground` over `text-ink-faint`) and
 * holds its width up to 55% of the line, because it is the fact the reader set and the one the
 * Link project… item edits.
 *
 * A ROW WITH NO PROJECT IS THE OLD LINE, node for node: one truncating span, nothing added. A project
 * that is only whitespace is none.
 *
 * A PATH IS ONLY CALLED UNMATCHED AGAINST A LIST THAT HAS ARRIVED. The provider's `projects` is empty until
 * the sidebar has loaded its own, so an empty list is "not known yet", not "no project has this path":
 * the line shows the path in the neutral tone, with no ▲ and no claim, until the list is there.
 *
 * A PATH THAT MATCHES NO PROJECT SHOWS ITSELF, in the refusal's warn tone (`text-warn-ink`) behind
 * the ▲ the drawer's other warnings use, so the state is never colour alone; a screen reader hears
 * "No project at this path" before it. The registry is a file the operator edits by hand and a
 * project can be renamed or removed under a row, and a line that hid a dead link would be the
 * quiet failure this one is written to prevent. An ellipsised path loses its head, not its tail,
 * and the full path is the tooltip.
 */
export function AppRowProjectLine({ app, choices, fallback }: AppRowProjectLineProps) {
  const { t } = useTranslation();

  // A whitespace-only project is no project: the registry is edited by hand, and a warn line with an
  // empty path would say a link is broken that was never made.
  if (!app.project?.trim()) {
    return <span className="truncate text-xs leading-tight text-ink-faint">{fallback}</span>;
  }

  const linked = choices.find((choice) => choice.fullPath === app.project);
  const listRead = choices.length > 0;

  return (
    <span className="flex min-w-0 items-baseline text-xs leading-tight text-ink-faint">
      <span className="min-w-0 truncate">{fallback}</span>
      <span className="flex-none px-1.5">·</span>
      {linked ? (
        <span className="max-w-[55%] flex-none truncate text-muted-foreground">{linked.displayName}</span>
      ) : (
        <span
          title={app.project}
          className={`flex min-w-0 max-w-[65%] flex-none items-baseline ${listRead ? 'text-warn-ink' : 'text-muted-foreground'}`}
        >
          {listRead && <span aria-hidden="true" className="flex-none pr-1">▲</span>}
          {listRead && <span className="sr-only">{t('applications.projectUnknown')}: </span>}
          {/* An ellipsised path keeps its TAIL: the repository's own name is the part that says which
              project was meant. `rtl` puts the ellipsis on the left, and `bdi` keeps the path's own
              order, so the leading slash stays leading. */}
          <span dir="rtl" className="min-w-0 truncate text-left">
            <bdi>{app.project}</bdi>
          </span>
        </span>
      )}
    </span>
  );
}
