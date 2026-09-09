import { CLOUDCLI_WORDMARK_FONT_FAMILY } from '@/shared/constants';

const loadingDotAnimationDelays = ['0s', '0.15s', '0.3s'];

/**
 * Rendered by the auth module's ProtectedRoute while the initial auth status check is in flight.
 *
 * `reconnecting` is the second face of the same screen: the check retries a server on its way
 * back up until its shared 25s budget is spent, and a spinner that says nothing for that long
 * reads as a hang.
 */
export default function AuthLoadingScreen({ reconnecting = false }: { reconnecting?: boolean }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <div className="relative text-center" role="status" aria-live="polite">
        <div className="mb-5 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/25 ring-1 ring-inset ring-white/20">
            <img src="/logo.svg" alt="CloudCLI" className="h-9 w-9" />
          </div>
        </div>

        <h1
          className="mb-4 text-2xl font-bold tracking-tight text-foreground"
          style={{ fontFamily: CLOUDCLI_WORDMARK_FONT_FAMILY }}
        >
          CloudCLI
        </h1>
        {/* One line, not two: the visible message IS the announcement once there is one, and
          * rendering both had a reader hear "Reconnecting to the server" twice. */}
        {reconnecting ? (
          <p className="mb-3 text-sm text-muted-foreground">Reconnecting to the server…</p>
        ) : (
          <p className="sr-only">Loading authentication state…</p>
        )}
        <div aria-hidden className="flex items-center justify-center gap-2">
          {loadingDotAnimationDelays.map((delay) => (
            <div
              key={delay}
              className="h-2 w-2 animate-bounce rounded-full bg-primary"
              style={{ animationDelay: delay }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
