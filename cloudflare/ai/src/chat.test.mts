import assert from 'node:assert/strict';
import test from 'node:test';
import { bearer, clientKey, ipKey, isQuotaError, modelInput, normalizeOutput, parseChatRequest, secretMatches } from './chat.mts';
import type { ChatRequest } from './chat.mts';

const SCHEMA = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
const IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

const valid = {
  model: '@cf/nvidia/nemotron-3-120b-a12b',
  messages: [
    { role: 'system', content: 'Eres un coach.' },
    { role: 'user', content: [{ type: 'image_url', image_url: { url: IMAGE } }, { type: 'text', text: '¿Qué es?' }] },
  ],
  response_format: { type: 'json_schema', json_schema: { name: 'output', schema: SCHEMA, strict: true } },
  max_completion_tokens: 4000,
  enable_thinking: false,
};

test('parseChatRequest accepts the documented body and defaults enable_thinking to false', () => {
  const parsed = parseChatRequest(valid);
  assert.ok(parsed.ok);
  assert.equal(parsed.value.model, '@cf/nvidia/nemotron-3-120b-a12b');
  assert.equal(parsed.value.enable_thinking, false);
  const minimal = parseChatRequest({ model: '@cf/google/gemma-4-26b-a4b-it', messages: [{ role: 'user', content: 'hola' }], extra: 1 });
  assert.ok(minimal.ok && minimal.value.enable_thinking === false && minimal.value.response_format === undefined);
});

test('parseChatRequest rejects bad models, messages, formats and limits', () => {
  const bad: unknown[] = [
    null,
    [],
    { ...valid, model: '@cf/openai/gpt-oss-120b' },
    { ...valid, messages: [] },
    { ...valid, messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' })) },
    { ...valid, messages: [{ role: 'tool', content: 'x' }] },
    { ...valid, messages: [{ role: 'user', content: [] }] },
    { ...valid, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://evil.example/x.jpg' } }] }] },
    { ...valid, messages: [{ role: 'assistant', content: [{ type: 'image_url', image_url: { url: IMAGE } }] }] },
    { ...valid, messages: [{ role: 'user', content: [{ type: 'audio', data: 'x' }] }] },
    { ...valid, response_format: { type: 'json_object' } },
    { ...valid, response_format: { type: 'json_schema', json_schema: { name: 'bad name!', schema: SCHEMA } } },
    { ...valid, response_format: { type: 'json_schema', json_schema: { name: 'ok', schema: 'x' } } },
    { ...valid, max_completion_tokens: 0 },
    { ...valid, max_completion_tokens: 1.5 },
    { ...valid, max_completion_tokens: 100_000 },
    { ...valid, enable_thinking: 'yes' },
    { ...valid, temperature: 3 },
  ];
  for (const body of bad) assert.equal(parseChatRequest(body).ok, false, JSON.stringify(body)?.slice(0, 120));
});

test('modelInput: OpenAI shape with chat_template_kwargs; Llama gets Workers AI native shape', () => {
  const parsed = parseChatRequest({ ...valid, enable_thinking: true, temperature: 0.2 });
  assert.ok(parsed.ok);
  assert.deepEqual(modelInput(parsed.value), {
    messages: parsed.value.messages,
    temperature: 0.2,
    response_format: valid.response_format,
    max_completion_tokens: 4000,
    chat_template_kwargs: { enable_thinking: true },
  });
  const llama: ChatRequest = { ...parsed.value, model: '@cf/meta/llama-4-scout-17b-16e-instruct' };
  assert.deepEqual(modelInput(llama), {
    messages: parsed.value.messages,
    temperature: 0.2,
    response_format: { type: 'json_schema', json_schema: SCHEMA },
    max_tokens: 4000,
  });
});

test('normalizeOutput reads choices[0].message.content or response, maps length → max_tokens and usage', () => {
  assert.deepEqual(
    normalizeOutput(
      { choices: [{ message: { content: '{"a":"b"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 30 } },
      'm',
    ),
    { text: '{"a":"b"}', finishReason: 'stop', usage: { inputTokens: 120, outputTokens: 30 }, model: 'm' },
  );
  assert.deepEqual(normalizeOutput({ response: { a: 'b' } }, 'm'), { text: '{"a":"b"}', finishReason: 'stop', usage: { inputTokens: 0, outputTokens: 0 }, model: 'm' });
  assert.equal(normalizeOutput({ choices: [{ message: { content: '{"a":' }, finish_reason: 'length' }] }, 'm').finishReason, 'max_tokens');
  assert.equal(normalizeOutput({ choices: [{ message: { content: [{ type: 'text', text: 'ho' }, { type: 'text', text: 'la' }] } }] }, 'm').text, 'hola');
  assert.equal(normalizeOutput(null, 'm').text, '');
});

test('quota errors are recognised by code or message', () => {
  assert.equal(isQuotaError(new Error('3036: Account limited: you have used up your daily free allocation of 10,000 neurons')), true);
  assert.equal(isQuotaError(new Error('4006: daily free allocation')), true);
  assert.equal(isQuotaError(Object.assign(new Error('limited'), { code: 3036 })), true);
  assert.equal(isQuotaError(new Error('5007: model timeout')), false);
  assert.equal(isQuotaError(undefined), false);
});

test('bearer secret: constant-time match, wrong or missing tokens rejected', async () => {
  assert.equal(bearer('Bearer abc123'), 'abc123');
  assert.equal(bearer('Basic abc'), null);
  assert.equal(await secretMatches('s3cret-value', 's3cret-value'), true);
  assert.equal(await secretMatches('s3cret-valuX', 's3cret-value'), false);
  assert.equal(await secretMatches('short', 's3cret-value'), false);
  assert.equal(await secretMatches(null, 's3cret-value'), false);
  assert.equal(await secretMatches('x', ''), false);
});

test('rate-limit keys: 64-hex client keys, everything else in the shared bucket; IP keys bounded', () => {
  const hex = 'ab'.repeat(32);
  assert.equal(clientKey(hex), `client:${hex}`);
  assert.equal(clientKey(hex.toUpperCase()), `client:${hex}`);
  assert.equal(clientKey('11111111-1111-4111-8111-111111111111'), 'shared');
  assert.equal(clientKey(null), 'shared');
  assert.equal(ipKey('198.51.100.4'), 'ip:198.51.100.4');
  assert.equal(ipKey(null), 'ip:unknown');
  assert.equal(ipKey('x'.repeat(65)), 'ip:unknown');
});
