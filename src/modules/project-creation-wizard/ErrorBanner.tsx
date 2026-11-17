import { AlertCircle } from 'lucide-react';

type ErrorBannerProps = {
  message: string;
};

/** Rendered by ProjectCreationWizard to surface the wizard's current error message. */
export default function ErrorBanner({ message }: ErrorBannerProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-[var(--danger-soft)] p-4">
      <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--danger-ink)]" />
      <p className="text-sm text-[var(--danger-ink)]">{message}</p>
    </div>
  );
}
