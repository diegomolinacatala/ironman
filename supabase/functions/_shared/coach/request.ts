/** Validation of the app's `CoachRequest` (src/domain/types.ts). */
import { isIsoDate, startOfWeek } from '../dates.ts';
import { dateSchema, uuidSchema } from '../planning/changes.ts';
import { array, enumOf, object, optional, string } from '../schema.ts';
import type { Result } from '../schema.ts';
import { COACH_MODES } from '../types.ts';
import type { CoachRequest } from '../types.ts';

const messageSchema = object(
  { role: enumOf(['user', 'assistant'] as const), content: string({ min: 1, max: 4000 }) },
  undefined,
  { stripUnknown: true },
);

const requestSchema = object(
  {
    mode: enumOf(COACH_MODES),
    weekStart: dateSchema(),
    message: optional(string({ max: 4000 })),
    history: optional(array(messageSchema, { max: 30 })),
    lifeEventId: optional(uuidSchema()),
    friendIds: optional(array(uuidSchema(), { max: 5 })),
    channel: optional(enumOf(['voice', 'text'] as const)),
  },
  undefined,
  { stripUnknown: true },
);

/** Validates and normalizes (weekStart → Monday, last 20 history turns, empty message dropped). */
export function parseCoachRequest(input: unknown): Result<CoachRequest> {
  const parsed = requestSchema.parse(input, '');
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (!isIsoDate(v.weekStart)) return { ok: false, error: `weekStart: la fecha ${v.weekStart} no existe` };
  return {
    ok: true,
    value: {
      mode: v.mode,
      weekStart: startOfWeek(v.weekStart),
      ...(v.message ? { message: v.message } : {}),
      ...(v.history && v.history.length ? { history: v.history.slice(-20) } : {}),
      ...(v.lifeEventId ? { lifeEventId: v.lifeEventId } : {}),
      ...(v.friendIds && v.friendIds.length ? { friendIds: [...new Set(v.friendIds)] } : {}),
      ...(v.channel ? { channel: v.channel } : {}),
    },
  };
}
