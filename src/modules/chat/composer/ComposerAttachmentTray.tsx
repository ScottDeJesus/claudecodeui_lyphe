import { PromptInputHeader } from '@/shared/ui';
import { cn } from '@/shared/utils';
import ComposerAttachment from '@/modules/chat/composer/ComposerAttachment';

type ComposerAttachmentTrayProps = {
  files: File[];
  onRemove: (index: number) => void;
  /** The sentence `useAttachmentIntake` answers for the files its last intake left out; null when it took them all. */
  refused: string | null;
};

/**
 * Used by chat's ChatComposer and, through the chat barrel, the companion module's CompanionComposer: the files waiting to be sent, as the chips the chat has always drawn, each with its remove
 * control, under a warn line saying which files the last intake did not take. With no file waiting and a sentence, the line
 * stands alone; draws nothing when both are empty.
 */
export function ComposerAttachmentTray({ files, onRemove, refused }: ComposerAttachmentTrayProps) {
  if (files.length === 0 && !refused) return null;

  return (
    <PromptInputHeader>
      {refused && (
        // The house's amber line, as CompanionComposer draws its talk error: in the flow above the chips, so it takes room.
        // Every refused name stands in it, so it scrolls inside its own box past a few lines rather than push the composer off a phone.
        <p
          role="alert"
          data-tone="warn"
          className={cn(
            'flex max-h-28 w-fit max-w-full items-start gap-1.5 overflow-y-auto rounded-lg border border-tone-ink/25 bg-tone-soft px-2.5 py-1.5 text-xs leading-snug text-tone-ink',
            files.length > 0 && 'mb-1.5',
          )}
        >
          <span aria-hidden="true">▲</span>
          <span className="min-w-0 break-words">{refused}</span>
        </p>
      )}
      {files.length > 0 && (
        <div className="rounded-xl bg-muted/40 p-2">
          <div className="flex flex-wrap gap-2">
            {files.map((file, index) => (
              <ComposerAttachment
                key={`${file.name}-${file.lastModified}-${index}`}
                file={file}
                onRemove={() => onRemove(index)}
              />
            ))}
          </div>
        </div>
      )}
    </PromptInputHeader>
  );
}
