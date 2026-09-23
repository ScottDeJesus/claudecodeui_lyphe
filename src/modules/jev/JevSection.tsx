import type { ReactNode } from 'react';

/**
 * Used by JevPanel for each of its six blocks: the heading in the house's section register (the
 * same class string HealPanel's sections wear), an optional hint after it, an optional control at
 * the far end of the heading row, and the block under it. Addressable by id, so a press elsewhere
 * on the tab can carry the reader to it.
 */
export function JevSection({ id, title, hint, aside, children }: { id: string; title: string; hint?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex min-w-0 scroll-mt-4 flex-col gap-3" data-jev-section={id}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 id={`${id}-title`} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
        {hint && <span className="text-xs text-muted-foreground">· {hint}</span>}
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}
