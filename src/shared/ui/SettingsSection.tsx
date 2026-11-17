import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

type SettingsSectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

/**
 * Titles a block of settings: the eyebrow heading, an optional sentence under it, then the block.
 *
 * The heading is the app's caption: small capitals in the mono face, as the chat's head and the panel's are. It and
 * the sentence under it are inset by the rows' own inset (`SettingRow`), so they start on the edge the rows' words do.
 *
 * Used by the settings module's appearance, browser-use, git, tasks and voice tabs and its ntfy card, and by the
 * companion module's Settings section, which the voice tab composes but the companion module owns — the second
 * module is what admits it here.
 */
export function SettingsSection({ title, description, children, className }: SettingsSectionProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <div className="px-4">
        <h3 className="font-mono text-[10px] font-medium uppercase leading-[14px] tracking-[0.18em] text-muted-foreground">
          {title}
        </h3>
        {description && (
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}
