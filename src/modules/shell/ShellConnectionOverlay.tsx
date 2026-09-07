import { Button, Spinner } from '@/shared/ui';

type ShellConnectionOverlayProps = {
  mode: 'loading' | 'connect' | 'connecting';
  description: string;
  loadingLabel: string;
  connectLabel: string;
  connectTitle: string;
  connectingLabel: string;
  onConnect: () => void;
};

/** Rendered by Shell on top of the terminal to show connect/loading state until the shell session is live. */
export default function ShellConnectionOverlay({
  mode,
  description,
  loadingLabel,
  connectLabel,
  connectTitle,
  connectingLabel,
  onConnect,
}: ShellConnectionOverlayProps) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/85 p-6 backdrop-blur-sm">
      <div className="flex w-full max-w-md flex-col items-center gap-3.5 text-center">
        {mode === 'connect' ? (
          <Button size="lg" className="w-full max-w-xs" onClick={onConnect} title={connectTitle}>
            {connectLabel}
          </Button>
        ) : (
          <Spinner size={mode === 'loading' ? 28 : 36} label={mode === 'loading' ? loadingLabel : connectingLabel} />
        )}

        {/* The loading state has nothing true to add: the terminal is not up yet, so what it
            will run is not yet a fact about this session. */}
        {mode !== 'loading' && (
          <p className="max-w-md break-words px-2 text-sm leading-6 text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}
