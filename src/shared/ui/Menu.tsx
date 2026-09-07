import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/shared/utils';

type MenuItem = {
  id: string;
  label: string;
  description?: string;
  /** Marks the row as the current choice — filled and ticked, so it survives greyscale. */
  selected?: boolean;
};

type MenuProps = {
  trigger: ReactNode;
  items: MenuItem[];
  onSelect: (id: string) => void;
  /** Panel width in px. The panel is what `align` places, so it is what a width sizes. */
  width?: number;
  align?: 'left' | 'right';
};

/**
 * A choice list hung under whatever the caller hands in as its trigger.
 *
 * Used by the sidebar module (Phase 5) for its project filter and by the settings module
 * (Phase 4) for the picker rows that are not plain Selects — a Select owns ONE value and
 * shows it in its own trigger; a Menu decorates a trigger the caller already drew.
 *
 * Dismissal is two-way for the same reason Select's is: a pointer outside closes it, and
 * Escape closes it without moving the pointer, handing focus back to the trigger rather than
 * dropping it on <body> when the panel unmounts underneath it. There is deliberately NO focus
 * trap and no arrow-key roving — every item is a tab stop, and no site asks for more.
 */
export function Menu({ trigger, items, onSelect, width, align = 'left' }: MenuProps) {
  // Whether the panel is showing. Not derivable: `selected` is the choice already made, and
  // the panel is open precisely while the reader is reconsidering it.
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const choose = (id: string) => {
    onSelect(id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="vv-menu inline-block" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="vv-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        {trigger}
      </button>

      {open && (
        <ul
          className={cn('vv-menu__panel', `vv-menu__panel--${align}`)}
          role="menu"
          // `minWidth` travels with `width`, or the prop does nothing below 200px: feedback.css
          // gives the panel a 200px floor for the callers that pass no width, and a floor beats
          // an inline width. A prop ignored across a third of its range is worse than no prop
          // at all (doctrine §8).
          style={width ? { width, minWidth: width } : undefined}
        >
          {items.map((item) => (
            <li
              key={item.id}
              className="vv-menu__item flex items-start justify-between gap-3"
              role="menuitem"
              // `aria-current`, not `aria-selected`: the rows are menu items, and a menuitem
              // that reports selection has to be a menuitemradio — which would announce every
              // other row as an unchecked radio even in a menu that is a list of actions.
              aria-current={item.selected ? 'true' : undefined}
              tabIndex={0}
              onClick={() => choose(item.id)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                choose(item.id);
              }}
            >
              <span className="min-w-0">
                <span className="block">{item.label}</span>
                {item.description && <span className="vv-menu__description block">{item.description}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
