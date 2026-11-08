<!-- docstore export; edit rows with docstore write, never this file -->

## INV-205 — Question cards share three parts

`AskUserQuestionPanel` (pending) and `AnsweredQuestion` (answered) render one question from the same `QuestionText` and `QuestionOptionRow`; the dispatcher module's `RoundAnswer` (a round's options) does too, through `@/shared/ui`, and so does the station's ask stage (`AskAnswers`, a chat's question: MAN-9282). `QuestionText` alone, through the chat barrel, also draws the dispatcher's `LockAnswer` (the Accept census) and the companion's `CompanionActionCard` (the prompt of an action waiting for his word). A style change to either part changes every card.

1. `QuestionOptionRow` inside an option group takes `choice`: `'radio'` (single-select) or `'checkbox'` (multi-select) gives `role` plus `aria-checked`. why: `aria-pressed` inside a radiogroup announces a one-way pick as a toggle.
2. `QuestionOptionRow` with no `choice` is a toggle button with `aria-pressed` — only the "Other" row, which sits outside the group and really switches off.
3. `QuestionOptionRow` with no `onClick` renders a `div` (the answered record; `data-question-option-chosen` marks a chosen row).
4. `QuestionText` pins `--chat-font-size: 1rem`. why: `MarkdownContent` sizes a tool body at 7/8 of the reader's chat size and drew the question larger than the options.
5. `QuestionText` runs `separateListBoundaries` before `MarkdownContent` (`breaks` on). why: questions arrive with single newlines, and markdown reads the closing `Run it?` line as a lazy continuation of the last list item.
6. `AnsweredQuestion.parseAnswer` assumes the panel writes a multi-select answer as chosen labels joined by `", "`, typed note last. Change the panel's answer format and `parseAnswer` in the same edit.
7. The answered card shows option rows only for an answer that is WHOLLY known labels. Option rows for "option plus note" need the panel to send structured answers (chosen options and the note kept separate); that changes what the model receives, so the operator decides.
8. Below the `sm` breakpoint the panel's footer hides the Esc/Enter key hints and wraps, action buttons pushed right. why: a long translation clipped Submit at 390px.
9. Under a finger (`finger:`: a touch screen, or a window under 768 px) `QuestionOptionRow` is a 44 px catch (`finger:min-h-11`): the station's touch law (INV-10275) holds the ask stage's options to it, and every card that draws the row gets it.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/ContentRenderers/AnsweredQuestion.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/ContentRenderers/QuestionText.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/InteractiveRenderers/AskUserQuestionPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/QuestionOptionRow.tsx

## INV-11419 — MCP elicitation form — edits that break it: every check runs on the string that is sent, the server's text is looked up by own entry only, and the request is told from a tool permission by one spelled name

What the panel and its form logic must keep (MAN-9697; the server's half MAN-332):

1. Every check runs on the string that is SENT, never on what was typed (`toSentString`): a `date-time` as the UTC instant, a choice as its untrimmed enum value. why: the server validates an accepted answer against `requestedSchema` with ajv; a check on the typed text lets through an answer the server rejects, and the tool call fails.
2. A schema's text is the MCP server's own. Any table keyed by it is read by OWN entry only (`ownEntry`, or `Object.prototype.hasOwnProperty.call`): `FORMAT_INPUT_TYPES` and `fullFormats` in `mcpElicitationForm.ts`, `FORMAT_PROBLEM_KEYS` in the panel. why: a plain `table[format]` answers `hasOwnProperty` or `valueOf` with the function every object inherits, and Submit throws. A format no table names is unchecked and drawn as plain text.
3. The panel is exhaustive over the field kinds and the problem codes (`assertNever`): a new kind or rule is a type error until the panel draws or words it. Keep both switches closed.
4. Only an `http:` or `https:` URL gets an Open link (`isOpenableUrl`); anything else, `javascript:` above all, is text.
5. The name `McpElicitation` is spelled once on the server (`MCP_ELICITATION_TOOL_NAME` in `claude-elicitation.ts`, which the providers barrel hands to the companion's ask lanes) and once in `PermissionRequestsBanner.tsx`. A rename changes both. why: a request the banner does not recognise is drawn as a tool permission, and its Allow reaches the MCP server as an accept of an empty form.

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -c "ownEntry(" src/modules/chat/utils/mcpElicitationForm.ts; grep -c "hasOwnProperty.call(FORMAT_PROBLEM_KEYS" src/modules/chat/tools/InteractiveRenderers/McpElicitationPanel.tsx; grep -c "MCP_ELICITATION_TOOL_NAME = 'McpElicitation'" server/modules/providers/list/claude/claude-elicitation.ts src/modules/chat/composer/PermissionRequestsBanner.tsx
expect: 2, 1, then 1 for each file — a 0 on the first two is a table read by plain lookup (a hostile format crashes Submit); a 0 on the last two is a name spelled differently on one side
```

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-elicitation.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/PermissionRequestsBanner.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/InteractiveRenderers/McpElicitationPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/utils/mcpElicitationForm.ts
