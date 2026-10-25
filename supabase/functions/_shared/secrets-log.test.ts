import assert from 'node:assert/strict';
import test from 'node:test';
import { createLogger, maskString, redact } from './log.ts';
import type { LogLevel } from './log.ts';
import { hasServiceKey, primaryServiceKey, secretKeysFromEnv } from './secrets.ts';

const envOf =
  (vars: Record<string, string>) =>
  (name: string): string | undefined =>
    vars[name];

test('secret keys come from SUPABASE_SECRET_KEYS JSON with legacy fallback', () => {
  const env = envOf({
    SUPABASE_SECRET_KEYS: JSON.stringify({ automations: 'sb_secret_auto', default: 'sb_secret_default' }),
    SUPABASE_SERVICE_ROLE_KEY: 'eyJlegacy',
  });
  assert.deepEqual(secretKeysFromEnv(env), ['sb_secret_auto', 'sb_secret_default', 'eyJlegacy']);
  assert.equal(primaryServiceKey(env), 'sb_secret_default');
  assert.equal(primaryServiceKey(envOf({ SUPABASE_SERVICE_ROLE_KEY: 'eyJlegacy' })), 'eyJlegacy');
  assert.deepEqual(secretKeysFromEnv(envOf({ SUPABASE_SECRET_KEYS: 'not json' })), []);
  assert.equal(primaryServiceKey(envOf({})), null);
});

test('hasServiceKey accepts apikey or Bearer and rejects anything else', () => {
  const keys = ['sb_secret_default'];
  assert.equal(hasServiceKey(new Headers({ apikey: 'sb_secret_default' }), keys), true);
  assert.equal(hasServiceKey(new Headers({ authorization: 'Bearer sb_secret_default' }), keys), true);
  assert.equal(hasServiceKey(new Headers({ apikey: 'sb_publishable_x' }), keys), false);
  assert.equal(hasServiceKey(new Headers(), keys), false);
  assert.equal(hasServiceKey(new Headers({ apikey: 'x' }), []), false);
});

test('logger redacts sensitive keys and token-looking values', () => {
  const lines: { level: LogLevel; line: string }[] = [];
  const log = createLogger({ fn: 'test' }, (level, line) => lines.push({ level, line }));
  log.info('called /mcp/u/rb_' + 'a'.repeat(64), { apiKey: 'garmin-secret', note: 'Bearer eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig', path: '/mcp/u/x' });
  const entry = JSON.parse(lines[0].line) as Record<string, unknown>;
  assert.equal(entry.fn, 'test');
  assert.equal(entry.apiKey, '[redacted]');
  assert.equal(entry.path, '[redacted]');
  assert.ok(!String(entry.msg).includes('rb_aaaa'));
  assert.ok(!String(entry.note).includes('eyJhbGci'));
  assert.equal(maskString('key sk-ant-abc123 here'), 'key [redacted] here');
  assert.deepEqual(redact({ nested: { token: 'x', ok: 1 } }), { nested: { token: '[redacted]', ok: 1 } });
});
