import type { KanbanLesson, KanbanLessonLean } from '@/shared/kanban-types.js';

import { KanbanPmHttpError, type KanbanPmClient } from './kanban-pm-client.js';
import {
  TAGS_ARGUMENT,
  errorResult,
  textResult,
  toolSchema,
  type ToolTable,
} from './mcp-protocol.js';

/**
 * The three lesson tools: the corpus's two reads and the one write a session is allowed.
 *
 * WHAT A LESSON IS HERE: a durable note a session stages at the end of a build — a resolved error's
 * fix, an operator's correction, a workflow it discovered — for the OPERATOR to review. Staging is
 * the agent's; reviewing is a person's (the review routes are refused on this door outright, and
 * there is deliberately no approve tool). A staged lesson is invisible to future sessions until the
 * operator approves it, and then it is the approved index `list_actionable` carries.
 *
 * The schemas are `mcp_tools_lessons.py:45-95`'s: the trigger and kind enums are the four and two
 * values the corpus accepts, and `limit` is REFUSED rather than clamped outside 1..500, because a
 * silently clamped limit hides the caller's bug.
 *
 * Every call is one HTTP request to the lessons routes on the `/api/kanban-pm` mount — the door
 * this program holds a credential for. Nothing here imports the board's lesson service: this is a
 * stdio child with no server, no router and no database handle in it, and an import reaching back
 * into `server/modules/kanban/` would drag all three in.
 */

const LESSON_TRIGGERS = [
  'complex_task',
  'error_resolved',
  'operator_correction',
  'workflow_discovered',
];
const LESSON_KINDS = ['note', 'skill_draft'];

/** The index's bounds, `mcp_tools_lessons.py`'s schema: `limit` 1..500, default 100. */
const LESSON_LIMIT_DEFAULT = 100;
const LESSON_LIMIT_MAX = 500;

/** Descent's door rules: a name past 80 and a summary past 60 are REFUSED, never truncated. */
const LESSON_NAME_MAX = 80;
const LESSON_SUMMARY_MAX = 60;

/**
 * How much of the approved corpus the orient read carries.
 *
 * `store_actionable.py:170-171`'s approved index: an unscored recency slice, because there is no
 * lesson scoring anywhere in Descent and none is invented here.
 */
export const APPROVED_LESSON_LIMIT = 50;

type LessonIndex = { lessons: KanbanLessonLean[] };
type LessonEnvelope = { lesson: KanbanLesson };

/** The lesson index at the board's own route: LEAN rows, no bodies, newest first. */
export async function lessonIndex(
  client: KanbanPmClient,
  status: string | undefined,
  limit: number
): Promise<KanbanLessonLean[]> {
  const filter = status === undefined ? '' : `&status=${encodeURIComponent(status)}`;
  return (await client.get<LessonIndex>(`/lessons?limit=${limit}${filter}`)).lessons;
}

/** The approved corpus, newest first — what `list_actionable`'s `lessons` key carries. */
export function approvedLessons(client: KanbanPmClient): Promise<KanbanLessonLean[]> {
  return lessonIndex(client, 'approved', APPROVED_LESSON_LIMIT);
}

/**
 * One lesson whole — body and draft path included — or null for an id that names none.
 *
 * A 404 is the caller's own miss, not a transport fault, so it is the one answer caught here and
 * turned into a domain miss; every other failure keeps travelling as the error it is. An answer
 * carrying no lesson is the same MISS and not a success: the door redirects or falls through to
 * another route for some ids, and a caller handed `undefined` would read a shape miss as "here is
 * your lesson, empty".
 */
async function lessonById(client: KanbanPmClient, lessonId: string): Promise<KanbanLesson | null> {
  try {
    const envelope = await client.get<LessonEnvelope>(`/lessons/${encodeURIComponent(lessonId)}`);
    return envelope?.lesson ?? null;
  } catch (error) {
    if (error instanceof KanbanPmHttpError && error.status === 404) return null;
    throw error;
  }
}

