import { Banner, Button } from '@/shared/ui';

type StartRefusalBannerProps = {
  /** Why the press did not become a run, in the words the operator reads. */
  message: string;
  /** The conversation that refused it, when the refusal points at one. */
  sessionId: string | null;
  onOpenConversation: (sessionId: string) => void;
};

/**
 * The warn strip an idle delegation card shows when a press was refused.
 *
 * Rendered by GitDelegationCard, in its idle branch. It exists as its own file because a refusal can
 * now point AT something: `/git` checkpoints every repository, so a run started from another
 * project's panel refuses a press here too — and naming that project without offering to open its
 * conversation would leave the operator hunting the sidebar for a run they were just told about.
 *
 * Amber, never red (doctrine §5), and the tone's own mark carries it without the colour (§6).
 */
export default function StartRefusalBanner({ message, sessionId, onOpenConversation }: StartRefusalBannerProps) {
  return (
    <Banner
      tone="warn"
      action={sessionId !== null && (
        <Button variant="outline" size="sm" onClick={() => onOpenConversation(sessionId)}>
          Read the conversation
        </Button>
      )}
    >
      <p className="text-sm">{message}</p>
    </Banner>
  );
}
