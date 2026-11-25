import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Banner, Button, Rule } from '@/shared/ui';

type GeminiDoorDownProps = {
  /** connector or cloudcli: whose place this is. */
  section: string;
  /** The head the door's sections would have stood under. */
  title: string;
  /** What is missing here and what the door said. */
  sentence: string;
  onRetry: () => void;
};

/**
 * A door that did not answer, in that door's own place: the head stays where the eye last found it, and under it one
 * sentence says what is missing and one press asks again. The other door's sections draw as they are.
 */
export function GeminiDoorDown({ section, title, sentence, onRetry }: GeminiDoorDownProps) {
  const { t } = useTranslation();
  const headingId = useId();
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId} data-gemini-section={section} data-gemini-door-down>
      <Rule id={headingId}>{title}</Rule>
      <Banner
        tone="warn"
        action={
          <Button variant="tonal" size="sm" className="shrink-0 finger:h-11" onClick={onRetry}>
            {t('api.gemini.doorDown.retry')}
          </Button>
        }
      >
        {sentence}
      </Banner>
    </section>
  );
}
