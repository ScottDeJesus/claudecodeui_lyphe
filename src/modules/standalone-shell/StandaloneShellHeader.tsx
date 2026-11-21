import { ArrowLeft } from 'lucide-react';

import { HEAD_PRESS } from '@/shared/constants';
import { Badge, Button } from '@/shared/ui';

type StandaloneShellHeaderProps = {
  title: string;
  isCompleted: boolean;
  onClose?: (() => void) | null;
};

/** Rendered by StandaloneShell's non-minimal layout to show the shell title, completion state and close button. */
export default function StandaloneShellHeader({
  title,
  isCompleted,
  onClose = null,
}: StandaloneShellHeaderProps) {
  return (
    <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
      {/* The way out first, as on every page's head: the back arrow at the start, never a cross at the end. */}
      {onClose && (
        <Button variant="outline" size="icon" className={HEAD_PRESS} onClick={onClose} aria-label={"Close"} title={"Close"}>
          <ArrowLeft aria-hidden="true" />
        </Button>
      )}
      <h3 className="min-w-0 truncate text-sm font-medium text-foreground">{title}</h3>
      {isCompleted && <Badge tone="positive">✓ Finished</Badge>}
    </div>
  );
}
