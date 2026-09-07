import { Banner } from '@/shared/ui';

type AuthErrorAlertProps = {
  errorMessage: string;
};

/**
 * Rendered by the auth module's LoginForm and SetupForm to surface submit and session errors.
 *
 * `warn`, not `danger`: a rejected password is something to try again, not something
 * destructive or denied outright (doctrine §5 — errors are amber, and red is kept for the
 * irreversible). The Banner's own ▲ carries the state, so the sentence is not the only signal
 * and neither is the colour.
 */
export default function AuthErrorAlert({ errorMessage }: AuthErrorAlertProps) {
  if (!errorMessage) {
    return null;
  }

  return (
    <div role="alert">
      <Banner tone="warn">
        <p className="text-sm leading-relaxed">{errorMessage}</p>
      </Banner>
    </div>
  );
}
