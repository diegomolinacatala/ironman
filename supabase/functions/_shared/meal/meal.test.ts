import assert from 'node:assert/strict';
import test from 'node:test';
import { CoachAiError, messageText } from '../coach/ports.ts';
import type { ClaudeImageBlock, ClaudePort, ClaudeRequest, ClaudeResponse } from '../coach/ports.ts';
import { silentLogger } from '../log.ts';
import { usageRecorder } from '../testing/ai-fakes.ts';
import type { UsageRecorder } from '../testing/ai-fakes.ts';
import { claudeReturning } from '../testing/coach-fakes.ts';
import { emptyState, fakeStore, fixedNow, USER, workout } from '../testing/fakes.ts';
import { handleMealHttp, MEAL_CONSENT_MESSAGE, MEAL_DAILY_LIMIT } from './http.ts';
import type { MealHttpDeps } from './http.ts';
import { MEAL_OUTPUT_JSON_SCHEMA, macrosMismatch, mealSlotFromTime, toMealAnalysis } from './output.ts';
import { MEAL_SYSTEM_PROMPT } from './prompt.ts';
import { MAX_IMAGE_BASE64, parseMealRequest } from './request.ts';

const bytesToBase64 = (bytes: number[]): string => btoa(String.fromCharCode(...bytes));
const JPEG = bytesToBase64([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00]);
const PNG = bytesToBase64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const GIF = bytesToBase64([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00]);

const OUTPUT = {
  meal: 'lunch',
  description: 'Pasta con atún y tomate',
  items: ['Pasta cocida · 250 g', 'Atún en aceite escurrido · 60 g', 'Tomate frito · 50 g'],
  kcal: 720,
  carbs_g: 95,
  protein_g: 38,
  fat_g: 18,
  confidence: 'medium',
  tip: 'Buen plato para recargar antes de la bici de esta tarde.',
};

interface Harness {
  deps: MealHttpDeps;
  usage: UsageRecorder;
  seen: ClaudeRequest[];
}

function harness(opts: { claude?: ClaudePort | null; response?: Partial<ClaudeResponse> | Error; consentAt?: string | null; used?: number } = {}): Harness {
  const state = emptyState();
  state.workouts.push(
    workout({ date: '2026-10-24', sport: 'bike', title: 'Rodillo Z2', startTime: '18:00', durationMin: 75 }),
    workout({ date: '2026-10-25', sport: 'run', title: 'Tirada larga', durationMin: 100 }),
  );
  const seen: ClaudeRequest[] = [];
  const usage = usageRecorder({ consentAt: opts.consentAt, used: opts.used, functionName: 'meal' });
  const claude = opts.claude === undefined ? claudeReturning(opts.response ?? { text: JSON.stringify(OUTPUT) }, seen) : opts.claude;
  return {
    deps: {
      authenticate: async (req) => (req.headers.get('authorization') === 'Bearer good' ? USER : null),
      reader: fakeStore(state),
      usage: usage.store,
      claude,
      now: fixedNow,
      logger: silentLogger,
    },
    usage,
    seen,
  };
}

