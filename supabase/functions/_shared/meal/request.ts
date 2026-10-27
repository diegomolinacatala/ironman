/**
 * Validation of `POST /meal` `{ date, time, imageBase64?, text? }`: real date,
 * HH:mm time, at least a photo or a description, base64 photo ≤ 2 MB (else
 * 413 `too_large`) whose bytes are a JPEG (PNG/WebP also accepted).
 */
import type { ClaudeImageType } from '../coach/ports.ts';
import { isIsoDate } from '../dates.ts';
import { dateSchema, timeSchema } from '../planning/changes.ts';
import { object, optional, string } from '../schema.ts';
import type { ISODate, ISOTime } from '../types.ts';

/** Largest accepted photo, as base64 characters (≈ 1.5 MB of JPEG). */
export const MAX_IMAGE_BASE64 = 2 * 1024 * 1024;
/** Whole body: the photo plus a little JSON around it. */
export const MAX_BODY_BYTES = MAX_IMAGE_BASE64 + 64 * 1024;
export const MAX_TEXT = 1000;

export interface MealRequest {
  date: ISODate;
  time: ISOTime;
  image: { mediaType: ClaudeImageType; base64: string } | null;
  text: string | null;
}

export type MealRequestResult = { ok: true; value: MealRequest } | { ok: false; status: 400 | 413; error: string };

const bodySchema = object(
  {
    date: dateSchema(),
    time: timeSchema(),
    imageBase64: optional(string({ trim: false })),
    text: optional(string({ max: MAX_TEXT })),
  },
  undefined,
  { stripUnknown: true },
);

/** Media type from the magic bytes (first 12 decoded bytes). */
function imageType(base64: string): ClaudeImageType | null {
  let head: string;
  try {
    head = atob(base64.slice(0, 16));
  } catch {
    return null;
  }
  if (head.startsWith('\xFF\xD8\xFF')) return 'image/jpeg';
  if (head.startsWith('\x89PNG\r\n\x1A\n')) return 'image/png';
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function cleanBase64(raw: string): string {
  return raw.replace(/^data:image\/[a-z+]+;base64,/i, '').replace(/\s+/g, '');
}

const bad = (error: string): MealRequestResult => ({ ok: false, status: 400, error });

export function parseMealRequest(input: unknown): MealRequestResult {
  const parsed = bodySchema.parse(input, '');
  if (!parsed.ok) return bad(parsed.error);
  const v = parsed.value;
  if (!isIsoDate(v.date)) return bad(`date: la fecha ${v.date} no existe`);
  const text = v.text?.trim() || null;
  const base64 = v.imageBase64 ? cleanBase64(v.imageBase64) : '';
  if (!base64 && !text) return bad('envía una foto (imageBase64) o una descripción (text)');
  if (base64.length > MAX_IMAGE_BASE64) return { ok: false, status: 413, error: 'la foto supera 2 MB' };
  if (base64 && !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return bad('imageBase64 no es base64 válido');
  const mediaType = base64 ? imageType(base64) : null;
  if (base64 && !mediaType) return bad('la foto debe ser JPEG');
  return {
    ok: true,
    value: {
      date: v.date,
      time: v.time.slice(0, 5),
      image: base64 && mediaType ? { mediaType, base64 } : null,
      text,
    },
  };
}
