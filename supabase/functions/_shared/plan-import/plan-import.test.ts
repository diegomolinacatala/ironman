import assert from 'node:assert/strict';
import test from 'node:test';
import { CoachAiError, messageText } from '../coach/ports.ts';
import type { ClaudeImageBlock, ClaudePort, ClaudeRequest, ClaudeResponse } from '../coach/ports.ts';
import { dropAddsInImportedWeeks } from '../coach/job.ts';
import { silentLogger } from '../log.ts';
import { usageRecorder } from '../testing/ai-fakes.ts';
import type { UsageRecorder } from '../testing/ai-fakes.ts';
import { claudeReturning } from '../testing/coach-fakes.ts';
import { USER, workout } from '../testing/fakes.ts';
import type { PlanChange } from '../types.ts';
import { handlePlanImportHttp, PLAN_CONSENT_MESSAGE, PLAN_IMPORT_DAILY_LIMIT, PLAN_IMPORT_FUNCTION } from './http.ts';
import type { PdfTextPort, PlanImportHttpDeps } from './http.ts';
import { PLAN_OUTPUT_JSON_SCHEMA, toPlanImportResponse } from './output.ts';
import { PLAN_IMPORT_SYSTEM_PROMPT } from './prompt.ts';
import { MAX_IMAGE_BASE64, MAX_TEXT, parsePlanImportRequest } from './request.ts';

const b64 = (s: string): string => btoa(s);
const JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01));
const PDF = b64('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');

const OUTPUT = {
  title: 'Plan 70.3',
  confidence: 'high',
  notes: ['La semana 3 está cortada'],
  sessions: [
    { week: 1, day: 1, date: null, sport: 'run', title: 'Rodaje Z2', duration_min: 45, distance_m: null, intensity: 'endurance', description: 'Suave', steps: [], confidence: 'high' },
    {
      week: 1,
      day: 3,
      date: null,
      sport: 'bike',
      title: 'Series',
      duration_min: 90,
      distance_m: null,
      intensity: 'threshold',
      description: null,
      steps: [
        { kind: 'warmup', duration_min: 15, distance_m: null, repeat: null, intensity: 'recovery' },
        { kind: 'work', duration_min: 10, distance_m: null, repeat: 3, intensity: 'threshold' },
        { kind: 'bogus', duration_min: null, distance_m: null, repeat: null, intensity: null },
      ],
      confidence: 'medium',
    },
    { week: 1, day: 6, date: null, sport: 'rest', title: 'Descanso', duration_min: null, distance_m: null, intensity: null, description: null, steps: [], confidence: 'high' },
    { week: 0, day: 9, date: null, sport: 'run', title: 'x', duration_min: 30, distance_m: null, intensity: null, description: null, steps: [], confidence: 'low' },
    { week: 2, day: 2, date: '2026-12-09', sport: 'swim', title: 'Técnica', duration_min: null, distance_m: 2000, intensity: 'zz', description: null, steps: [], confidence: 'odd' },
  ],
};

interface Harness {
  deps: PlanImportHttpDeps;
  usage: UsageRecorder;
  text: ClaudeRequest[];
  vision: ClaudeRequest[];
  pdfCalls: number;
}

function harness(
  opts: { response?: Partial<ClaudeResponse> | Error; consentAt?: string | null; used?: number; pdfText?: string | Error; noAi?: boolean } = {},
): Harness {
  const text: ClaudeRequest[] = [];
  const vision: ClaudeRequest[] = [];
  const usage = usageRecorder({ consentAt: opts.consentAt, used: opts.used, functionName: PLAN_IMPORT_FUNCTION });
  const response = opts.response ?? { text: JSON.stringify(OUTPUT) };
  const h: Harness = { deps: undefined as unknown as PlanImportHttpDeps, usage, text, vision, pdfCalls: 0 };
  const pdfText: PdfTextPort = async () => {
    h.pdfCalls += 1;
    if (opts.pdfText instanceof Error) throw opts.pdfText;
    return { pages: 2, text: opts.pdfText ?? 'Semana 1\nLunes: rodaje 45 minutos en zona 2\nJueves: bici 1h30 con series' };
  };
  const port = (seen: ClaudeRequest[]): ClaudePort | null => (opts.noAi ? null : claudeReturning(response, seen));
  h.deps = {
    authenticate: async (req) => (req.headers.get('authorization') === 'Bearer good' ? USER : null),
    usage: usage.store,
    text: port(text),
    vision: port(vision),
    pdfText,
    logger: silentLogger,
  };
  return h;
}