const post = (body: unknown, auth = 'Bearer good'): Request =>
  new Request('https://x.supabase.co/functions/v1/meal', {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const base = { date: '2026-10-24', time: '14:10' };

test('meal request: date/time formats, photo or text required, JPEG/PNG only, data: prefix tolerated', () => {
  assert.equal(parseMealRequest({ ...base, imageBase64: JPEG }).ok, true);
  assert.equal(parseMealRequest({ ...base, text: 'Lentejas' }).ok, true);
  const withPrefix = parseMealRequest({ ...base, imageBase64: `data:image/jpeg;base64,${JPEG}` });
  assert.ok(withPrefix.ok && withPrefix.value.image?.base64 === JPEG && withPrefix.value.image.mediaType === 'image/jpeg');
  const png = parseMealRequest({ ...base, imageBase64: PNG });
  assert.ok(png.ok && png.value.image?.mediaType === 'image/png');
  const cases: unknown[] = [
    base,
    { ...base, text: '   ' },
    { ...base, date: '2026-02-30', text: 'x' },
    { ...base, date: '24/10/2026', text: 'x' },
    { ...base, time: '25:00', text: 'x' },
    { ...base, time: '9:30', text: 'x' },
    { ...base, imageBase64: GIF },
    { ...base, imageBase64: '%%%not-base64%%%' },
    { ...base, text: 'x'.repeat(1001) },
  ];
  for (const input of cases) {
    const parsed = parseMealRequest(input);
    assert.ok(!parsed.ok && parsed.status === 400, JSON.stringify(input).slice(0, 80));
  }
  const big = parseMealRequest({ ...base, imageBase64: JPEG + 'A'.repeat(MAX_IMAGE_BASE64) });
  assert.ok(!big.ok && big.status === 413);
});

test('meal HTTP: 413 too_large for photos over 2 MB (also when the body itself is too big)', async () => {
  const h = harness();
  const res = await handleMealHttp(post({ ...base, imageBase64: JPEG + 'A'.repeat(MAX_IMAGE_BASE64) }), h.deps);
  assert.equal(res.status, 413);
  assert.equal(((await res.json()) as { error: string }).error, 'too_large');
  const huge = await handleMealHttp(post({ ...base, imageBase64: JPEG + 'A'.repeat(MAX_IMAGE_BASE64 + 100_000) }), h.deps);
  assert.equal(huge.status, 413);
  assert.equal(((await huge.json()) as { error: string }).error, 'too_large');
  assert.equal(h.seen.length, 0);
});

test('meal HTTP: photo analysis sends an image block first, effort low, today’s workouts only', async () => {
  const h = harness();
  const res = await handleMealHttp(post({ ...base, imageBase64: JPEG, text: 'plato grande' }), h.deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    meal: 'lunch',
    description: 'Pasta con atún y tomate',
    items: OUTPUT.items,
    kcal: 720,
    carbsG: 95,
    proteinG: 38,
    fatG: 18,
    confidence: 'medium',
    tip: OUTPUT.tip,
    engine: 'ai',
  });
  const req = h.seen[0];
  assert.equal(req.effort, 'low');
  assert.equal(req.system, MEAL_SYSTEM_PROMPT);
  assert.equal(req.schema, MEAL_OUTPUT_JSON_SCHEMA);
  const content = req.messages[0].content;
  assert.ok(Array.isArray(content));
  const image = content[0] as ClaudeImageBlock;
  assert.deepEqual({ type: image.type, mediaType: image.mediaType, base64: image.base64 }, { type: 'image', mediaType: 'image/jpeg', base64: JPEG });
  const text = messageText(req.messages[0]);
  assert.match(text, /a las 14:10 \(franja probable por la hora: comida\)/);
  assert.match(text, /plato grande/);
  assert.ok(text.includes('Rodillo Z2'));
  assert.ok(!text.includes('Tirada larga'), 'only today');
  assert.deepEqual(h.usage.rows.map((r) => [r.functionName, r.model]), [['meal', 'claude-opus-5-5']]);
  assert.equal(req.userId, USER, 'the user id travels with the request (hashed by the Workers adapter)');
});

test('meal HTTP: a text-only description works without an image block', async () => {
  const h = harness();
  const res = await handleMealHttp(post({ ...base, time: '21:30', text: 'Tortilla de patatas y ensalada' }), h.deps);
  assert.equal(res.status, 200);
  const content = h.seen[0].messages[0].content;
  assert.ok(Array.isArray(content) && content.length === 1 && content[0].type === 'text');
  assert.match(messageText(h.seen[0].messages[0]), /No hay foto/);
});

test('meal HTTP: 401, 403 consent, 429 after 40 analyses, 503 without key or on AI failure', async () => {
  assert.equal((await handleMealHttp(post({ ...base, text: 'x' }, 'Bearer nope'), harness().deps)).status, 401);
  assert.equal((await handleMealHttp(new Request('https://x/meal', { method: 'PUT' }), harness().deps)).status, 405);
  const noConsent = harness({ consentAt: null });
  const denied = await handleMealHttp(post({ ...base, text: 'x' }), noConsent.deps);
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: 'consent_required', message: MEAL_CONSENT_MESSAGE });
  const full = harness({ used: MEAL_DAILY_LIMIT });
  assert.equal((await handleMealHttp(post({ ...base, text: 'x' }), full.deps)).status, 429);
  assert.equal(full.seen.length, 0);
  const noKey = await handleMealHttp(post({ ...base, text: 'x' }), harness({ claude: null }).deps);
  assert.equal(noKey.status, 503);
  for (const response of [new CoachAiError('overloaded', 'x'), { stopReason: 'refusal' }, { text: 'no json' }, { text: JSON.stringify({ ...OUTPUT, description: '' }) }]) {
    const h = harness({ response });
    const res = await handleMealHttp(post({ ...base, text: 'x' }), h.deps);
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { error: string }).error, 'ai_unavailable');
  }
});

