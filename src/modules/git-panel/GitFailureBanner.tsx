import { Banner } from '@/shared/ui';
import { describeGitFailure } from '@/modules/git-panel/utils/gitPanelUtils';

type GitFailureBannerProps = {
  error: string;
  details?: string;
};

/**
 * A git failure, drawn the ONE way this panel draws one: amber, in English, the path beneath
 * in mono when the failure names one, and git's own words one hover away in `title`.
 *
 * Used by the repository error state and by a diff that would not read. `describeGitFailure`
 * already gave the two sites one wording; this gives them one rendering, so neither can print
 * the title and silently drop the path the other shows.
 *
 * It is a warn Banner rather than an EmptyState because a read that FAILED is not empty, it is
 * unknown — an error is amber (doctrine §5), and the Banner carries the tone's mark so the
 * state survives the colour being drained out (§6).
 */
export default function GitFailureBanner({ error, details }: GitFailureBannerProps) {
  const failure = describeGitFailure(error, details);

  return (
    <div title={failure.raw}>
      <Banner tone="warn">
        <p className="font-medium">{failure.title}</p>
        {failure.detail && (
          <p className="mt-0.5 break-all font-mono text-xs opacity-80">{failure.detail}</p>
        )}
      </Banner>
    </div>
  );
}