const post = (body: unknown, auth = 'Bearer good'): Request =>
  new Request('https://x.supabase.co/functions/v1/plan-import', {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('plan-import request: kinds, limits and magic bytes', () => {
  assert.equal(parsePlanImportRequest({ kind: 'text', text: 'Lunes rodaje' }).ok, true);
  const image = parsePlanImportRequest({ kind: 'image', imageBase64: `data:image/jpeg;base64,${JPEG}` });
  assert.ok(image.ok && image.value.kind === 'image' && image.value.image.mediaType === 'image/jpeg');
  const pdf = parsePlanImportRequest({ kind: 'pdf', pdfBase64: PDF });
  assert.ok(pdf.ok && pdf.value.kind === 'pdf' && pdf.value.pdf[0] === 0x25);
  for (const bad of [null, [], {}, { kind: 'text', text: '  ' }, { kind: 'image', imageBase64: PDF }, { kind: 'pdf', pdfBase64: JPEG }, { kind: 'pdf', pdfBase64: '%%' }, { kind: 'xls' }]) {
    const r = parsePlanImportRequest(bad);
    assert.ok(!r.ok && r.status === 400, JSON.stringify(bad));
  }
  const long = parsePlanImportRequest({ kind: 'text', text: 'x'.repeat(MAX_TEXT + 1) });
  assert.ok(!long.ok && long.status === 413);
  const big = parsePlanImportRequest({ kind: 'image', imageBase64: JPEG + 'A'.repeat(MAX_IMAGE_BASE64) });
  assert.ok(!big.ok && big.status === 413);
});

test('plan-import output: enums, bounds, rest days and bad rows dropped; steps cleaned', () => {
  const out = toPlanImportResponse(OUTPUT);
  assert.equal(out.engine, 'ai');
  assert.equal(out.title, 'Plan 70.3');
  assert.deepEqual(out.warnings, ['La semana 3 está cortada']);
  assert.equal(out.sessions.length, 3);
  assert.deepEqual(out.sessions[0], {
    week: 1,
    day: 1,
    sport: 'run',
    title: 'Rodaje Z2',
    durationMin: 45,
    distanceM: null,
    intensity: 'endurance',
    description: 'Suave',
    steps: [],
    confidence: 'high',
  });
  assert.deepEqual(out.sessions[1]?.steps, [
    { kind: 'warmup', durationMin: 15, intensity: 'recovery' },
    { kind: 'work', durationMin: 10, repeat: 3, intensity: 'threshold' },
  ]);
  assert.deepEqual(out.sessions[2], {
    sourceDate: '2026-12-09',
    sport: 'swim',
    title: 'Técnica',
    durationMin: null,
    distanceM: 2000,
    intensity: null,
    description: null,
    steps: [],
    confidence: 'medium',
  });
  assert.throws(() => toPlanImportResponse({ title: 'x' }), (e: unknown) => e instanceof CoachAiError && e.code === 'bad_output');
  assert.equal((PLAN_OUTPUT_JSON_SCHEMA as { type: string }).type, 'object');
});

test('plan-import HTTP: text goes to the text model with the system prompt and schema', async () => {
  const h = harness();
  const res = await handlePlanImportHttp(post({ kind: 'text', text: 'Semana 1\nLunes: rodaje 45' }), h.deps);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { sessions: unknown[]; engine: string };
  assert.equal(body.engine, 'ai');
  assert.equal(body.sessions.length, 3);
  assert.equal(h.vision.length, 0);
  const req = h.text[0];
  assert.ok(req);
  assert.equal(req.system, PLAN_IMPORT_SYSTEM_PROMPT);
  assert.equal(req.schema, PLAN_OUTPUT_JSON_SCHEMA);
  assert.equal(req.effort, 'low');
  assert.match(messageText(req.messages[0]!), /Lunes: rodaje 45/);
  assert.equal(h.usage.rows.length, 1);
  assert.equal(h.usage.rows[0]?.model, 'claude-opus-5-5');
});

test('plan-import HTTP: photos go to the vision model, image block first', async () => {
  const h = harness();
  const res = await handlePlanImportHttp(post({ kind: 'image', imageBase64: JPEG }), h.deps);
  assert.equal(res.status, 200);
  assert.equal(h.text.length, 0);
  const content = h.vision[0]?.messages[0]?.content;
  assert.ok(Array.isArray(content));
  assert.equal((content[0] as ClaudeImageBlock).type, 'image');
  assert.equal((content[0] as ClaudeImageBlock).mediaType, 'image/jpeg');
});

test('plan-import HTTP: PDF text is extracted before the usage reservation; scans and broken files cost nothing', async () => {
  const ok = harness();
  const res = await handlePlanImportHttp(post({ kind: 'pdf', pdfBase64: PDF }), ok.deps);
  assert.equal(res.status, 200);
  assert.equal(ok.pdfCalls, 1);
  assert.match(messageText(ok.text[0]!.messages[0]!), /Plan de entrenamiento \(PDF\)[\s\S]*rodaje 45 minutos/);

  const scan = harness({ pdfText: '   \n  12  ' });
  const scanned = await handlePlanImportHttp(post({ kind: 'pdf', pdfBase64: PDF }), scan.deps);
  assert.equal(scanned.status, 422);
  assert.equal(((await scanned.json()) as { error: string }).error, 'scanned_pdf');
  assert.equal(scan.usage.rows.length, 0);
  assert.equal(scan.text.length, 0);

  const broken = harness({ pdfText: new Error('Invalid PDF structure') });
  const bad = await handlePlanImportHttp(post({ kind: 'pdf', pdfBase64: PDF }), broken.deps);
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { message: string }).message, /contraseña/);
  assert.equal(broken.usage.rows.length, 0);
});