test('meal output: macros clamped to sane integers, kcal from macros, slot from time, short tip', () => {
  const analysis = toMealAnalysis(
    {
      meal: 'brunch',
      description: '**Bocadillo** de jamón 🥪',
      items: ['  Pan · 120 g ', 7, '', 'x'.repeat(200), ...Array.from({ length: 20 }, (_, i) => `Item ${i}`)],
      kcal: 99999,
      carbs_g: 70.6,
      protein_g: 30,
      fat_g: -5,
      confidence: 'sure',
      tip: 'Un consejo larguísimo '.repeat(20),
    },
    '10:30',
  );
  assert.equal(analysis.meal, 'breakfast');
  assert.equal(analysis.description, 'Bocadillo de jamón');
  assert.equal(analysis.items[0], 'Pan · 120 g');
  assert.ok(analysis.items.every((i) => i.length <= 80));
  assert.equal(analysis.items.length, 12);
  assert.equal(analysis.kcal, null, 'out of range and no complete macros');
  assert.equal(analysis.carbsG, 71);
  assert.equal(analysis.fatG, null);
  assert.equal(analysis.confidence, 'low');
  assert.ok(analysis.tip !== null && analysis.tip.length <= 140);
  const computed = toMealAnalysis({ ...OUTPUT, kcal: null }, '14:00');
  assert.equal(computed.kcal, 4 * 95 + 4 * 38 + 9 * 18);
  assert.equal(toMealAnalysis({ ...OUTPUT, tip: '  ' }, '14:00').tip, null);
  assert.throws(() => toMealAnalysis({ ...OUTPUT, description: 7 }, '14:00'), CoachAiError);
});

test('meal slot from the time of day (Spanish meal times)', () => {
  const table: [string, string][] = [
    ['07:45', 'breakfast'],
    ['11:30', 'snack'],
    ['14:30', 'lunch'],
    ['18:00', 'snack'],
    ['21:45', 'dinner'],
    ['02:00', 'snack'],
  ];
  for (const [time, slot] of table) assert.equal(mealSlotFromTime(time), slot, time);
  const schema = MEAL_OUTPUT_JSON_SCHEMA as { required: string[] };
  assert.deepEqual(schema.required, ['meal', 'description', 'items', 'kcal', 'carbs_g', 'protein_g', 'fat_g', 'confidence', 'tip']);
  assert.ok(!JSON.stringify(schema).includes('minLength'));
});

test('meal output: contradictory kcal vs macros are kept but flagged low; "°" separators are fixed', () => {
  // 300 g "carbs" for a 400 kcal pasta plate: the model gave the food weight as carbs.
  const out = toMealAnalysis(
    { meal: 'lunch', description: 'Pasta con tomate', items: ['Pasta cocida ° 250 g'], kcal: 400, carbs_g: 300, protein_g: 15, fat_g: 10, confidence: 'high', tip: null },
    '14:10',
  );
  assert.equal(out.confidence, 'low');
  assert.equal(out.carbsG, 300);
  assert.deepEqual(out.items, ['Pasta cocida · 250 g']);
  assert.equal(macrosMismatch(720, 4 * 95 + 4 * 38 + 9 * 18), false);
  assert.equal(macrosMismatch(400, 1350), true);
  assert.equal(macrosMismatch(null, 1350), false);
});
