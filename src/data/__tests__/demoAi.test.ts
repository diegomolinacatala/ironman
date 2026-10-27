/// <reference types="jest" />
import { createDemoRepository } from '../demo/DemoRepository';
import { DEMO_TOKEN_NOTE } from '../demo/repo/integrationsDemo';
import { NO_DELAYS, SUNDAY, resetStorage, signedInRepo } from './demoTestUtils';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(resetStorage);

const TODAY = '2026-10-25';

async function clockRepo(start: Date = SUNDAY) {
  let current = start;
  const repo = createDemoRepository({ now: () => current, persistDebounceMs: 0, friendDelayMs: 30, delays: NO_DELAYS });
  await repo.auth.verifyEmailCode('diego@example.com', '123456');
  return {
    repo,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

describe('demo morning briefing', () => {
  it('generates the briefing from the seed, stores it and returns it until refreshed', async () => {
    const { repo, advance } = await clockRepo();
    expect(await repo.getBriefing(TODAY)).toBeNull();
    const first = await repo.generateBriefing(TODAY);
    expect(first).toMatchObject({ date: TODAY, engine: 'rules', createdAt: SUNDAY.toISOString() });
    expect(first.sleep?.deepMin).toEqual(expect.any(Number));
    expect(first.sleep?.hrvBaselineMs).toEqual(expect.any(Number));
    expect(first.script).toMatch(/^Buenos días, Diego\./);
    expect(first.headline.length).toBeLessThanOrEqual(90);
    expect(await repo.getBriefing(TODAY)).toEqual(first);

    advance(60_000);
    expect(await repo.generateBriefing(TODAY)).toEqual(first);
    const refreshed = await repo.generateBriefing(TODAY, { refresh: true });
    expect(refreshed.createdAt).not.toBe(first.createdAt);
    expect(await repo.getBriefing(TODAY)).toEqual(refreshed);
    await expect(repo.getBriefing('hoy')).rejects.toMatchObject({ code: 'validation' });
    await repo.store.dispose();
  });

  it('re-syncs a stale Garmin connection first, like the server', async () => {
    const { repo, advance } = await clockRepo();
    await repo.connectGarmin('clave', null);
    advance(2 * 60 * 60_000);
    await repo.generateBriefing(TODAY);
    const [garmin] = await repo.listIntegrations();
    expect(garmin?.lastSyncAt).toBe(new Date(SUNDAY.getTime() + 2 * 60 * 60_000).toISOString());
    await repo.store.dispose();
  });

  it('takes ~aiMs to think', async () => {
    const repo = createDemoRepository({ now: () => SUNDAY, persistDebounceMs: 0, delays: { aiMs: 60 } });
    await repo.auth.verifyEmailCode('diego@example.com', '123456');
    const started = Date.now();
    await repo.generateBriefing(TODAY);
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    await repo.store.dispose();
  });
});

describe('demo meal analysis', () => {
  it('estimates a described meal locally', async () => {
    const repo = await signedInRepo();
    const result = await repo.analyzeMeal({ date: TODAY, time: '14:30', text: 'arroz con pollo' });
    expect(result).toMatchObject({ meal: 'lunch', engine: 'rules', confidence: 'low', items: ['Arroz cocido · 200 g', 'Pollo · 150 g'] });
    await repo.store.dispose();
  });

  it('"recognises" a plausible dish of the meal slot from a photo', async () => {
    const repo = await signedInRepo();
    const lunch = await repo.analyzeMeal({ date: TODAY, time: '14:30', imageBase64: 'aGVsbG8=' });
    expect(lunch).toMatchObject({ meal: 'lunch', description: 'Arroz con pollo y verduras', confidence: 'medium', engine: 'rules' });
    expect(lunch.kcal).toBeGreaterThan(0);
    const breakfast = await repo.analyzeMeal({ date: TODAY, time: '08:00', imageBase64: 'aGVsbG8=', text: 'algo rico' });
    expect(breakfast.description).toMatch(/Tostadas/);
    const post = await repo.analyzeMeal({ date: TODAY, time: '19:00', imageBase64: 'aGVsbG8=', text: 'después de entrenar' });
    expect(post).toMatchObject({ meal: 'post', description: 'Batido de proteína con leche y plátano' });
    await expect(repo.analyzeMeal({ date: TODAY, time: '14:30' })).rejects.toMatchObject({ code: 'validation' });
    await repo.store.dispose();
  });
});

describe('demo coach memory and imprevistos', () => {
  it('logs a pain mention as an injury once and says so', async () => {
    const repo = await signedInRepo();
    const response = await repo.requestCoach({ mode: 'chat', weekStart: '2026-10-19', message: 'Me he torcido el tobillo bajando una escalera', channel: 'voice' });
    expect(response.lifeEvent).toMatchObject({ kind: 'injury', severity: 2, bodyArea: 'ankle', title: 'Molestia en el tobillo', startDate: TODAY, endDate: '2026-10-27' });
    expect(response.memory).toEqual([]);
    expect(response.reply).toMatch(/^He apuntado «Molestia en el tobillo» en tus imprevistos\./);
    expect(response.reply).toContain('Ya lo tengo apuntado');
    expect(response.reply).toContain('profesional');
    const again = await repo.requestCoach({ mode: 'chat', weekStart: '2026-10-19', message: 'Sigue doliéndome el tobillo' });
    expect(again.lifeEvent?.id).toBe(response.lifeEvent?.id);
    const injuries = (await repo.listLifeEvents({ from: TODAY, to: TODAY })).filter((e) => e.kind === 'injury');
    expect(injuries).toHaveLength(1);
    await repo.store.dispose();
  });

  it('re-plans around the injury it just logged', async () => {
    const repo = await signedInRepo();
    const response = await repo.requestCoach({ mode: 'replan', weekStart: '2026-10-26', message: 'Me duele la rodilla' });
    expect(response.lifeEvent).toMatchObject({ bodyArea: 'knee' });
    expect(response.engine).toBe('rules');
    if (response.proposal) expect(response.proposal.kind).toBe('replan');
    await repo.store.dispose();
  });

  it('remembers explicit preferences in the coach notes', async () => {
    const repo = await signedInRepo();
    const response = await repo.requestCoach({ mode: 'chat', weekStart: '2026-10-19', message: 'Prefiero nadar por la mañana.' });
    expect(response.memory).toEqual(['Prefiere nadar por la mañana']);
    expect(response.lifeEvent).toBeNull();
    expect(response.reply).toMatch(/^Me apunto que prefieres nadar por la mañana\./);
    await repo.requestCoach({ mode: 'chat', weekStart: '2026-10-19', message: 'prefiero nadar por la mañana' });
    const notes = (await repo.getMyProfile())?.coachNotes ?? '';
    expect(notes.endsWith('\nPrefiere nadar por la mañana')).toBe(true);
    expect(notes.split('Prefiere nadar por la mañana')).toHaveLength(2);
    await repo.store.dispose();
  });

  it('answers ordinary messages without memory or imprevisto', async () => {
    const repo = await signedInRepo();
    const response = await repo.requestCoach({ mode: 'chat', weekStart: '2026-10-19', message: '¿Qué tal voy esta semana?' });
    expect(response).toMatchObject({ memory: [], lifeEvent: null, engine: 'rules' });
    await repo.store.dispose();
  });
});

describe('demo onboarding connections', () => {
  it('connects Garmin with any non-empty key and reports the first sync', async () => {
    const repo = await signedInRepo();
    await expect(repo.connectGarmin('   ', null)).rejects.toMatchObject({ code: 'validation' });
    const status = await repo.connectGarmin('abc', null);
    expect(status).toMatchObject({ state: 'connected', lastSyncAt: SUNDAY.toISOString() });
    const today = (await repo.listMetrics({ from: TODAY, to: TODAY })).find((m) => m.source === 'garmin');
    expect(today?.sleepStart).toEqual(expect.any(String));
    expect(today?.sleepRemMin).toEqual(expect.any(Number));
    await repo.store.dispose();
  });

  it('marks a new MCP token as used ~6 s later (claude.ai connected)', async () => {
    const { repo, advance } = await clockRepo();
    const created = await repo.createToken('mcp', 'Claude');
    expect(created.url).toContain('/mcp');
    expect(DEMO_TOKEN_NOTE).toMatch(/demo/);
    const ics = await repo.createToken('ics', 'Calendario');
    const revoked = await repo.createToken('mcp', 'Viejo');
    await repo.revokeToken(revoked.token.id);
    const before = await repo.listTokens();
    expect(before.find((t) => t.id === created.token.id)?.lastUsedAt).toBeNull();

    advance(5_000);
    expect((await repo.listTokens()).find((t) => t.id === created.token.id)?.lastUsedAt).toBeNull();
    advance(1_000);
    const after = await repo.listTokens();
    expect(after.find((t) => t.id === created.token.id)?.lastUsedAt).toBe(new Date(SUNDAY.getTime() + 6_000).toISOString());
    expect(after.find((t) => t.id === ics.token.id)?.lastUsedAt).toBeNull();
    expect(after.find((t) => t.id === revoked.token.id)?.lastUsedAt).toBeNull();
    await repo.store.dispose();
  });
});
