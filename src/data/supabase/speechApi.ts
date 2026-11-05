/**
 * Natural voice on Supabase: the `speech` edge function turns ≤ 600 characters into audio with
 * Deepgram Aura-2 (Workers AI, free daily allowance; MeloTTS once the day's budget is used up).
 * Best effort by design: any problem returns null and the app speaks with the device voice.
 */
import type { SpeechAudio, SpeechVoice } from '@/domain/types';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

import type { Repository } from '../repository';
import { invokeAiFunction } from './aiFunctions';
import type { SupabaseCtx } from './base';
import { asString, isRecord } from './narrow';

/** One sentence-sized piece: Aura answers in ~1 s; above this the device voice is better. */
export const SPEECH_TIMEOUT_MS = 12_000;
export const SPEECH_MAX_CHARS = 600;
const MIMES: readonly SpeechAudio['mime'][] = ['audio/mpeg', 'audio/wav'];

export function parseSpeechAudio(data: unknown): SpeechAudio | null {
  if (!isRecord(data)) return null;
  const audio = asString(data.audio);
  const mime = asString(data.mime);
  if (!audio || !mime || !(MIMES as readonly string[]).includes(mime)) return null;
  return { audio, mime: mime as SpeechAudio['mime'] };
}

export function speechApi(ctx: SupabaseCtx, timeoutMs = SPEECH_TIMEOUT_MS): Pick<Repository, 'synthesizeSpeech'> {
  async function synthesizeSpeech(input: { text: string; voice: SpeechVoice }): Promise<SpeechAudio | null> {
    const text = input.text.trim();
    if (!env.aiCoachEnabled || !text || text.length > SPEECH_MAX_CHARS) return null;
    try {
      const result = await invokeAiFunction(ctx, {
        name: 'speech',
        body: { text, voice: input.voice },
        timeoutMs,
        fallbackMessage: 'No hemos podido preparar la voz.',
      });
      if (result.kind === 'fallback') {
        logger.info('speech: using the device voice', result.reason);
        return null;
      }
      const audio = parseSpeechAudio(result.data);
      if (!audio) logger.warn('speech: unexpected response, using the device voice');
      return audio;
    } catch (error) {
      logger.info('speech: using the device voice', error instanceof Error ? error.message : error);
      return null;
    }
  }

  return { synthesizeSpeech };
}
