<!-- docstore export; edit rows with docstore write, never this file -->

## INV-205 — Question cards share three parts

`AskUserQuestionPanel` (pending) and `AnsweredQuestion` (answered) render one question from the same `QuestionText` and `QuestionOptionRow`. A style change to either part changes both cards.

1. `QuestionOptionRow` inside an option group takes `choice`: `'radio'` (single-select) or `'checkbox'` (multi-select) gives `role` plus `aria-checked`. why: `aria-pressed` inside a radiogroup announces a one-way pick as a toggle.
2. `QuestionOptionRow` with no `choice` is a toggle button with `aria-pressed` — only the "Other" row, which sits outside the group and really switches off.
3. `QuestionOptionRow` with no `onClick` renders a `div` (the answered record; `data-question-option-chosen` marks a chosen row).
4. `QuestionText` pins `--chat-font-size: 1rem`. why: `MarkdownContent` sizes a tool body at 7/8 of the reader's chat size and drew the question larger than the options.
5. `QuestionText` runs `separateListBoundaries` before `MarkdownContent` (`breaks` on). why: questions arrive with single newlines, and markdown reads the closing `Run it?` line as a lazy continuation of the last list item.
6. `AnsweredQuestion.parseAnswer` assumes the panel writes a multi-select answer as chosen labels joined by `", "`, typed note last. Change the panel's answer format and `parseAnswer` in the same edit.
7. The answered card shows option rows only for an answer that is WHOLLY known labels. Option rows for "option plus note" need the panel to send structured answers (chosen options and the note kept separate); that changes what the model receives, so the operator decides.
8. Below the `sm` breakpoint the panel's footer hides the Esc/Enter key hints and wraps, action buttons pushed right. why: a long translation clipped Submit at 390px.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/ContentRenderers/AnsweredQuestion.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/ContentRenderers/QuestionText.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/InteractiveRenderers/AskUserQuestionPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/InteractiveRenderers/QuestionOptionRow.tsx
