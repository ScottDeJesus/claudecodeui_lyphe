import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

type SettingsCardProps = {
  children: ReactNode;
  className?: string;
  divided?: boolean;
};

/**
 * Groups related settings rows in one card; `divided` draws a hairline between rows.
 *
 * Used by the settings module's appearance, browser-use, git, tasks and agents tabs and its ntfy card, and by the
 * companion module's Settings section, which the voice tab composes but the companion module owns — the second
 * module is what admits it here.
 */
export function SettingsCard({ children, className, divided }: SettingsCardProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-card',
        divided && 'divide-y divide-border',
        className,
      )}
    >
      {children}
    </div>
  );
}
