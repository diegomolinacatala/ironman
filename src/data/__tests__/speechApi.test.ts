import { describe, expect, jest, test } from '@jest/globals';

import type { SupabaseCtx } from '../supabase/base';
import { parseSpeechAudio, speechApi } from '../supabase/speechApi';

function ctxWith(invoke: (name: string, options: unknown) => Promise<{ data: unknown; error: unknown }>): SupabaseCtx {
  return { client: { functions: { invoke } } } as unknown as SupabaseCtx;
}

describe('speechApi', () => {
  test('returns the audio of the speech function', async () => {
    const invoke = jest.fn(async (_name: string, _options: unknown) => ({ data: { audio: 'SUQz', mime: 'audio/mpeg', model: 'aura', tier: 'premium' }, error: null }));
    const api = speechApi(ctxWith(invoke));
    await expect(api.synthesizeSpeech!({ text: ' Hola. ', voice: 'diana' })).resolves.toEqual({ audio: 'SUQz', mime: 'audio/mpeg' });
    expect(invoke).toHaveBeenCalledWith('speech', expect.objectContaining({ body: { text: 'Hola.', voice: 'diana' } }));
  });

  test('null (device voice) for errors, odd answers and texts the function would reject', async () => {
    const failing = speechApi(ctxWith(async () => ({ data: null, error: { name: 'FunctionsHttpError', context: { status: 503 } } })));
    await expect(failing.synthesizeSpeech!({ text: 'Hola.', voice: 'carina' })).resolves.toBeNull();
    const throwing = speechApi(
      ctxWith(async () => {
        throw new TypeError('Network request failed');
      }),
    );
    await expect(throwing.synthesizeSpeech!({ text: 'Hola.', voice: 'carina' })).resolves.toBeNull();
    const invoke = jest.fn(async (_name: string, _options: unknown) => ({ data: { audio: 'x', mime: 'audio/mpeg' }, error: null }));
    const api = speechApi(ctxWith(invoke));
    await expect(api.synthesizeSpeech!({ text: '   ', voice: 'carina' })).resolves.toBeNull();
    await expect(api.synthesizeSpeech!({ text: 'a'.repeat(601), voice: 'carina' })).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  test('parseSpeechAudio accepts only base64 audio of a known type', () => {
    expect(parseSpeechAudio({ audio: 'UklG', mime: 'audio/wav' })).toEqual({ audio: 'UklG', mime: 'audio/wav' });
    expect(parseSpeechAudio({ audio: 'x', mime: 'text/html' })).toBeNull();
    expect(parseSpeechAudio({ audio: '', mime: 'audio/mpeg' })).toBeNull();
    expect(parseSpeechAudio('nope')).toBeNull();
  });
});
