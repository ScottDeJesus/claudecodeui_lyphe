import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

type SettingsRowProps = {
  label: string;
  /** A small mark drawn before the label, for a row that belongs to a named vendor. */
  icon?: ReactNode;
  description?: string;
  children: ReactNode;
  className?: string;
};

/** Used by the settings module's appearance, browser-use and tasks tabs to lay out one labelled setting and its control. */
export default function SettingsRow({ label, icon, description, children, className }: SettingsRowProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-4 py-4', className)}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          {icon}
          {label}
        </div>
        {description && (
          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</div>
        )}
      </div>
      {/* Top-aligned, not centred: a two-line helper used to drag the control down with it. */}
      <div className="flex-shrink-0 pt-0.5">{children}</div>
    </div>
  );
}
