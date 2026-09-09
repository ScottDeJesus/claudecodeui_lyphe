import { ErrorBoundary } from 'react-error-boundary';
import type { ReactNode } from 'react';

/**
 * The last boundary before the document.
 *
 * Without one, an uncaught render error anywhere above the workspace — a provider, the auth
 * gate, a context that threw on a bad stored value — unmounts the whole tree, and React puts
 * nothing in its place: the screen goes black with no message. `WorkspaceErrorBoundary` covers
 * the routes below it; everything ABOVE it had no cover at all.
 *
 * The fallback is deliberately plain: it renders when the app has already proven it can throw,
 * so it depends on no context, no theme, no i18n and no design token — just markup and a
 * reload. The boot watchdog in index.html still stands behind it, for the crashes React never
 * gets to see.
 */
export default function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      onError={(error, info) => {
        console.error('[App] Uncaught render error:', error, info.componentStack);
      }}
      fallbackRender={({ error }) => (
        <div
          role="alert"
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: '#101116',
            color: '#e7e7ea',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <div style={{ maxWidth: '26rem', textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>CloudCLI hit an error</div>
            <div style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.7, marginBottom: 14 }}>
              The screen it was drawing could not finish. Reloading usually clears it.
            </div>
            <pre
              style={{
                margin: '0 0 16px',
                padding: '8px 10px',
                borderRadius: 8,
                background: '#1a1b22',
                color: '#9aa0aa',
                fontSize: 11.5,
                textAlign: 'left',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {error instanceof Error ? `${error.name}: ${error.message}` : String(error)}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                border: 0,
                borderRadius: 8,
                padding: '8px 16px',
                background: '#2fa876',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
