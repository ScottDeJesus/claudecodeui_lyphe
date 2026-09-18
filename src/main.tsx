import React from 'react'
import ReactDOM from 'react-dom/client'

import App from '@/App'
import AppErrorBoundary from '@/AppErrorBoundary'
// Before index.css, deliberately: index.css's `@tailwind base` and every Tailwind utility
// mapped onto a Verve token must resolve against tokens that are already declared.
import '@/shared/ui/verve/tokens.css'
import '@/index.css'
import 'katex/dist/katex.min.css'

// Initialize i18n
import '@/modules/i18n'

// React Scan is a render-diagnostics overlay, and an expensive one: measured on
// this app it roughly halves the dev frame rate, adds ~14 MB of heap and injects
// a few thousand DOM nodes of its own. It is worth all of that while hunting a
// render bug and worth none of it the rest of the time, so it is opt-in —
// `localStorage.setItem('react-scan', 'on')` and reload. Imported only then: a static import
// shipped its ~760 KB to every boot, on or off, and on a phone's link that is seconds.
const reactScanReady = import.meta.env.DEV && localStorage.getItem('react-scan') === 'on'
  ? import('react-scan')
    .then(({ scan }) => scan({ enabled: true }))
    // A diagnostics overlay that failed to load must not keep the app off screen.
    .catch((error) => console.warn('React Scan failed to load:', error))
  : Promise.resolve()

// Register service worker for PWA + Web Push support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err => {
    console.warn('Service worker registration failed:', err);
  });
}

// A lazy chunk that will not load means the page is older than the build now served (the :5184
// build swapped under an open tab). One reload picks up the new build. The timestamp guard keeps a
// chunk that is genuinely missing from looping, and like index.html's watchdog: no readable, writable
// sessionStorage, no automatic reload. The error is never swallowed, so if the reload loses the race
// the tab's error card still says what happened.
window.addEventListener('vite:preloadError', () => {
  try {
    const last = Number(sessionStorage.getItem('chunk-reload-at') || 0)
    if (Date.now() - last < 30_000) return
    sessionStorage.setItem('chunk-reload-at', String(Date.now()))
  } catch {
    return
  }
  window.location.reload()
})

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Unable to mount the app: #root is missing from the document')
}

// After the overlay when it is on, so it sees the first render; at once when it is off.
void reactScanReady.then(() => {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </React.StrictMode>,
  )
})
