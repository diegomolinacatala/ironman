import assert from 'node:assert/strict';
import test from 'node:test';
import { createLogger } from '../log.ts';
import type { Logger } from '../log.ts';
import { USER } from '../testing/fakes.ts';
import type { UUID } from '../types.ts';
import { audioMime, bytesToBase64 } from './audio.ts';
import {
  DEFAULT_SPEECH_BASIC_DAILY_CHARS,
  DEFAULT_SPEECH_PREMIUM_DAILY_CHARS,
  DEFAULT_SPEECH_USER_DAILY_CHARS,
  DEFAULT_SPEECH_USER_PREMIUM_DAILY_CHARS,
  speechLimits,
  speechWorkerConfig,
} from './config.ts';
import {
  handleSpeechHttp,
  parseSpeechRequest,
  SPEECH_CONSENT_MESSAGE,
  SPEECH_LIMITED_MESSAGE,
  SPEECH_MAX_CHARS,
  SPEECH_QUOTA_MESSAGE,
  SPEECH_UNAVAILABLE_MESSAGE,
} from './http.ts';
import type { SpeechHttpDeps } from './http.ts';
import { SpeechUnavailableError } from './ports.ts';
import type { SpeechAudio, SpeechLimits, SpeechPort, SpeechSynthesisRequest, SpeechTier } from './ports.ts';

const LIMITS: SpeechLimits = { userDailyChars: 15_000, userPremiumDailyChars: 1_800, premiumDailyChars: 2_500, basicDailyChars: 60_000 };
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0xff, 0xfb, 0x90, 0x64]);

interface Harness {
  deps: SpeechHttpDeps;
  reservations: { userId: UUID; chars: number; limits: SpeechLimits }[];
  calls: SpeechSynthesisRequest[];
  logs: string[];
}

function harness(
  opts: {
    userId?: UUID | null;
    consentAt?: string | null;
    tier?: SpeechTier | null;
    speech?: SpeechPort | null;
    synthesize?: (req: SpeechSynthesisRequest) => Promise<SpeechAudio>;
    timeoutMs?: number;
    reserveError?: Error;
  } = {},
): Harness {
  const h: Harness = { reservations: [], calls: [], logs: [], deps: undefined as unknown as SpeechHttpDeps };
  const logger: Logger = createLogger({}, (_level, line) => h.logs.push(line));
  const synthesize = opts.synthesize ?? (async (): Promise<SpeechAudio> => ({ bytes: MP3, mime: 'audio/mpeg', model: '@cf/deepgram/aura-2-es' }));
  const port: SpeechPort = {
    synthesize: (req) => {
      h.calls.push(req);
      return synthesize(req);
    },
  };
  h.deps = {
    authenticate: async () => (opts.userId === undefined ? USER : opts.userId),
    budget: {
      getAiConsentAt: async () => (opts.consentAt === undefined ? '2026-10-20T10:00:00.000Z' : opts.consentAt),
      reserveSpeech: async (userId, chars, limits) => {
        if (opts.reserveError) throw opts.reserveError;
        h.reservations.push({ userId, chars, limits });
        return opts.tier === undefined ? 'premium' : opts.tier;
      },
    },
    speech: opts.speech === undefined ? port : opts.speech,
    limits: LIMITS,
    logger,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  };
  return h;
}

const post = (body: unknown, init: RequestInit = {}): Request =>
  new Request('https://x.supabase.co/functions/v1/speech', {
    method: 'POST',
    headers: { authorization: 'Bearer jwt', 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });

async function call(h: Harness, req: Request): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const res = await handleSpeechHttp(req, h.deps);
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {}, headers: res.headers };
}

const SECRET_TEXT = 'Hoy toca rodaje suave de cuarenta y cinco minutos en zona dos.';

test('success: base64 audio, worker mime and model, reserved tier; no-store; text never logged', async () => {
  const h = harness({ tier: 'premium' });
  const res = await call(h, post({ text: `  ${SECRET_TEXT}  `, voice: 'nestor' }));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { audio: Buffer.from(MP3).toString('base64'), mime: 'audio/mpeg', model: '@cf/deepgram/aura-2-es', tier: 'premium' });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(h.reservations, [{ userId: USER, chars: SECRET_TEXT.length, limits: LIMITS }]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0]?.text, SECRET_TEXT, 'trimmed');
  assert.equal(h.calls[0]?.voice, 'nestor');
  assert.equal(h.calls[0]?.tier, 'premium');
  assert.equal(h.calls[0]?.userId, USER);
  assert.ok(h.logs.length > 0);
  assert.ok(h.logs.every((line) => !line.includes('rodaje')), 'the text is never logged');
});

