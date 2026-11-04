import express from 'express';

import { GEMINI_BUDGET_HEADER } from '@/modules/browser-use/browser-use-budget.js';
import { browserUseService } from '@/modules/browser-use/browser-use.service.js';

const router = express.Router();

// The Gemini budget ID the calling MCP process sent with this tool call, or null when it sent none. Node's
// parser already refuses a line break inside a header; the check keeps the ID one line wherever it travels next.
function readBudgetHeader(value: string | undefined): string | null {
  const budget = value?.trim() ?? '';
  return budget && !/[\r\n]/.test(budget) ? budget : null;
}

function readBearerToken(header: unknown): string | null {
  if (typeof header !== 'string') {
    return null;
  }
  const match = /^Bearer\s+(\S.*)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

router.use((req, res, next) => {
  const expected = browserUseService.getMcpToken();
  const token = readBearerToken(req.headers.authorization) || String(req.headers['x-browser-use-mcp-token'] || '');
  if (!token || token !== expected) {
    res.status(401).json({ success: false, error: 'Invalid Browser MCP token.' });
    return;
  }
  next();
});

router.post('/tools/:toolName', async (req, res) => {
  try {
    const input = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : '';
    const toolName = req.params.toolName;
    const budget = readBudgetHeader(req.get(GEMINI_BUDGET_HEADER));
    let result: unknown;

    switch (toolName) {
      case 'browser_create_session':
        result = await browserUseService.createAgentSession({
          profileName: typeof input.profileName === 'string' ? input.profileName : null,
          budget,
        });
        break;
      case 'browser_list_sessions':
        result = await browserUseService.listAgentSessions();
        break;
      case 'browser_snapshot':
      case 'browser_take_screenshot':
        result = await browserUseService.agentSnapshot(sessionId, budget);
        break;
      case 'browser_navigate':
        result = await browserUseService.agentNavigate(sessionId, String(input.url || ''), budget);
        break;
      case 'browser_click':
        result = await browserUseService.agentClick(sessionId, {
          selector: typeof input.selector === 'string' ? input.selector : undefined,
          text: typeof input.text === 'string' ? input.text : undefined,
          x: typeof input.x === 'number' ? input.x : undefined,
          y: typeof input.y === 'number' ? input.y : undefined,
        }, budget);
        break;
      case 'browser_type':
        result = await browserUseService.agentType(sessionId, {
          selector: typeof input.selector === 'string' ? input.selector : undefined,
          text: String(input.text || ''),
          submit: input.submit === true,
        }, budget);
        break;
      case 'browser_fill_form':
        result = await browserUseService.agentFillForm(
          sessionId,
          Array.isArray(input.fields)
            ? input.fields.map((field) => {
              const record = field as Record<string, unknown>;
              return {
                selector: String(record.selector || ''),
                value: String(record.value || ''),
              };
            })
            : [],
          budget,
        );
        break;
      case 'browser_press_key':
        result = await browserUseService.agentPressKey(sessionId, String(input.key || ''), budget);
        break;
      case 'browser_select_option':
        result = await browserUseService.agentSelectOption(
          sessionId,
          String(input.selector || ''),
          Array.isArray(input.values) ? input.values.filter((value): value is string => typeof value === 'string') : [],
          budget,
        );
        break;
      case 'browser_wait_for':
        result = await browserUseService.agentWaitFor(sessionId, {
          text: typeof input.text === 'string' ? input.text : undefined,
          url: typeof input.url === 'string' ? input.url : undefined,
          timeoutMs: typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined,
        }, budget);
        break;
      case 'browser_tabs':
        result = await browserUseService.agentTabs(sessionId, {
          action: input.action === 'new' || input.action === 'select' || input.action === 'close' || input.action === 'list'
            ? input.action
            : undefined,
          index: typeof input.index === 'number' ? input.index : undefined,
          url: typeof input.url === 'string' ? input.url : undefined,
        }, budget);
        break;
      case 'browser_close_session':
        result = await browserUseService.agentStopSession(sessionId);
        break;
      default:
        res.status(404).json({ success: false, error: `Unknown Browser MCP tool "${toolName}".` });
        return;
    }

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Browser MCP tool failed.',
    });
  }
});

export default router;
