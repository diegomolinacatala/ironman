/**
 * Pure helpers of POST /v1/speech (text-to-speech for the coach): request validation, the
 * Workers AI input of each tier and the conversion of each model's output into audio bytes.
 *
 * Tiers (the Supabase `speech` function picks one with a daily character budget; the worker
 * just obeys it):
 * - `premium`: Deepgram Aura 2 (Spanish neural voices) → MP3. 2,727 neurons per 1k characters,
 *   so a 600-character answer costs ~1,636 of the 10,000 free daily neurons (shared with the LLM).
 * - `basic`: MeloTTS → base64 WAV (44.1 kHz, 16-bit, mono). 18.6 neurons per audio minute.
 *   Also the fallback whenever Aura fails or returns no audio.
 */
import type { Result } from './types.mts';

/** Aura 2 Spanish speakers. */
export const SPEECH_VOICES = ['carina', 'diana', 'nestor', 'alvaro'] as const;
export type SpeechVoice = (typeof SPEECH_VOICES)[number];

export const SPEECH_TIERS = ['premium', 'basic'] as const;
export type SpeechTier = (typeof SPEECH_TIERS)[number];

export const PREMIUM_SPEECH_MODEL = '@cf/deepgram/aura-2-es';
export const BASIC_SPEECH_MODEL = '@cf/myshell-ai/melotts';

/** Maximum `text` length, counted in Unicode code points (`[...text].length`), after trimming. */
export const MAX_SPEECH_CHARS = 600;
/** Body limit of /v1/speech (600 code points of up to 4 UTF-8 bytes each fit with room to spare). */
export const MAX_SPEECH_BODY_BYTES = 8 * 1024;
/** Upper bound of the audio the worker buffers (600 characters are well under 1 MB of MP3/WAV). */
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export interface SpeechRequest {
  text: string;
  voice: SpeechVoice;
  tier: SpeechTier;
}

/** Bytes backed by a plain ArrayBuffer (what `new Response(...)` accepts). */
export type AudioBytes = Uint8Array<ArrayBuffer>;

export interface SpeechAudio {
  bytes: AudioBytes;
  contentType: 'audio/mpeg' | 'audio/wav';
  model: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function fail<T>(error: string): Result<T> {
  return { ok: false, error };
}

/** C0/C1 control characters except tab, line feed and carriage return. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

/** Validates the body of POST /v1/speech (unknown top-level keys are ignored). */
export function parseSpeechRequest(body: unknown): Result<SpeechRequest> {
  if (!isObj(body)) return fail('body: must be a JSON object');
  if (typeof body.text !== 'string') return fail('text: must be a string');
  const text = body.text.trim();
  const length = [...text].length;
  if (length === 0 || length > MAX_SPEECH_CHARS) return fail(`text: 1-${MAX_SPEECH_CHARS} characters after trimming`);
  if (CONTROL.test(text)) return fail('text: control characters are not allowed (only tab and line breaks)');
  if (typeof body.voice !== 'string' || !(SPEECH_VOICES as readonly string[]).includes(body.voice)) {
    return fail(`voice: one of ${SPEECH_VOICES.join(', ')}`);
  }
  if (typeof body.tier !== 'string' || !(SPEECH_TIERS as readonly string[]).includes(body.tier)) {
    return fail(`tier: one of ${SPEECH_TIERS.join(', ')}`);
  }
  return { ok: true, value: { text, voice: body.voice as SpeechVoice, tier: body.tier as SpeechTier } };
}

/** `env.AI.run` input of Aura 2. */
export function premiumInput(req: SpeechRequest): Record<string, unknown> {
  return { text: req.text, speaker: req.voice, encoding: 'mp3' };
}

/** `env.AI.run` input of MeloTTS (one voice; `voice` does not apply). */
export function basicInput(req: SpeechRequest): Record<string, unknown> {
  return { prompt: req.text, lang: 'es' };
}

class AudioTooLarge extends Error {
  constructor() {
    super(`audio above ${MAX_AUDIO_BYTES} bytes`);
  }
}

async function readStream(stream: ReadableStream<unknown>): Promise<AudioBytes> {
  const reader = stream.getReader();
  const chunks: AudioBytes[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = toBytes(value);
    total += chunk.byteLength;
    if (total > MAX_AUDIO_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new AudioTooLarge();
    }
    chunks.push(chunk);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const isStream = (v: unknown): v is ReadableStream<unknown> =>
  v instanceof ReadableStream || (typeof v === 'object' && v !== null && typeof (v as { getReader?: unknown }).getReader === 'function');

function toBytes(value: unknown): AudioBytes {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (!ArrayBuffer.isView(value)) return new Uint8Array(0);
  const { buffer, byteOffset, byteLength } = value;
  // A view over a SharedArrayBuffer is copied into a plain one.
  return buffer instanceof ArrayBuffer ? new Uint8Array(buffer, byteOffset, byteLength) : new Uint8Array(new Uint8Array(buffer, byteOffset, byteLength));
}

/**
 * Binary model output (Aura: a ReadableStream of MPEG audio; Uint8Array / ArrayBuffer handled
 * defensively) → bytes, fully buffered so a mid-stream failure surfaces here and can fall back.
 * Unknown shapes give empty bytes (treated as "no audio" by the caller).
 */
export async function audioBytes(output: unknown): Promise<AudioBytes> {
  if (isStream(output)) return readStream(output);
  const bytes = toBytes(output);
  if (bytes.byteLength > MAX_AUDIO_BYTES) throw new AudioTooLarge();
  return bytes;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** MeloTTS output `{ audio: '<base64 WAV>' }` → bytes (binary outputs accepted defensively). */
export async function basicAudioBytes(output: unknown): Promise<AudioBytes> {
  if (!isObj(output) || typeof output.audio !== 'string') return audioBytes(output);
  const b64 = output.audio.replace(/\s+/g, '');
  if (!b64) return new Uint8Array(0);
  if (!BASE64.test(b64)) throw new Error('melotts returned invalid base64 audio');
  if (Math.floor((b64.length * 3) / 4) > MAX_AUDIO_BYTES) throw new AudioTooLarge();
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Upstream error message for the logs, with the spoken text redacted if the model echoed it. */
export function safeErrorMessage(error: unknown, text: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown';
  return (text ? raw.split(text).join('[text]') : raw).slice(0, 300);
}
