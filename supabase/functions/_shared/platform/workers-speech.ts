/**
 * Natural text-to-speech through our `ironman-ai` worker (cloudflare/ai, POST /v1/speech):
 * `{ text, voice, tier }` with the shared bearer secret and the opaque per-user `x-ai-client`
 * key (same HMAC as the chat port) → 200 raw audio (`audio/mpeg` from Aura-2, `audio/wav` from
 * MeloTTS) + `x-speech-model`. Errors `{ error, message }` (400/401/429/502/503 quota/500).
 * Every failure becomes a SpeechUnavailableError. `fetch` is injected (tests use a fake).
 */
import { isAbortLike } from '../coach/deadline.ts';
import { audioMime } from '../speech/audio.ts';
import { SpeechUnavailableError } from '../speech/ports.ts';
import type { SpeechAudio, SpeechPort, SpeechSynthesisRequest } from '../speech/ports.ts';
import { CLIENT_HEADER, clientKey } from './workers-ai.ts';
import type { FetchFn } from './workers-ai.ts';

/** Refuse bigger answers (≈ 600 chars of speech is well under 2 MB in either format). */
export const MAX_SPEECH_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_MODEL_LENGTH = 100;

export interface WorkersSpeechConfig {
  /** Worker base URL, e.g. https://ironman-ai.<tu-subdominio>.workers.dev */
  url: string;
  /** Same value as the worker's AI_SHARED_SECRET. */
  secret: string;
  fetch: FetchFn;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Worker HTTP error → SpeechUnavailableError (the code is only logged; the app gets 503). */
export function speechWorkerError(status: number, body: unknown): SpeechUnavailableError {
  const code = isObj(body) && typeof body.error === 'string' ? body.error : '';
  if (status === 503 && code === 'quota') return new SpeechUnavailableError('quota', 'Neuronas gratuitas del día agotadas.');
  if (status === 429) return new SpeechUnavailableError('rate_limited', 'El worker de voz está limitando peticiones.');
  if (status === 401 || status === 403 || status === 500) return new SpeechUnavailableError('misconfigured', `El worker de voz responde ${status}.`);
  if (status === 400 || status === 413) return new SpeechUnavailableError('rejected', `El worker de voz rechaza la petición (${status}).`);
  return new SpeechUnavailableError('upstream', `El worker de voz responde ${status}.`);
}

function failure(error: unknown, signal: AbortSignal): SpeechUnavailableError {
  if (error instanceof SpeechUnavailableError) return error;
  if (signal.aborted || isAbortLike(error)) return new SpeechUnavailableError('timeout', 'La voz ha tardado demasiado.');
  return new SpeechUnavailableError('network', 'No se pudo conectar con el worker de voz.');
}

const badAudio = (why: string): SpeechUnavailableError => new SpeechUnavailableError('bad_audio', `Respuesta de voz no válida: ${why}.`);

async function readAudio(res: Response): Promise<SpeechAudio> {
  const mime = audioMime(res.headers.get('content-type'));
  if (!mime) {
    await res.body?.cancel().catch(() => undefined);
    throw badAudio('no es audio');
  }
  if (Number(res.headers.get('content-length') ?? '0') > MAX_SPEECH_AUDIO_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw badAudio('demasiado grande');
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0) throw badAudio('vacía');
  if (bytes.length > MAX_SPEECH_AUDIO_BYTES) throw badAudio('demasiado grande');
  const model = (res.headers.get('x-speech-model') ?? '').trim().slice(0, MAX_MODEL_LENGTH) || 'unknown';
  return { bytes, mime, model };
}

export function createWorkersSpeechPort(config: WorkersSpeechConfig): SpeechPort {
  const endpoint = `${config.url.replace(/\/+$/, '')}/v1/speech`;
  return {
    async synthesize(req: SpeechSynthesisRequest): Promise<SpeechAudio> {
      try {
        const res = await config.fetch(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.secret}`,
            'content-type': 'application/json',
            [CLIENT_HEADER]: await clientKey(config.secret, req.userId),
          },
          body: JSON.stringify({ text: req.text, voice: req.voice, tier: req.tier }),
          signal: req.signal,
        });
        if (!res.ok) throw speechWorkerError(res.status, await res.json().catch(() => null));
        return await readAudio(res);
      } catch (error) {
        throw failure(error, req.signal);
      }
    },
  };
}
