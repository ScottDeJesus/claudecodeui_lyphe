import type { TFunction } from 'i18next';

import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { SIMPLE_CHAT_ICONS, SimpleChatIconGlyph } from '@/modules/sidebar/SidebarSessionIcon';

// File-local: read only by SidebarSimpleList, which owns the iconTarget state and the pick
// handler this dialog is bound to.
type SidebarSimpleIconPickerProps = {
  open: boolean;
  currentIcon: string | null;
  onPick: (icon: string | null) => void;
  onCancel: () => void;
  t: TFunction;
};

/** The icon grid SidebarSimpleList opens from a row's "Change icon" menu item: Default first, then every SIMPLE_CHAT_ICONS entry. */
export default function SidebarSimpleIconPicker({ open, currentIcon, onPick, onCancel, t }: SidebarSimpleIconPickerProps) {
  // A stored name the map does not know renders the default glyph, so Default is what reads as pressed.
  const current = currentIcon !== null && Object.prototype.hasOwnProperty.call(SIMPLE_CHAT_ICONS, currentIcon)
    ? currentIcon
    : null;
  const options = [
    { key: 'default', icon: null, label: t('simpleList.iconDefault') },
    ...Object.keys(SIMPLE_CHAT_ICONS).map((name) => ({
      key: name,
      icon: name,
      label: t('simpleList.iconOption', { name: name.replace(/-/g, ' ') }),
    })),
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent
        data-testid="simple-chat-icon-dialog"
        className="w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-border bg-popover p-5 shadow-2xl"
      >
        <DialogTitle>{t('simpleList.iconTitle')}</DialogTitle>
        <p className="text-sm font-medium text-foreground">{t('simpleList.iconTitle')}</p>
        <div className="mt-3 grid grid-cols-6 justify-items-center gap-2">
          {options.map((option) => {
            const isCurrent = option.icon === current;
            return (
              <Button
                key={option.key}
                data-testid="simple-chat-icon-option"
                data-icon={option.key}
                variant="ghost"
                size="icon"
                aria-label={option.label}
                title={option.label}
                aria-pressed={isCurrent}
                className={cn(isCurrent ? 'text-foreground ring-2 ring-primary' : 'text-muted-foreground hover:text-foreground')}
                onClick={() => onPick(option.icon)}
              >
                <SimpleChatIconGlyph icon={option.icon} className="h-5 w-5" />
              </Button>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end">
          <Button data-testid="simple-chat-icon-cancel" variant="ghost" size="sm" onClick={onCancel}>
            {t('actions.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
