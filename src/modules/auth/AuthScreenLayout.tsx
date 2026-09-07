import type { ReactNode } from 'react';

import { Card } from '@/shared/ui';
import { IS_PLATFORM } from '@/shared/utils';

type AuthScreenLayoutProps = {
  title: string;
  description: string;
  children: ReactNode;
  footerText: string;
  logo?: ReactNode;
};

/** Wraps the auth module's LoginForm and SetupForm so both full-screen auth pages share one card layout. */
export default function AuthScreenLayout({
  title,
  description,
  children,
  footerText,
  logo,
}: AuthScreenLayoutProps) {
  return (
    <div className="relative h-screen overflow-y-auto bg-background">
      {/* Ambient, on-brand backdrop that gives the screen depth without
          competing with the card content. Fixed so it stays put while the
          form scrolls on short viewports. */}
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-24 h-[26rem] w-[26rem] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(color-mix(in_srgb,var(--ink)_4%,transparent)_1px,transparent_1px)] opacity-60 [background-size:22px_22px]" />
      </div>

      <div className="relative mx-auto flex min-h-full w-full max-w-[26rem] flex-col justify-center gap-5 p-4 py-8">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            {logo ?? <img src="/logo.svg" alt="" aria-hidden className="h-6 w-6" />}
            <span className="text-xs uppercase tracking-[0.14em] text-ink-faint">CloudCLI</span>
          </div>
          <h1 className="font-serif text-[38px] leading-[1.1] text-foreground">{title}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>

        <Card className="flex flex-col gap-[18px] p-6">
          {children}
          <p className="text-center text-xs leading-relaxed text-ink-faint">{footerText}</p>
        </Card>

        {!IS_PLATFORM && (
          <div className="flex items-center justify-center gap-1.5">
            <svg className="h-3.5 w-3.5 text-ink-faint" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            <a
              href="https://github.com/siteboon/claudecodeui"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-ink-faint transition-colors hover:text-muted-foreground"
            >
              CloudCLI is open source
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
