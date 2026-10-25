import assert from 'node:assert/strict';
import test from 'node:test';
import {
  array,
  boolean,
  discriminated,
  enumOf,
  integer,
  intEnum,
  literal,
  nullable,
  number,
  object,
  optional,
  string,
  toStructuredOutputSchema,
} from './schema.ts';

test('string trims and enforces bounds and pattern with Spanish messages', () => {
  const s = string({ min: 1, max: 5, pattern: /^[a-z]+$/, hint: 'minúsculas' });
  assert.deepEqual(s.parse('  abc '), { ok: true, value: 'abc' });
  assert.equal(s.parse('', 'title').ok, false);
  const long = s.parse('abcdef', 'title');
  assert.ok(!long.ok && long.error.includes('máximo 5'));
  const bad = s.parse('ABC', 'title');
  assert.ok(!bad.ok && bad.error.includes('usa minúsculas'));
  assert.equal(s.parse(42).ok, false);
});

test('integer rejects floats and out-of-range values; number accepts finite', () => {
  const i = integer({ min: 0, max: 720 });
  assert.equal(i.parse(45).ok, true);
  assert.equal(i.parse(45.5).ok, false);
  assert.equal(i.parse(-1).ok, false);
  assert.equal(i.parse('45').ok, false);
  assert.equal(number({ max: 1 }).parse(0.5).ok, true);
  assert.equal(number().parse(Number.NaN).ok, false);
});

test('object rejects unknown keys, requires required keys and supports optional/nullable', () => {
  const o = object({ a: string(), b: optional(integer()), c: optional(nullable(string())) });
  assert.deepEqual(o.parse({ a: 'x' }), { ok: true, value: { a: 'x' } });
  assert.deepEqual(o.parse({ a: 'x', b: 2, c: null }), { ok: true, value: { a: 'x', b: 2, c: null } });
  const unknown = o.parse({ a: 'x', z: 1 });
  assert.ok(!unknown.ok && unknown.error.startsWith('z: campo no permitido'));
  const missing = o.parse({});
  assert.ok(!missing.ok && missing.error === 'a: es obligatorio');
  assert.equal(o.parse({ a: 'x', toString: 1 }).ok, false);
  assert.deepEqual(o.json.required, ['a']);
  assert.equal(o.json.additionalProperties, false);
});

test('object with stripUnknown drops extra keys', () => {
  const o = object({ a: string() }, undefined, { stripUnknown: true });
  assert.deepEqual(o.parse({ a: 'x', extra: true }), { ok: true, value: { a: 'x' } });
});

test('enums, literals, booleans and arrays report the path', () => {
  assert.equal(enumOf(['a', 'b'] as const).parse('c').ok, false);
  assert.equal(intEnum([1, 2, 3] as const).parse(2).ok, true);
  assert.equal(literal('add').parse('add').ok, true);
  assert.equal(boolean().parse('true').ok, false);
  const arr = array(integer({ min: 0 }), { max: 2 });
  const r = arr.parse([1, -1], 'xs');
  assert.ok(!r.ok && r.error.startsWith('xs[1]'));
  assert.equal(arr.parse([1, 2, 3]).ok, false);
});

test('discriminated picks the variant by tag and rejects prototype keys', () => {
  const d = discriminated<{ op: 'x'; n: number } | { op: 'y' }>('op', {
    x: object({ op: literal('x'), n: integer() }),
    y: object({ op: literal('y') }),
  });
  assert.equal(d.parse({ op: 'x', n: 1 }).ok, true);
  assert.equal(d.parse({ op: 'y' }).ok, true);
  assert.equal(d.parse({ op: 'toString' }).ok, false);
  assert.equal(d.parse({ op: 'z' }).ok, false);
  assert.ok(Array.isArray(d.json.anyOf));
});

test('toStructuredOutputSchema strips unsupported keywords but keeps property names', () => {
  const o = object({ minimum: integer({ min: 1, max: 5 }), name: string({ min: 1, max: 3, pattern: /x/ }) });
  const out = toStructuredOutputSchema(o.json) as { properties: Record<string, Record<string, unknown>> };
  assert.ok('minimum' in out.properties, 'property literally named minimum survives');
  assert.equal(out.properties.minimum.minimum, undefined);
  assert.equal(out.properties.name.maxLength, undefined);
  assert.equal(out.properties.name.pattern, undefined);
  assert.equal(out.properties.name.type, 'string');
});
