import { isValidElement } from 'react';
import type { ReactNode } from 'react';

import { usePaletteOps } from '@/modules/command-palette';
import { ChipsSuppressedContext } from '@/modules/chat/transcript/shapes/chipContext';
import { parseFileRef } from '@/modules/chat/transcript/shapes/detect';

// Links to the wider web (or in-page anchors) keep normal browser navigation;
// everything else is treated as a workspace file reference.
const isExternalHref = (href?: string): boolean =>
  !!href && (/^(https?:|mailto:|tel:|data:)/i.test(href) || href.startsWith('#'));

// The link's policy over the one file-reference home in `detect.ts`: an href the author declared
// counts on a separator OR a trailing extension, where a bare path in prose needs both and a known
// extension besides. With both options off `parseFileRef` reads what this override always accepted.
const LINK_POLICY = { requireSeparator: false, requireKnownExtension: false } as const;

// Extract plain text from link children so a reference rendered only as link
// text (e.g. `[src/foo.ts]()` with an empty href) can still be opened.
const childrenToText = (children: ReactNode): string => {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(childrenToText).join('');
  }
  if (isValidElement(children)) {
    return childrenToText((children.props as { children?: ReactNode }).children);
  }
  return '';
};

type MarkdownLinkProps = { href?: string; children?: ReactNode };

/**
 * The `a` override, moved out of `Markdown.tsx` unchanged. Used by `Markdown.tsx` in both
 * component maps.
 *
 * It calls `usePaletteOps()` ITSELF rather than closing over the opener the renderer read. That is
 * what lets both component maps be module constants: nothing in either map closes over a hook any
 * more, so `MarkdownBodyRenderer` chooses between them with a ternary instead of rebuilding a map
 * in a `useMemo` on every render.
 *
 * "Is this text a file reference, and what line is it on?" has ONE answer in this repo, and it is
 * `detect.ts`'s `parseFileRef`. This override asks it under the loose `LINK_POLICY`, the prose scan
 * under the strict default — two policies, one home. The `:line` a reference carries is passed on
 * to `openFileReference`, so a link to `src/foo.ts:130` opens the Files tab at line 130; every
 * other link opens exactly where it always did.
 */
export function MarkdownLink({ href, children }: MarkdownLinkProps) {
  const { openFileReference } = usePaletteOps();

  // Prefer the href when it is a real path; otherwise fall back to the
  // link text, since models often emit `[src/foo.ts]()` with an empty href.
  const linkText = childrenToText(children);
  const hrefRef = href ? parseFileRef(href, LINK_POLICY) : null;
  const textRef = hrefRef ? null : parseFileRef(linkText, LINK_POLICY);
  const fileRef = hrefRef ?? textRef;
  // The string the reference was READ from, which is what the anchor falls back to when there is
  // no href: the author's own text, `:line` suffix and all.
  const fileSource = hrefRef ? href : linkText;
  // A link is a control already, so an inline code path inside it stays the code span it was rather
  // than becoming a chip — a button inside an anchor is one click that opens two things.
  const linked = <ChipsSuppressedContext.Provider value={true}>{children}</ChipsSuppressedContext.Provider>;

  if (fileRef && !isExternalHref(href)) {
    return (
      <a
        href={href || fileSource}
        className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400"
        onClick={(event) => {
          event.preventDefault();
          openFileReference(fileRef.path, fileRef.line ?? undefined);
        }}
      >
        {linked}
      </a>
    );
  }

  return (
    <a
      href={href}
      className="text-blue-600 hover:underline dark:text-blue-400"
      target="_blank"
      rel="noopener noreferrer"
    >
      {linked}
    </a>
  );
}
