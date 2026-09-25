import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { moveItems } from '@/modules/app-switcher/utils/moveItems';
import { ActionMenu, Input } from '@/shared/ui';
import { OWNS_ESCAPE } from '@/shared/ui/overlayEscape';

type AppDrawerDividerProps = {
  title: string;
  /** Open straight into the title field — a divider the reader has just added. */
  startEditing: boolean;
  position: { first: boolean; last: boolean };
  onRename: (title: string) => Promise<void>;
  onMove: (direction: 'up' | 'down') => void;
  onRemove: () => void;
};

/**
 * A divider in the drawer's list: a hairline across it, with its title in the house's small-caps
 * label style, or a plain line when the title is blank. Rendered by AppDrawer only.
 *
 * The title is edited IN PLACE: pressing it (or "Rename" in the kebab) turns it into a field —
 * Enter or leaving it saves, Escape puts it back. The kebab also moves the divider and removes it,
 * and is NOT drawn while the field is open, the way a row's kebab is not drawn while its
 * description is being edited: the menu hands focus back to its own trigger as it closes, which is
 * the field it just opened (see the comment at the kebab below).
 */
export function AppDrawerDivider({ title, startEditing, position, onRename, onMove, onRemove }: AppDrawerDividerProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(startEditing ? title : null);
  const [saveError, setSaveError] = useState<string | null>(null);

  function handleEdit() {
    setSaveError(null);
    setDraft(title);
  }

  async function save() {
    if (draft === null) return;
    const next = draft.trim();
    if (next === title) {
      setDraft(null);
      return;
    }
    try {
      await onRename(next);
      setDraft(null);
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void save();
    } else if (event.key === 'Escape') {
      // The field's own Escape: it must not also close the sheet around it.
      event.preventDefault();
      event.stopPropagation();
      setDraft(null);
    }
  }

  const items = [
    { key: 'rename', label: t('applications.renameDivider'), icon: Pencil, onSelect: handleEdit },
    ...moveItems(t, position, onMove),
    { key: 'remove', label: t('applications.removeDivider'), icon: Trash2, isDanger: true, showDividerBefore: true, onSelect: onRemove },
  ];

  return (
    <li className="flex min-h-[36px] items-center gap-2 pl-1 pt-1.5" data-app-divider>
      {draft !== null ? (
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <Input
            // The field states that it owns Escape while it is open — it renders only then, so the
            // marker cannot lie (`shared/ui/overlayEscape`). Without it the drawer's Dialog stands
            // the field down and takes the press itself: its listener sits on `window` CAPTURE and
            // stops the event there, so the handler below never sees an Escape to put the title back.
            {...OWNS_ESCAPE}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKey}
            onBlur={() => void save()}
            placeholder={t('applications.dividerPlaceholder')}
            aria-label={t('applications.dividerTitle')}
            maxLength={64}
            autoFocus
            className="h-8 text-xs"
          />
          {saveError && <span className="break-words text-xs text-warn-ink">▲ {saveError}</span>}
        </span>
      ) : (
        <>
          {title && (
            <button
              type="button"
              onClick={handleEdit}
              className="min-w-0 truncate text-xs uppercase tracking-[0.14em] text-ink-faint hover:text-foreground"
            >
              {title}
            </button>
          )}
          <span aria-hidden="true" className="h-px min-w-6 flex-1 bg-border" />
          {/* Drawn only with the field closed, as in a row. "Rename" here opens that field in the same
              commit the menu closes in, `ActionMenu` hands focus back to its own trigger as it goes,
              and the trigger is still on the page — so the field blurred and closed itself ~1ms after
              it appeared, leaving a blank divider no route to a title at all. Unmounting the kebab
              with the field takes the trigger with it. */}
          <ActionMenu
            label={title || t('applications.dividerTitle')}
            items={items}
            icon={MoreHorizontal}
            iconOnly
            variant="ghost"
            size="icon"
            triggerClassName="h-8 w-8 rounded-[9px] text-ink-faint hover:text-foreground"
          />
        </>
      )}
    </li>
  );
}