test('basic tier from the budget is passed to the worker and returned with a wav answer', async () => {
  const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);
  const h = harness({ tier: 'basic', synthesize: async () => ({ bytes: wav, mime: 'audio/wav', model: '@cf/myshell-ai/melotts' }) });
  const res = await call(h, post({ text: 'Buenos días' }));
  assert.equal(res.status, 200);
  assert.equal(h.calls[0]?.tier, 'basic');
  assert.equal(h.calls[0]?.voice, 'nestor', 'default voice');
  assert.deepEqual(res.body, { audio: Buffer.from(wav).toString('base64'), mime: 'audio/wav', model: '@cf/myshell-ai/melotts', tier: 'basic' });
});

test('validation: 400 for missing/empty/long text or an unknown voice (nothing reserved)', async () => {
  for (const body of [
    {},
    { text: '' },
    { text: '   ' },
    { text: 42 },
    { text: 'x'.repeat(SPEECH_MAX_CHARS + 1) },
    { text: 'hola', voice: 'pepe' },
    { text: 'hola', voice: null },
    { text: '🙂🙂' },
    '{not json',
  ]) {
    const h = harness();
    const res = await call(h, post(body));
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error, 'bad_request');
    assert.equal(h.reservations.length, 0);
    assert.equal(h.calls.length, 0);
  }
  const h = harness();
  assert.equal((await call(h, post({ text: 'x'.repeat(SPEECH_MAX_CHARS), extra: true }))).status, 200, '600 chars and unknown fields are fine');
});

test('parseSpeechRequest cleans markdown and emoji for speech', () => {
  assert.deepEqual(parseSpeechRequest({ text: '**Hoy** descansas 😴\n- estira', voice: 'diana' }), {
    ok: true,
    value: { text: 'Hoy descansas estira', voice: 'diana' },
  });
  assert.deepEqual(parseSpeechRequest({ text: 'Zona\u0000dos\u0007\tya' }), { ok: true, value: { text: 'Zona dos ya', voice: 'nestor' } });
});

test('401 without a valid JWT (before reading the body)', async () => {
  const h = harness({ userId: null });
  const res = await call(h, post({ text: 'hola' }));
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'unauthorized');
  assert.equal(h.reservations.length, 0);
});

test('403 consent_required without AI consent (nothing reserved)', async () => {
  const h = harness({ consentAt: null });
  const res = await call(h, post({ text: 'hola' }));
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: 'consent_required', message: SPEECH_CONSENT_MESSAGE });
  assert.equal(h.reservations.length, 0);
  assert.equal(h.calls.length, 0);
});

test('429 rate_limited when the reservation is refused (worker not called)', async () => {
  const h = harness({ tier: null });
  const res = await call(h, post({ text: 'hola' }));
  assert.equal(res.status, 429);
  assert.deepEqual(res.body, { error: 'rate_limited', message: SPEECH_LIMITED_MESSAGE });
  assert.equal(h.calls.length, 0);
  assert.match(SPEECH_LIMITED_MESSAGE, /límite de hoy.*voz del iPhone/);
});

test('503 ai_unavailable when the worker is not configured (no consent check, nothing reserved)', async () => {
  const h = harness({ speech: null, consentAt: null });
  const res = await call(h, post({ text: 'hola' }));
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: 'ai_unavailable', message: SPEECH_UNAVAILABLE_MESSAGE });
  assert.equal(h.reservations.length, 0);
});

test('worker failures → 503 ai_unavailable (quota gets its own message); the call stays reserved', async () => {
  const cases: [Error, string][] = [
    [new SpeechUnavailableError('upstream', 'x'), SPEECH_UNAVAILABLE_MESSAGE],
    [new SpeechUnavailableError('bad_audio', 'x'), SPEECH_UNAVAILABLE_MESSAGE],
    [new SpeechUnavailableError('quota', 'x'), SPEECH_QUOTA_MESSAGE],
    [new TypeError('boom'), SPEECH_UNAVAILABLE_MESSAGE],
  ];
  for (const [error, message] of cases) {
    const h = harness({ synthesize: async () => Promise.reject(error) });
    const res = await call(h, post({ text: SECRET_TEXT }));
    assert.equal(res.status, 503, error.message);
    assert.deepEqual(res.body, { error: 'ai_unavailable', message });
    assert.equal(h.reservations.length, 1);
    assert.ok(h.logs.every((line) => !line.includes('rodaje')));
  }
});

