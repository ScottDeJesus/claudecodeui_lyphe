import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import { copyTextToClipboard } from '@/shared/utils';

const COPY_SUCCESS_TIMEOUT_MS = 2000;

type CopyFormat = 'text' | 'markdown';

type CopyFormatOption = {
  format: CopyFormat;
  label: string;
};

// Converts markdown into readable plain text for "Copy as text".
const convertMarkdownToPlainText = (markdown: string): string => {
  let plainText = markdown.replace(/\r\n/g, '\n');
  const codeBlocks: string[] = [];
  plainText = plainText.replace(/```[\w-]*\n([\s\S]*?)```/g, (_match, code: string) => {
    const placeholder = `@@CODEBLOCK${codeBlocks.length}@@`;
    codeBlocks.push(code.replace(/\n$/, ''));
    return placeholder;
  });
  plainText = plainText.replace(/`([^`]+)`/g, '$1');
  plainText = plainText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1');
  plainText = plainText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  plainText = plainText.replace(/^>\s?/gm, '');
  plainText = plainText.replace(/^#{1,6}\s+/gm, '');
  plainText = plainText.replace(/^[-*+]\s+/gm, '');
  plainText = plainText.replace(/^\d+\.\s+/gm, '');
  plainText = plainText.replace(/(\*\*|__)(.*?)\1/g, '$2');
  plainText = plainText.replace(/(\*|_)(.*?)\1/g, '$2');
  plainText = plainText.replace(/~~(.*?)~~/g, '$1');
  plainText = plainText.replace(/<\/?[^>]+(>|$)/g, '');
  plainText = plainText.replace(/\n{3,}/g, '\n\n');
  plainText = plainText.replace(/@@CODEBLOCK(\d+)@@/g, (_match, index: string) => codeBlocks[Number(index)] ?? '');
  return plainText.trim();
};

/**
 * Rendered by chat's MessageComponent to copy a turn to the clipboard, with a
 * markdown/plain-text format picker on assistant turns.
 */
const MessageCopyControl = ({
  content,
  messageType,
}: {
  content: string;
  messageType: 'user' | 'assistant';
}) => {
  const { t } = useTranslation('chat');
  // The window the row is drawn in: the menu is measured against its viewport, portalled into its
  // body and closed by events on it, the copy goes through its clipboard, and the "copied" tick is
  // timed on it (a hidden opener throttles its timers).
  const hostWindow = useHostWindow();
  const canSelectCopyFormat = messageType === 'assistant';
  const defaultFormat: CopyFormat = canSelectCopyFormat ? 'markdown' : 'text';
  const [selectedFormat, setSelectedFormat] = useState<CopyFormat>(defaultFormat);
  // When the last copy landed, or null: the tick shows while it is set, and the effect below clears it
  // after `COPY_SUCCESS_TIMEOUT_MS`. A stamp rather than a boolean so a second copy inside the window
  // restarts the tick instead of inheriting the first one's deadline.
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const copied = copiedAt !== null;
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // The dropdown is rendered in a portal, not inside the row: `position: fixed` is only
  // viewport-anchored while no ancestor between the menu and the root becomes its containing
  // block or clip box — which `.chat-message` was, by `contain: paint`, until 2026-09-24 (see
  // `src/index.css`). The menu is anchored to the trigger by viewport rect here, so it keeps
  // working either way; the portal is what makes that independent of the row's own layout.
  // Anchor it to the trigger, flipping above when there isn't room below.
  const openDropdown = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const ESTIMATED_MENU_HEIGHT = 84;
      // `min-w-36` on the panel below. Anchoring by `right` alone walks the menu off the LEFT
      // edge whenever the trigger sits near it: measured on a 390px phone this trigger opens at
      // x=75, which put the panel's left edge at -49. Capping `right` at
      // `innerWidth - width - margin` keeps that edge on screen without moving the common case.
      const MENU_MIN_WIDTH = 144;
      const openUp = rect.bottom + ESTIMATED_MENU_HEIGHT + 8 > hostWindow.innerHeight;
      setMenuStyle({
        position: 'fixed',
        right: Math.min(
          Math.max(8, hostWindow.innerWidth - rect.right),
          Math.max(8, hostWindow.innerWidth - MENU_MIN_WIDTH - 8),
        ),
        zIndex: 1000,
        ...(openUp
          ? { bottom: hostWindow.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      });
    }
    setIsDropdownOpen(true);
  };

  const copyFormatOptions: CopyFormatOption[] = useMemo(
    () => [
      {
        format: 'markdown',
        label: t('copyMessage.copyAsMarkdown', { defaultValue: 'Copy as markdown' }),
      },
      {
        format: 'text',
        label: t('copyMessage.copyAsText', { defaultValue: 'Copy as text' }),
      },
    ],
    [t]
  );

  const selectedFormatTag = selectedFormat === 'markdown'
    ? t('copyMessage.markdownShort', { defaultValue: 'MD' })
    : t('copyMessage.textShort', { defaultValue: 'TXT' });

  const copyPayload = useMemo(() => {
    if (selectedFormat === 'markdown') {
      return content;
    }
    return convertMarkdownToPlainText(content);
  }, [content, selectedFormat]);

  useEffect(() => {
    setSelectedFormat(defaultFormat);
    setIsDropdownOpen(false);
  }, [defaultFormat]);

  useEffect(() => {
    if (!isDropdownOpen) return;

    // Close when clicking outside both the control and the portaled menu.
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setIsDropdownOpen(false);
    };

    // The menu is fixed-positioned; close it if the page scrolls so it can't
    // detach from the trigger.
    const closeOnScroll = () => setIsDropdownOpen(false);

    hostWindow.addEventListener('mousedown', closeOnOutsideClick);
    hostWindow.addEventListener('scroll', closeOnScroll, true);
    hostWindow.addEventListener('resize', closeOnScroll);
    return () => {
      hostWindow.removeEventListener('mousedown', closeOnOutsideClick);
      hostWindow.removeEventListener('scroll', closeOnScroll, true);
      hostWindow.removeEventListener('resize', closeOnScroll);
    };
  }, [isDropdownOpen, hostWindow]);

  // The tick clears itself. An effect keyed on the window, not a timer armed once in the handler: a
  // timer armed on a floating window dies with that window, and chat-host closes the window to bring
  // the chat home — the tick would then stay until the next click. A move changes `hostWindow`, so
  // the effect re-arms on the window the row now stands in.
  useEffect(() => {
    if (copiedAt === null) return;
    const timer = hostWindow.setTimeout(() => setCopiedAt(null), COPY_SUCCESS_TIMEOUT_MS);
    return () => hostWindow.clearTimeout(timer);
  }, [copiedAt, hostWindow]);

  const handleCopyClick = async () => {
    if (!copyPayload.trim()) return;
    const didCopy = await copyTextToClipboard(copyPayload, hostWindow);
    if (!didCopy) return;

    setCopiedAt(Date.now());
  };

  const handleFormatChange = (format: CopyFormat) => {
    setSelectedFormat(format);
    setIsDropdownOpen(false);
  };

  const toneClass = messageType === 'user'
    ? 'text-muted-foreground hover:text-foreground'
    : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300';
  const copyTitle = copied ? t('copyMessage.copied') : t('copyMessage.copy');
  const rootClassName = canSelectCopyFormat
    ? 'relative flex min-w-0 flex-1 items-center gap-0.5 sm:min-w-max sm:flex-none sm:w-auto'
    : 'relative flex items-center gap-0.5';

  return (
    <div ref={dropdownRef} className={rootClassName}>
      <button
        type="button"
        onClick={handleCopyClick}
        title={copyTitle}
        aria-label={copyTitle}
        className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors ${toneClass}`}
      >
        {copied ? (
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wide">{selectedFormatTag}</span>
      </button>

      {canSelectCopyFormat && (
        <>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => (isDropdownOpen ? setIsDropdownOpen(false) : openDropdown())}
            className={`rounded px-1 py-0.5 transition-colors ${toneClass}`}
            aria-label={t('copyMessage.selectFormat', { defaultValue: 'Select copy format' })}
            title={t('copyMessage.selectFormat', { defaultValue: 'Select copy format' })}
          >
            <svg
              className={`h-3 w-3 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {isDropdownOpen && createPortal(
            <div
              ref={menuRef}
              style={menuStyle}
              className="min-w-36 rounded-md border border-border bg-popover p-1 shadow-lg"
            >
              {copyFormatOptions.map((option) => {
                const isSelected = option.format === selectedFormat;
                return (
                  <button
                    key={option.format}
                    type="button"
                    onClick={() => handleFormatChange(option.format)}
                    className={`block w-full rounded px-2 py-1.5 text-left transition-colors ${isSelected
                      ? 'bg-accent text-foreground'
                      : 'text-foreground hover:bg-accent'
                      }`}
                  >
                    <span className="block text-xs font-medium">{option.label}</span>
                  </button>
                );
              })}
            </div>,
            hostWindow.document.body,
          )}
        </>
      )}
    </div>
  );
};

export default MessageCopyControl;