test('plan-import HTTP: auth, consent, daily limit, no AI and AI failures', async () => {
  const h = harness();
  assert.equal((await handlePlanImportHttp(post({ kind: 'text', text: 'x' }, 'Bearer bad'), h.deps)).status, 401);
  assert.equal((await handlePlanImportHttp(new Request('https://x/plan-import', { method: 'GET' }), h.deps)).status, 405);
  assert.equal((await handlePlanImportHttp(post({ kind: 'nope' }), h.deps)).status, 400);

  const noConsent = harness({ consentAt: null });
  const consent = await handlePlanImportHttp(post({ kind: 'text', text: 'x' }), noConsent.deps);
  assert.equal(consent.status, 403);
  assert.equal(((await consent.json()) as { message: string }).message, PLAN_CONSENT_MESSAGE);

  const limited = harness({ used: PLAN_IMPORT_DAILY_LIMIT });
  assert.equal((await handlePlanImportHttp(post({ kind: 'text', text: 'x' }), limited.deps)).status, 429);

  const none = harness({ noAi: true });
  const unavailable = await handlePlanImportHttp(post({ kind: 'text', text: 'x' }), none.deps);
  assert.equal(unavailable.status, 503);
  assert.equal(none.usage.rows.length, 0);

  const failing = harness({ response: new CoachAiError('timeout', 'lento') });
  const failed = await handlePlanImportHttp(post({ kind: 'text', text: 'x' }), failing.deps);
  assert.equal(failed.status, 503);
  assert.equal(((await failed.json()) as { error: string }).error, 'ai_unavailable');

  const garbage = harness({ response: { text: 'no es json' } });
  assert.equal((await handlePlanImportHttp(post({ kind: 'text', text: 'x' }), garbage.deps)).status, 503);
  const cut = harness({ response: { text: '{', stopReason: 'max_tokens' } });
  assert.equal((await handlePlanImportHttp(post({ kind: 'text', text: 'x' }), cut.deps)).status, 503);
});

test('coach plan_week never adds on top of an imported week', () => {
  const workouts = [
    workout({ id: 'w-imp', date: '2026-10-28', sport: 'run', source: 'imported' }),
    workout({ id: 'w-old', date: '2026-11-04', sport: 'run', source: 'imported', status: 'skipped' }),
  ];
  const add = (date: string): PlanChange => ({ op: 'add', workout: { date, sport: 'bike', title: 'Bici', durationMin: 60, intensity: 'endurance' }, reason: 'r' });
  const move: PlanChange = { op: 'move', workoutId: 'w-imp', toDate: '2026-10-29', reason: 'lluvia' };
  const result = dropAddsInImportedWeeks([add('2026-10-30'), add('2026-11-05'), move], workouts);
  assert.equal(result.dropped, 1);
  assert.deepEqual(result.changes, [add('2026-11-05'), move]);
});
