/// <reference types="jest" />
import { createDemoRepository } from '../demo/DemoRepository';
import { DEMO_USERS } from '../demo/ids';
import { SUNDAY, resetStorage, signedInRepo } from './demoTestUtils';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(resetStorage);

describe('demo notifications', () => {
  it('marks some and then all notifications as read', async () => {
    const repo = await signedInRepo();
    const unread = (await repo.listNotifications()).filter((n) => n.readAt === null);
    expect(unread.length).toBeGreaterThanOrEqual(2);
    const [first, ...rest] = unread;
    await repo.markNotificationsRead([first?.id ?? '']);
    const afterOne = await repo.listNotifications();
    expect(afterOne.find((n) => n.id === first?.id)?.readAt).not.toBeNull();
    expect(afterOne.filter((n) => n.readAt === null)).toHaveLength(rest.length);
    await repo.markNotificationsRead('all');
    expect((await repo.listNotifications()).every((n) => n.readAt !== null)).toBe(true);
    await repo.store.dispose();
  });

  it('AI/Claude proposals notify, rules proposals do not', async () => {
    const repo = await signedInRepo();
    const count = async () => (await repo.listNotifications()).filter((n) => n.type === 'plan_updated').length;
    const before = await count();
    await repo.createProposal({ kind: 'chat', source: 'rules', weekStart: '2026-10-26', summary: 'r', changes: [] });
    expect(await count()).toBe(before);
    await repo.createProposal({ kind: 'replan', source: 'claude', weekStart: '2026-10-26', summary: 'c', changes: [] });
    expect(await count()).toBe(before + 1);
    await repo.store.dispose();
  });
});

describe('demo personal tokens', () => {
  it('creates MCP and ICS links, lists and revokes them', async () => {
    const repo = await signedInRepo();
    const mcp = await repo.createToken('mcp', 'Mi Claude');
    expect(mcp.secret).toMatch(/^rb_[0-9a-f]{64}$/);
    expect(mcp.url.endsWith(`/mcp/u/${mcp.secret}`)).toBe(true);
    expect(mcp.token).toMatchObject({ scope: 'mcp', label: 'Mi Claude', prefix: mcp.secret.slice(0, 10), revokedAt: null });
    const ics = await repo.createToken('ics', 'Calendario');
    expect(ics.url.endsWith(`/ics/${ics.secret}.ics`)).toBe(true);

    const tokens = await repo.listTokens();
    expect(tokens.map((t) => t.id)).toEqual(expect.arrayContaining([mcp.token.id, ics.token.id]));
    expect(JSON.stringify(tokens)).not.toContain(mcp.secret);

    await repo.revokeToken(mcp.token.id);
    expect((await repo.listTokens()).find((t) => t.id === mcp.token.id)?.revokedAt).not.toBeNull();
    await repo.store.dispose();
  });

  it('limits active tokens per scope', async () => {
    const repo = await signedInRepo();
    for (let i = 0; i < 5; i += 1) await repo.createToken('mcp', `t${i}`);
    await expect(repo.createToken('mcp', 'sexto')).rejects.toMatchObject({ code: 'conflict' });
    await repo.store.dispose();
  });
});

describe('demo integrations', () => {
  it('connects, syncs and disconnects Garmin (simulated)', async () => {
    const repo = await signedInRepo();
    expect(await repo.listIntegrations()).toEqual([]);
    await expect(repo.syncGarmin()).rejects.toMatchObject({ code: 'validation' });
    const status = await repo.connectGarmin('demo-personal-api-key', '2027-01-01');
    expect(status).toMatchObject({ provider: 'garmin_personal', state: 'connected', expiresAt: '2027-01-01' });
    expect(status.lastSyncAt).not.toBeNull();
    const result = await repo.syncGarmin();
    expect(result.metricsDays).toBe(1);
    expect(result.message).toContain('demo');
    await repo.disconnectGarmin();
    expect(await repo.listIntegrations()).toEqual([]);
    await repo.store.dispose();
  });
});

describe('demo auth & persistence', () => {
  it('validates email and code', async () => {
    const repo = createDemoRepository({ now: () => SUNDAY, persistDebounceMs: 0 });
    await expect(repo.auth.sendEmailCode('no-es-un-email')).rejects.toMatchObject({ code: 'validation' });
    await expect(repo.auth.verifyEmailCode('diego@example.com', '123')).rejects.toMatchObject({ code: 'validation' });
    expect(await repo.auth.getSession()).toBeNull();
    await expect(repo.listRaces()).rejects.toMatchObject({ code: 'not_authenticated' });
    const apple = await repo.auth.signInWithApple();
    expect(apple.userId).toBe(DEMO_USERS.diego);
    await repo.store.dispose();
  });

  it('notifies auth listeners; sign out keeps data; delete account wipes it', async () => {
    const repo = await signedInRepo();
    const events: (string | null)[] = [];
    const unsubscribe = repo.auth.onAuthChange((s) => events.push(s?.userId ?? null));
    const created = await repo.createRace({ name: 'Sprint de prueba', date: '2026-12-01', distance: 'sprint', priority: 'C' });

    await repo.auth.signOut();
    expect(await repo.auth.getSession()).toBeNull();
    await repo.auth.verifyEmailCode('diego@example.com', '000000');
    expect((await repo.listRaces()).some((r) => r.id === created.id)).toBe(true);

    await repo.auth.deleteAccount();
    expect(await repo.auth.getSession()).toBeNull();
    await repo.auth.verifyEmailCode('diego@example.com', '000000');
    expect((await repo.listRaces()).some((r) => r.id === created.id)).toBe(false);
    expect(events).toEqual([null, DEMO_USERS.diego, null, DEMO_USERS.diego]);
    unsubscribe();
    await repo.store.dispose();
  });

  it('persists to AsyncStorage and restores in a new instance', async () => {
    const repo = await signedInRepo();
    const race = await repo.createRace({ name: 'Duatlón', date: '2027-02-14', distance: 'other', priority: 'C' });
    await repo.store.flush();

    const reopened = createDemoRepository({ now: () => SUNDAY, persistDebounceMs: 0 });
    expect((await reopened.auth.getSession())?.userId).toBe(DEMO_USERS.diego);
    expect((await reopened.listRaces()).some((r) => r.id === race.id)).toBe(true);
    await repo.store.dispose();
    await reopened.store.dispose();
  });

  it('rejects taken usernames and accepts free ones', async () => {
    const repo = await signedInRepo();
    expect(await repo.isUsernameAvailable('alex')).toBe(false);
    expect(await repo.isUsernameAvailable('diego')).toBe(true);
    expect(await repo.isUsernameAvailable('No Válido')).toBe(false);
    await expect(repo.upsertMyProfile({ username: 'alex' })).rejects.toMatchObject({ code: 'conflict' });
    const updated = await repo.upsertMyProfile({ username: 'diego.tri', displayName: 'Diego M.' });
    expect(updated).toMatchObject({ username: 'diego.tri', displayName: 'Diego M.' });
    await repo.store.dispose();
  });
});
