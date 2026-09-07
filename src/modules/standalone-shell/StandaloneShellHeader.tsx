import { X } from 'lucide-react';

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
      <h3 className="min-w-0 truncate text-sm font-medium text-foreground">{title}</h3>
      {isCompleted && <Badge tone="positive">✓ Finished</Badge>}

      {onClose && (
        <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      )}
    </div>
  );
}
