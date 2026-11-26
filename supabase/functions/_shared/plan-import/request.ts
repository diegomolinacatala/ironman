/**
 * Validation of `POST /plan-import`:
 * `{ kind: 'text', text }` | `{ kind: 'image', imageBase64 }` | `{ kind: 'pdf', pdfBase64 }`.
 * Text ≤ 20 000 characters; photo (JPEG/PNG/WebP by magic bytes) ≤ 2 MB of base64;
 * PDF (`%PDF-` magic) ≤ 6 MB of base64 (≈ 4.5 MB file). Larger bodies → 413 `too_large`.
 */
import type { ClaudeImageType } from '../coach/ports.ts';

export const MAX_TEXT = 20_000;
export const MAX_IMAGE_BASE64 = 2 * 1024 * 1024;
export const MAX_PDF_BASE64 = 6 * 1024 * 1024;
export const MAX_BODY_BYTES = MAX_PDF_BASE64 + 64 * 1024;

export type PlanImportRequest =
  | { kind: 'text'; text: string }
  | { kind: 'image'; image: { mediaType: ClaudeImageType; base64: string } }
  | { kind: 'pdf'; pdf: Uint8Array };

export type PlanImportRequestResult = { ok: true; value: PlanImportRequest } | { ok: false; status: 400 | 413; error: string };

const bad = (error: string): PlanImportRequestResult => ({ ok: false, status: 400, error });
const tooLarge = (error: string): PlanImportRequestResult => ({ ok: false, status: 413, error });

function cleanBase64(raw: string): string {
  return raw.replace(/^data:[a-z/+.-]+;base64,/i, '').replace(/\s+/g, '');
}

function head(base64: string): string | null {
  try {
    return atob(base64.slice(0, 16));
  } catch {
    return null;
  }
}

export function imageType(base64: string): ClaudeImageType | null {
  const h = head(base64);
  if (h === null) return null;
  if (h.startsWith('\xFF\xD8\xFF')) return 'image/jpeg';
  if (h.startsWith('\x89PNG\r\n\x1A\n')) return 'image/png';
  if (h.startsWith('RIFF') && h.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function parsePlanImportRequest(input: unknown): PlanImportRequestResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return bad('se esperaba un objeto JSON');
  const body = input as Record<string, unknown>;
  if (body.kind === 'text') {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return bad('text: pega el plan');
    if (text.length > MAX_TEXT) return tooLarge(`el texto supera ${MAX_TEXT} caracteres`);
    return { ok: true, value: { kind: 'text', text } };
  }
  if (body.kind === 'image') {
    const base64 = typeof body.imageBase64 === 'string' ? cleanBase64(body.imageBase64) : '';
    if (!base64) return bad('imageBase64: falta la foto');
    if (base64.length > MAX_IMAGE_BASE64) return tooLarge('la foto supera 2 MB');
    if (!BASE64_RE.test(base64)) return bad('imageBase64 no es base64 válido');
    const mediaType = imageType(base64);
    if (!mediaType) return bad('la foto debe ser JPEG, PNG o WebP');
    return { ok: true, value: { kind: 'image', image: { mediaType, base64 } } };
  }
  if (body.kind === 'pdf') {
    const base64 = typeof body.pdfBase64 === 'string' ? cleanBase64(body.pdfBase64) : '';
    if (!base64) return bad('pdfBase64: falta el PDF');
    if (base64.length > MAX_PDF_BASE64) return tooLarge('el PDF supera 4,5 MB');
    if (!BASE64_RE.test(base64)) return bad('pdfBase64 no es base64 válido');
    if (!(head(base64) ?? '').startsWith('%PDF-')) return bad('el archivo no es un PDF');
    return { ok: true, value: { kind: 'pdf', pdf: base64ToBytes(base64) } };
  }
  return bad("kind: 'text', 'image' o 'pdf'");
}
