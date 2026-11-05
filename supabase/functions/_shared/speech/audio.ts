/** Audio helpers of the `speech` function (Web standard APIs only). */
import { SPEECH_MIMES } from './ports.ts';
import type { SpeechMime } from './ports.ts';

/** Bytes per btoa chunk: a multiple of 3, so the chunks' base64 can be concatenated without padding. */
const BASE64_CHUNK = 3 * 16 * 1024;

/** Standard base64 (with padding), chunked so ~2 MB of audio never builds one huge argument list. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK))));
  }
  return parts.join('');
}

/** `audio/mpeg` / `audio/wav` (case and parameters ignored), else null. */
export function audioMime(contentType: string | null): SpeechMime | null {
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return (SPEECH_MIMES as readonly string[]).includes(type) ? (type as SpeechMime) : null;
}
