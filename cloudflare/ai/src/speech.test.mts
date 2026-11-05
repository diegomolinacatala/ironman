import assert from 'node:assert/strict';
import test from 'node:test';
import {
  audioBytes,
  basicAudioBytes,
  basicInput,
  MAX_AUDIO_BYTES,
  MAX_SPEECH_CHARS,
  parseSpeechRequest,
  premiumInput,
  safeErrorMessage,
  SPEECH_VOICES,
} from './speech.mts';

const valid = { text: '  Hoy toca rodaje suave en zona dos.  ', voice: 'carina', tier: 'premium' };

test('parseSpeechRequest trims the text and accepts every documented voice and tier', () => {
  const parsed = parseSpeechRequest({ ...valid, extra: 1 });
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value, { text: 'Hoy toca rodaje suave en zona dos.', voice: 'carina', tier: 'premium' });
  assert.deepEqual([...SPEECH_VOICES], ['carina', 'diana', 'nestor', 'alvaro']);
  for (const voice of SPEECH_VOICES) {
    for (const tier of ['premium', 'basic']) assert.ok(parseSpeechRequest({ ...valid, voice, tier }).ok, `${voice}/${tier}`);
  }
  assert.ok(parseSpeechRequest({ ...valid, text: 'Primera línea.\n\tSegunda línea.\r\n' }).ok, 'tab and line breaks are fine');
});

test('parseSpeechRequest counts code points: 600 emoji pass, 601 characters do not', () => {
  assert.ok(parseSpeechRequest({ ...valid, text: '🏊'.repeat(MAX_SPEECH_CHARS) }).ok, '600 code points (1200 UTF-16 units)');
  assert.ok(parseSpeechRequest({ ...valid, text: 'a'.repeat(MAX_SPEECH_CHARS) }).ok);
  const tooLong = parseSpeechRequest({ ...valid, text: 'a'.repeat(MAX_SPEECH_CHARS + 1) });
  assert.ok(!tooLong.ok && tooLong.error.startsWith('text:'));
});

test('parseSpeechRequest rejects bad bodies with a message naming the field', () => {
  const bad: [unknown, string][] = [
    [null, 'body:'],
    [[], 'body:'],
    ['hola', 'body:'],
    [{ ...valid, text: undefined }, 'text:'],
    [{ ...valid, text: 42 }, 'text:'],
    [{ ...valid, text: '' }, 'text:'],
    [{ ...valid, text: '   \n\t ' }, 'text:'],
    [{ ...valid, text: 'hola\u0000mundo' }, 'text:'],
    [{ ...valid, text: 'hola\u001bmundo' }, 'text:'],
    [{ ...valid, text: 'hola\u007fmundo' }, 'text:'],
    [{ ...valid, text: 'hola\u0085mundo' }, 'text:'],
    [{ ...valid, voice: 'luna' }, 'voice:'],
    [{ ...valid, voice: 'Carina' }, 'voice:'],
    [{ ...valid, voice: undefined }, 'voice:'],
    [{ ...valid, tier: 'gold' }, 'tier:'],
    [{ ...valid, tier: undefined }, 'tier:'],
  ];
  for (const [body, prefix] of bad) {
    const parsed = parseSpeechRequest(body);
    assert.ok(!parsed.ok, JSON.stringify(body));
    assert.ok(parsed.error.startsWith(prefix), `${JSON.stringify(body)} → ${parsed.error}`);
  }
});

test('premiumInput / basicInput build the Aura 2 and MeloTTS inputs', () => {
  const req = { text: 'Hola', voice: 'nestor' as const, tier: 'premium' as const };
  assert.deepEqual(premiumInput(req), { text: 'Hola', speaker: 'nestor', encoding: 'mp3' });
  assert.deepEqual(basicInput(req), { prompt: 'Hola', lang: 'es' });
});

const streamOf = (...chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

test('audioBytes buffers a ReadableStream and accepts Uint8Array / ArrayBuffer / views', async () => {
  assert.deepEqual(await audioBytes(streamOf(new Uint8Array([1, 2]), new Uint8Array([3]))), new Uint8Array([1, 2, 3]));
  assert.deepEqual(await audioBytes(new Uint8Array([4, 5])), new Uint8Array([4, 5]));
  assert.deepEqual(await audioBytes(new Uint8Array([6, 7]).buffer), new Uint8Array([6, 7]));
  assert.deepEqual(await audioBytes(new DataView(new Uint8Array([0, 8, 9]).buffer, 1)), new Uint8Array([8, 9]));
  assert.equal((await audioBytes({ audio: 123 })).byteLength, 0, 'unknown shapes give no audio');
  assert.equal((await audioBytes(undefined)).byteLength, 0);
});

test('audioBytes surfaces a mid-stream failure and caps the buffered audio', async () => {
  const broken = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error('stream reset'));
    },
  });
  await assert.rejects(audioBytes(broken), /stream reset/);
  const chunk = new Uint8Array(1024 * 1024);
  const huge = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk);
    },
  });
  await assert.rejects(audioBytes(huge), new RegExp(`above ${MAX_AUDIO_BYTES}`));
});

test('basicAudioBytes decodes the MeloTTS base64 WAV', async () => {
  const wav = new TextEncoder().encode('RIFF$\u0000\u0000\u0000WAVEfmt ');
  const bytes = await basicAudioBytes({ audio: Buffer.from(wav).toString('base64') });
  assert.deepEqual(bytes, wav);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  assert.equal((await basicAudioBytes({ audio: '' })).byteLength, 0);
  assert.deepEqual(await basicAudioBytes(new Uint8Array([1])), new Uint8Array([1]), 'binary output accepted defensively');
  await assert.rejects(basicAudioBytes({ audio: 'not base64!' }), /invalid base64/);
});

test('safeErrorMessage redacts the spoken text and truncates', () => {
  assert.equal(safeErrorMessage(new Error('5007: bad input "Hola Diego"'), 'Hola Diego'), '5007: bad input "[text]"');
  assert.equal(safeErrorMessage('x'.repeat(500), 'hola').length, 300);
  assert.equal(safeErrorMessage({ weird: true }, 'hola'), 'unknown');
});
