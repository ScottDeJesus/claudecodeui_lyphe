import { useTranslation } from 'react-i18next';

import { languages } from '@/modules/i18n/languages';
import { SettingRow } from '@/shared/ui';

/**
 * Language Selector Component
 *
 * A dropdown component for selecting the application language.
 * Automatically updates the i18n language and persists it as a user preference.
 *
 * Used by the settings module (appearance tab).
 */
export default function LanguageSelector() {
  const { i18n, t } = useTranslation('settings');

  const handleLanguageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newLanguage = event.target.value;
    i18n.changeLanguage(newLanguage);
  };

  return (
    <SettingRow label={t('account.languageLabel')} description={t('account.languageDescription')}>
      <select
        value={i18n.language}
        onChange={handleLanguageChange}
        className="w-36 rounded-lg border border-input bg-card p-2 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary"
      >
        {languages.map((lang) => (
          <option key={lang.value} value={lang.value}>
            {lang.nativeName}
          </option>
        ))}
      </select>
    </SettingRow>
  );
}
