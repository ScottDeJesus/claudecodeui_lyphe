import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';
import AuthScreenLayout from '@/modules/auth/AuthScreenLayout';

type ServerUnreachableScreenProps = {
  onRetry: () => void;
};

/**
 * Shown by ProtectedRoute when a session token is held but the server never answered the boot
 * check — a restart mid-reload, a tab woken onto a dead socket.
 *
 * It exists because the alternative was the login form: the same screen a real sign-out lands
 * on, asking for a password against a server that cannot check one, and implying the session
 * was lost when it is sitting untouched in storage.
 */
export default function ServerUnreachableScreen({ onRetry }: ServerUnreachableScreenProps) {
  const { t } = useTranslation();

  return (
    <AuthScreenLayout
      title={t('auth.unreachable.title', { defaultValue: "Can't reach the server" })}
      description={t('auth.unreachable.description', {
        defaultValue: 'Your session is still here. CloudCLI just could not reach the server to check it — it may be restarting.',
      })}
      footerText={t('auth.unreachable.footer', {
        defaultValue: 'Nothing was signed out. Try again in a moment.',
      })}
    >
      <Button onClick={onRetry} className="w-full">
        {t('auth.unreachable.retry', { defaultValue: 'Try again' })}
      </Button>
    </AuthScreenLayout>
  );
}
