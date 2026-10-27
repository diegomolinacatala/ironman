/** Pure helpers for meal photos (unit-tested; no native imports). */

/** Long side of the JPEG sent to the analysis (and kept on the device). */
export const MEAL_PHOTO_MAX_SIDE = 1024;

/**
 * Size that fits `width × height` inside `max × max` keeping the aspect ratio,
 * or null when it already fits (no resize needed).
 */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } | null {
  if (!(width > 0) || !(height > 0) || (width <= max && height <= max)) return null;
  const scale = max / Math.max(width, height);
  return {
    width: Math.max(1, Math.min(max, Math.round(width * scale))),
    height: Math.max(1, Math.min(max, Math.round(height * scale))),
  };
}

/** Ids become file names: only letters, digits, '-' and '_' (no path traversal). */
export function isSafeFileId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

/** `analyzeMeal` wants raw base64, without a "data:image/jpeg;base64," prefix. */
export function stripDataUrlPrefix(base64: string): string {
  return base64.replace(/^data:[^;,]+;base64,/, '').trim();
}
