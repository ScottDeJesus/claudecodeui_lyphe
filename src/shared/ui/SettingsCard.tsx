import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

type SettingsCardProps = {
  children: ReactNode;
  className?: string;
  divided?: boolean;
};

/**
 * Groups related settings rows; `divided` draws a hairline between rows.
 *
 * NOT A BOX. The group stands on the ground it is on, between a hairline above and a hairline below: no fill, no
 * corners, no edge down its sides. A settings page is a list read down, and a box round every group is a frame round
 * nothing. Its rows keep their own inset, so a group and the caption over it (`SettingsSection`) start on one edge.
 *
 * Used by the settings module's appearance, browser-use, git, tasks and agents tabs and its ntfy card, and by the
 * companion module's Settings section, which the voice tab composes but the companion module owns — the second
 * module is what admits it here.
 */
export function SettingsCard({ children, className, divided }: SettingsCardProps) {
  return (
    <div
      className={cn(
        'overflow-hidden border-y border-border',
        divided && 'divide-y divide-border',
        className,
      )}
    >
      {children}
    </div>
  );
}
