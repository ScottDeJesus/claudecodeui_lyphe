import { Badge, Button, Switch } from '@/shared/ui';
import type { Tone } from '@/shared/types';

type ShellHeaderProps = {
  connectionTone: Tone;
  connectionLabel: string;
  /** What the app actually knows about this session, already assembled. Empty when it knows nothing. */
  meta: string;
  shortcutsLabel: string;
  shortcutsShown: boolean;
  onToggleShortcuts: () => void;
  showDisconnect: boolean;
  onDisconnect: () => void;
  onRestart: () => void;
  disconnectLabel: string;
  disconnectTitle: string;
  restartLabel: string;
  restartTitle: string;
  disableRestart: boolean;
  showBypassToggle: boolean;
  bypassEnabled: boolean;
  onToggleBypass: () => void;
  bypassLabel: string;
  bypassTitle: string;
};

/** Rendered by Shell above the terminal to say whether the session is live and to carry the actions that change it. */
export default function ShellHeader({
  connectionTone,
  connectionLabel,
  meta,
  shortcutsLabel,
  shortcutsShown,
  onToggleShortcuts,
  showDisconnect,
  onDisconnect,
  onRestart,
  disconnectLabel,
  disconnectTitle,
  restartLabel,
  restartTitle,
  disableRestart,
  showBypassToggle,
  bypassEnabled,
  onToggleBypass,
  bypassLabel,
  bypassTitle,
}: ShellHeaderProps) {
  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
      <Badge tone={connectionTone}>{connectionLabel}</Badge>

      {meta && <span className="min-w-0 flex-1 truncate text-[13.5px] text-muted-foreground">{meta}</span>}

      {/* Wrapping is not decoration: this row carries three buttons and a switch, and at a
          phone width the group runs past the right edge with no scroll to reach what is off
          it. Breaking to a second line is what keeps the last action reachable by a finger. */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {showBypassToggle && (
          <span className="mr-1 flex items-center gap-2" title={bypassTitle}>
            <span className="text-xs text-muted-foreground">{bypassLabel}</span>
            <Switch checked={bypassEnabled} onChange={() => onToggleBypass()} label={bypassLabel} />
          </span>
        )}

        {/* Desktop only: below `md` the shortcut keys are already on screen, so a button that
            reveals them would be offering something the reader can see. */}
        <Button
          variant="outline"
          size="sm"
          className="hidden md:inline-flex"
          aria-pressed={shortcutsShown}
          onClick={onToggleShortcuts}
        >
          {shortcutsLabel}
        </Button>

        <Button variant="outline" size="sm" onClick={onRestart} disabled={disableRestart} title={restartTitle}>
          {restartLabel}
        </Button>

        {showDisconnect && (
          <Button variant="outline" size="sm" onClick={onDisconnect} title={disconnectTitle}>
            {disconnectLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