test('timeout: the worker call is aborted and the answer is 503 ai_unavailable', async () => {
  let aborted = false;
  const h = harness({
    timeoutMs: 20,
    synthesize: (req) =>
      new Promise<SpeechAudio>(() => {
        req.signal.addEventListener('abort', () => {
          aborted = true;
        });
      }),
  });
  const res = await call(h, post({ text: 'hola' }));
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'ai_unavailable');
  assert.ok(aborted, 'signal aborted');
});

test('store failure → 500 internal', async () => {
  const h = harness({ reserveError: new Error('db down') });
  const res = await call(h, post({ text: 'hola' }));
  assert.equal(res.status, 500);
  assert.equal(res.body.error, 'internal');
});

test('OPTIONS → 204 preflight; other methods → 405; oversized body → 413', async () => {
  const h = harness();
  const pre = await handleSpeechHttp(new Request('https://x/speech', { method: 'OPTIONS' }), h.deps);
  assert.equal(pre.status, 204);
  const get = await call(h, new Request('https://x/speech', { method: 'GET' }));
  assert.equal(get.status, 405);
  assert.equal(get.body.error, 'method_not_allowed');
  const big = await call(h, post({ text: 'x'.repeat(20_000) }));
  assert.equal(big.status, 413);
});

test('bytesToBase64 matches Buffer for sizes around the chunk boundary', () => {
  for (const size of [0, 1, 2, 3, 49_151, 49_152, 49_153, 300_001]) {
    const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 31 + 7) & 0xff);
    assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'), `size ${size}`);
  }
});

test('audioMime accepts only audio/mpeg and audio/wav', () => {
  assert.equal(audioMime('audio/mpeg'), 'audio/mpeg');
  assert.equal(audioMime('Audio/WAV; charset=binary'), 'audio/wav');
  assert.equal(audioMime('application/json'), null);
  assert.equal(audioMime('audio/ogg'), null);
  assert.equal(audioMime(null), null);
});

test('speechLimits: defaults, overrides and invalid values', () => {
  const defaults: SpeechLimits = {
    userDailyChars: DEFAULT_SPEECH_USER_DAILY_CHARS,
    userPremiumDailyChars: DEFAULT_SPEECH_USER_PREMIUM_DAILY_CHARS,
    premiumDailyChars: DEFAULT_SPEECH_PREMIUM_DAILY_CHARS,
    basicDailyChars: DEFAULT_SPEECH_BASIC_DAILY_CHARS,
  };
  assert.deepEqual(speechLimits(() => undefined), defaults);
  assert.deepEqual(defaults, { userDailyChars: 15_000, userPremiumDailyChars: 1_800, premiumDailyChars: 2_500, basicDailyChars: 60_000 });
  const env: Record<string, string> = {
    SPEECH_USER_DAILY_CHARS: ' 5000 ',
    SPEECH_USER_PREMIUM_DAILY_CHARS: '600',
    SPEECH_PREMIUM_DAILY_CHARS: '0',
    SPEECH_BASIC_DAILY_CHARS: '1000',
  };
  assert.deepEqual(speechLimits((n) => env[n]), { userDailyChars: 5000, userPremiumDailyChars: 600, premiumDailyChars: 0, basicDailyChars: 1000 });
  const bad: Record<string, string> = {
    SPEECH_USER_DAILY_CHARS: '-3',
    SPEECH_USER_PREMIUM_DAILY_CHARS: '1.5',
    SPEECH_PREMIUM_DAILY_CHARS: '99999999999',
    SPEECH_BASIC_DAILY_CHARS: 'lots',
  };
  assert.deepEqual(speechLimits((n) => bad[n]), defaults);
  assert.deepEqual(speechLimits((n) => ({ SPEECH_USER_DAILY_LIMIT: '1' })[n]), defaults, 'the old call limit is ignored');
});

test('speechWorkerConfig needs the URL and a secret of at least 32 characters', () => {
  const secret = 's'.repeat(32);
  assert.deepEqual(speechWorkerConfig((n) => ({ AI_WORKER_URL: 'https://w.dev', AI_WORKER_SECRET: secret })[n]), { url: 'https://w.dev', secret });
  assert.equal(speechWorkerConfig((n) => ({ AI_WORKER_URL: 'https://w.dev', AI_WORKER_SECRET: 's'.repeat(31) })[n]), null);
  assert.equal(speechWorkerConfig((n) => ({ AI_WORKER_SECRET: secret })[n]), null);
  assert.equal(speechWorkerConfig(() => undefined), null);
});