export function createLessonTools(client: KanbanPmClient): ToolTable {
  const tools = [
    {
      name: 'stage_lesson',
      description:
        "Stage a reusable LESSON from THIS build for the operator's review — a durable note (or " +
        "skill draft) worth carrying into future sessions: a resolved error's fix, an operator " +
        'correction, a workflow you discovered, or how you handled a complex task. A STAGED lesson ' +
        'is invisible to future sessions until the operator APPROVES it — you cannot approve your ' +
        'own (there is deliberately no approve tool). Keep `summary` <= 60 chars (the one-line ' +
        'index entry a future session scans); put the full teaching in `body`. Stage sparingly, ' +
        'only on a REAL, transferable lesson.',
      inputSchema: toolSchema(
        {
          name: { type: 'string', description: 'Short lesson name (<= 80 chars).' },
          summary: {
            type: 'string',
            description:
              'One-line index summary (<= 60 chars — a longer summary is REFUSED, never truncated).',
          },
          body: {
            type: 'string',
            description:
              'The full lesson body (markdown OK) — the teaching a future session reads via ' +
              "get_lesson. Optional but strongly expected; a skill_draft's body becomes its .SKILL.md.",
          },
          trigger: {
            type: 'string',
            enum: LESSON_TRIGGERS,
            description:
              'What prompted this lesson: complex_task | error_resolved | operator_correction | ' +
              'workflow_discovered.',
          },
          tags: TAGS_ARGUMENT,
          feature_id: {
            type: 'string',
            description:
              "Optional: the card this lesson came from (e.g. 'c-3'), kept as provenance. The " +
              "lesson survives that card's later deletion.",
          },
          kind: {
            type: 'string',
            enum: LESSON_KINDS,
            description:
              'note (default) | skill_draft (also writes a <slug>.SKILL.md into the spill root ' +
              'for the operator to promote into a real skill).',
          },
        },
        ['name', 'summary', 'trigger']
      ),
    },
    {
      name: 'list_lessons',
      description:
        'List lessons as LEAN rows (id, name, summary, trigger, kind, tags, status — NO body). ' +
        'Filter by status (staged | approved | rejected; omit for all). Read-only. Use this to ' +
        'scan for a relevant lesson, then load its body with get_lesson.',
      inputSchema: toolSchema(
        {
          status: {
            type: 'string',
            description: 'Filter: staged | approved | rejected (omit for all).',
          },
          limit: {
            type: 'integer',
            description:
              'Max rows, 1..500 (default 100). Pass a high value (e.g. 500) for a FULL dedupe ' +
              'sweep — the default window silently drops the oldest rows past 100.',
          },
        },
        []
      ),
    },
    {
      name: 'get_lesson',
      description:
        "Load ONE lesson's FULL body (and its draft path) by id — call this ONLY when its " +
        'summary/tags match the work at hand, not to browse. Read-only.',
      inputSchema: toolSchema({ id: { type: 'string', description: "The lesson id (e.g. 'ls-3')." } }, [
        'id',
      ]),
    },
  ];

  return {
    tools,
    handlers: {
      stage_lesson: async (args) => {
        const name = typeof args.name === 'string' ? args.name : '';
        if (name.trim() === '') return errorResult('name must be a non-empty string');
        if (name.length > LESSON_NAME_MAX) {
          return errorResult(`name must be at most ${LESSON_NAME_MAX} characters`);
        }

        const summary = typeof args.summary === 'string' ? args.summary : '';
        if (summary.trim() === '') return errorResult('summary must be a non-empty string');
        if (summary.length > LESSON_SUMMARY_MAX) {
          return errorResult(
            `summary must be at most ${LESSON_SUMMARY_MAX} characters (it is refused, never truncated)`
          );
        }

        const trigger = args.trigger;
        if (typeof trigger !== 'string' || !LESSON_TRIGGERS.includes(trigger)) {
          return errorResult(`trigger must be one of: ${LESSON_TRIGGERS.join(', ')}`);
        }

        const kind = args.kind ?? 'note';
        if (typeof kind !== 'string' || !LESSON_KINDS.includes(kind)) {
          return errorResult(`kind must be one of: ${LESSON_KINDS.join(', ')}`);
        }

        const staged = await client.post<LessonEnvelope>('/lessons', {
          name,
          summary,
          trigger,
          body: typeof args.body === 'string' ? args.body : '',
          tags: (args.tags as string[] | undefined) ?? [],
          // Descent's `feature_id` is this board's `cardId`: the tool keeps the argument name the
          // ported brief was written against and translates it at the one boundary that can — the
          // route names a card the way this board's schema does.
          cardId: args.feature_id as string | undefined,
          kind,
        });

        return textResult(staged.lesson);
      },

      list_lessons: async (args) => {
        // Refused, never clamped — `mcp_tools_lessons.py:184-186`'s rule, and the "full dedupe
        // sweep" its schema documents only means anything if 500 means 500.
        const limit = args.limit === undefined ? LESSON_LIMIT_DEFAULT : args.limit;
        if (
          typeof limit !== 'number' ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > LESSON_LIMIT_MAX
        ) {
          return errorResult(`limit must be a whole number between 1 and ${LESSON_LIMIT_MAX}`);
        }

        const status = (args.status as string | undefined)?.trim();

        return textResult(await lessonIndex(client, status === '' ? undefined : status, limit));
      },

      get_lesson: async (args) => {
        // Refused before the call, like every other argument on this surface: an empty id is not a
        // lesson, and letting it reach the door would ask the INDEX route for a lesson.
        const lessonId = typeof args.id === 'string' ? args.id.trim() : '';
        if (lessonId === '') return errorResult('id must be a non-empty string');

        const lesson = await lessonById(client, lessonId);
        if (lesson === null) return errorResult(`no such lesson: ${lessonId}`);

        return textResult(lesson);
      },
    },
  };
}
