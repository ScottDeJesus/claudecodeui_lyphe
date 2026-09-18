/**
 * i18n Configuration
 *
 * Configures i18next for internationalization support.
 * Features:
 * - English bundled; every other language loaded on first use
 * - Language detection from localStorage
 * - Fallback to English for missing translations
 * - Development mode warnings for missing keys
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// English is bundled: it is the fallback every other language leans on, and the language most
// sessions render in. Every other language loads on demand — a fresh page never fetches ten
// languages it will not show.
import enCommon from '@/modules/i18n/locales/en/common.json';
import enSettings from '@/modules/i18n/locales/en/settings.json';
import enAuth from '@/modules/i18n/locales/en/auth.json';
import enSidebar from '@/modules/i18n/locales/en/sidebar.json';
import enChat from '@/modules/i18n/locales/en/chat.json';
// oxlint-disable-next-line importx/order
import enTasks from '@/modules/i18n/locales/en/tasks.json';

// Import supported languages configuration
import { languages } from '@/modules/i18n/languages';
import {
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';

// The chosen language lives in auth.db so it follows the user between devices.
// It is read synchronously from the preference mirror because i18n has to be
// configured at module load, long before any request could resolve.
const getSavedLanguage = (): string => {
  const saved = readUserPreference<string | null>('userLanguage', null);
  // Validate that the saved language is supported
  if (saved && languages.some(lang => lang.value === saved)) {
    return saved;
  }
  return 'en';
};

const NAMESPACES = ['common', 'settings', 'auth', 'sidebar', 'chat', 'tasks'];

// Every non-English locale file, as a loader Vite splits into its own chunk.
const LOCALE_LOADERS = import.meta.glob<{ default: Record<string, unknown> }>([
  '/src/modules/i18n/locales/*/*.json',
  '!/src/modules/i18n/locales/en/*.json',
]);

/**
 * Adds a language's missing namespaces to i18next; English and unknown languages are a no-op. Each
 * namespace is its own fetch: one that fails stays on the English fallback and is retried the next
 * time the language is chosen, and the failure never escapes as an unhandled rejection.
 */
async function loadLanguage(lng: string): Promise<void> {
  if (lng === 'en') return;
  await Promise.all(NAMESPACES.map(async (ns) => {
    const load = LOCALE_LOADERS[`/src/modules/i18n/locales/${lng}/${ns}.json`];
    if (!load || i18n.hasResourceBundle(lng, ns)) return;
    try {
      const module = await load();
      i18n.addResourceBundle(lng, ns, module.default, true, true);
    } catch (error) {
      console.warn(`[i18n] ${lng}/${ns} did not load; showing English for it`, error);
    }
  }));
}

// Initialize i18next
i18n
  .use(initReactI18next) // Pass i18n instance to react-i18next
  .init({
    // English only; the rest arrive through `loadLanguage` below.
    resources: {
      en: {
        common: enCommon,
        settings: enSettings,
        auth: enAuth,
        sidebar: enSidebar,
        chat: enChat,
        tasks: enTasks,
      },
    },

    // Default language
    lng: getSavedLanguage(),

    // Fallback language when a translation is missing
    fallbackLng: 'en',

    // Enable debug mode in development (logs missing keys to console)
    debug: false,

    ns: NAMESPACES,
    defaultNS: 'common',

    // Key separator for nested keys (default: '.')
    keySeparator: '.',

    // Namespace separator (default: ':')
    nsSeparator: ':',

    // Save missing translations (disabled - requires manual review)
    saveMissing: false,

    // Interpolation settings
    interpolation: {
      escapeValue: false, // React already escapes values
    },

    // React-specific settings
    react: {
      useSuspense: true, // Use Suspense for lazy-loading
      bindI18n: 'languageChanged', // Re-render on language change
      // A language loaded after first paint re-renders what was drawn in the English fallback.
      bindI18nStore: 'added',
    },
  });

// Save language preference when it changes, and fetch that language if it is not loaded yet.
i18n.on('languageChanged', (lng: string) => {
  writeUserPreference('userLanguage', lng);
  void loadLanguage(lng);
});
void loadLanguage(i18n.language);

// A language chosen on another device arrives with the hydrated preferences,
// after i18n was already initialized with whatever the mirror held.
subscribeToUserPreferences(() => {
  const saved = readUserPreference<string | null>('userLanguage', null);
  if (saved && saved !== i18n.language && languages.some(lang => lang.value === saved)) {
    void i18n.changeLanguage(saved);
  }
});

export default i18n;
