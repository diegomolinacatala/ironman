import assert from 'node:assert/strict';
import test from 'node:test';
import { SpeechUnavailableError } from '../speech/ports.ts';
import type { SpeechSynthesisRequest } from '../speech/ports.ts';
import { USER } from '../testing/fakes.ts';
import { CLIENT_HEADER, clientKey } from './workers-ai.ts';
import type { FetchFn } from './workers-ai.ts';
import { createWorkersSpeechPort, MAX_SPEECH_AUDIO_BYTES } from './workers-speech.ts';

const SECRET = 'worker-shared-secret-0123456789abcdef';
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0xff, 0xfb]);

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (call: Call) => Response | Promise<Response>, calls: Call[] = []): FetchFn {
  return async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  };
}

const port = (fetch: FetchFn) => createWorkersSpeechPort({ url: 'https://ironman-ai.example.workers.dev/', secret: SECRET, fetch });

const request = (overrides: Partial<SpeechSynthesisRequest> = {}): SpeechSynthesisRequest => ({
  userId: USER,
  text: 'Buenos días, Diego.',
  voice: 'carina',
  tier: 'premium',
  signal: new AbortController().signal,
  ...overrides,
});

const audio = (bytes: Uint8Array<ArrayBuffer>, type: string, model: string | null = '@cf/deepgram/aura-2-es'): Response =>
  new Response(bytes, { status: 200, headers: { 'content-type': type, ...(model ? { 'x-speech-model': model } : {}) } });

async function rejectsWith(promise: Promise<unknown>, code: SpeechUnavailableError['code']): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof SpeechUnavailableError && error.code === code);
}

test('POST /v1/speech with bearer secret, HMAC client key and { text, voice, tier }', async () => {
  const calls: Call[] = [];
  const result = await port(fakeFetch(() => audio(MP3, 'audio/mpeg'), calls)).synthesize(request({ voice: 'alvaro', tier: 'basic' }));
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.url, 'https://ironman-ai.example.workers.dev/v1/speech');
  assert.equal(call.init.method, 'POST');
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers.authorization, `Bearer ${SECRET}`);
  assert.equal(headers['content-type'], 'application/json');
  assert.equal(headers[CLIENT_HEADER], await clientKey(SECRET, USER));
  assert.match(headers[CLIENT_HEADER] ?? '', /^[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(String(call.init.body)), { text: 'Buenos días, Diego.', voice: 'alvaro', tier: 'basic' });
  assert.deepEqual(result, { bytes: MP3, mime: 'audio/mpeg', model: '@cf/deepgram/aura-2-es' });
});

test('wav answers are accepted; a missing x-speech-model becomes "unknown"', async () => {
  const result = await port(fakeFetch(() => audio(MP3, 'audio/wav; codecs=1', null))).synthesize(request());
  assert.equal(result.mime, 'audio/wav');
  assert.equal(result.model, 'unknown');
});

test('worker errors map to SpeechUnavailableError codes', async () => {
  const cases: [number, unknown, SpeechUnavailableError['code']][] = [
    [503, { error: 'quota', message: 'x' }, 'quota'],
    [503, { error: 'unavailable', message: 'x' }, 'upstream'],
    [502, { error: 'model_error', message: 'x' }, 'upstream'],
    [429, { error: 'rate_limited', message: 'x' }, 'rate_limited'],
    [401, { error: 'unauthorized', message: 'x' }, 'misconfigured'],
    [500, { error: 'misconfigured', message: 'x' }, 'misconfigured'],
    [400, { error: 'bad_request', message: 'x' }, 'rejected'],
    [404, null, 'upstream'],
  ];
  for (const [status, body, code] of cases) {
    const fetch = fakeFetch(() => (body === null ? new Response('nope', { status }) : Response.json(body, { status })));
    await rejectsWith(port(fetch).synthesize(request()), code);
  }
});

test('non-audio, empty or oversized answers are bad_audio', async () => {
  await rejectsWith(port(fakeFetch(() => Response.json({ ok: true }))).synthesize(request()), 'bad_audio');
  await rejectsWith(port(fakeFetch(() => audio(new Uint8Array(), 'audio/mpeg'))).synthesize(request()), 'bad_audio');
  await rejectsWith(port(fakeFetch(() => audio(MP3, 'audio/ogg'))).synthesize(request()), 'bad_audio');
  const big = new Uint8Array(MAX_SPEECH_AUDIO_BYTES + 1);
  await rejectsWith(port(fakeFetch(() => audio(big, 'audio/mpeg'))).synthesize(request()), 'bad_audio');
});

test('network errors and aborts', async () => {
  await rejectsWith(port(async () => Promise.reject(new TypeError('fetch failed'))).synthesize(request()), 'network');
  const controller = new AbortController();
  controller.abort();
  const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
  await rejectsWith(port(async () => Promise.reject(abortError)).synthesize(request({ signal: controller.signal })), 'timeout');
});
