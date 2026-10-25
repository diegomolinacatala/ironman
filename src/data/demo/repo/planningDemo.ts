import type {
  BusyBlock,
  BusyBlockDraft,
  DateRange,
  LifeEvent,
  LifeEventDraft,
  Profile,
  ProfilePatch,
  Race,
  RaceDraft,
  UUID,
} from '@/domain/types';

import { RepositoryError, type Repository } from '../../repository';
import { localDayEndIso, localDayStartIso } from '../../supabase/base';
import { MESSAGES } from '../../supabase/errors';
import { feedForRace } from '../events';
import { USERNAME_HELP, USERNAME_RE, assertBusyDraft, assertLifeEventDates } from '../validation';
import { notFound, requireMe, type DemoDeps } from './common';

type PlanningMethods = Pick<
  Repository,
  | 'getMyProfile'
  | 'upsertMyProfile'
  | 'isUsernameAvailable'
  | 'listRaces'
  | 'createRace'
  | 'updateRace'
  | 'deleteRace'
  | 'listLifeEvents'
  | 'createLifeEvent'
  | 'updateLifeEvent'
  | 'deleteLifeEvent'
  | 'listBusyBlocks'
  | 'replaceBusyBlocks'
  | 'createBusyBlock'
  | 'deleteBusyBlock'
>;

function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function overlapsRange(b: Pick<BusyBlock, 'start' | 'end'>, range: DateRange): boolean {
  return Date.parse(b.start) < Date.parse(localDayEndIso(range.to)) && Date.parse(b.end) > Date.parse(localDayStartIso(range.from));
}

function profileMethods({ store }: DemoDeps): Pick<Repository, 'getMyProfile' | 'upsertMyProfile' | 'isUsernameAvailable'> {
  return {
    async getMyProfile(): Promise<Profile | null> {
      const me = await requireMe(store);
      return (await store.read()).profiles.find((p) => p.id === me) ?? null;
    },
    async upsertMyProfile(patch: ProfilePatch): Promise<Profile> {
      const me = await requireMe(store);
      const username = patch.username?.trim().toLowerCase();
      if (username !== undefined && !USERNAME_RE.test(username)) throw new RepositoryError('validation', USERNAME_HELP);
      return store.update((db) => {
        const current = db.profiles.find((p) => p.id === me);
        if (!current) throw notFound('No encontramos tu perfil. Cierra sesión y vuelve a entrar.');
        if (username && db.profiles.some((p) => p.id !== me && p.username === username)) {
          throw new RepositoryError('conflict', MESSAGES.usernameTaken);
        }
        const updated: Profile = {
          ...current,
          ...definedOnly(patch),
          ...(username ? { username } : {}),
          ...(patch.displayName !== undefined ? { displayName: patch.displayName.trim() || current.displayName } : {}),
        };
        return { db: { ...db, profiles: db.profiles.map((p) => (p.id === me ? updated : p)) }, result: updated };
      });
    },
    async isUsernameAvailable(username: string): Promise<boolean> {
      const wanted = username.trim().toLowerCase();
      if (!USERNAME_RE.test(wanted)) return false;
      const me = await requireMe(store);
      return !(await store.read()).profiles.some((p) => p.id !== me && p.username === wanted);
    },
  };
}

function raceMethods({ store }: DemoDeps): Pick<Repository, 'listRaces' | 'createRace' | 'updateRace' | 'deleteRace'> {
  return {
    async listRaces(): Promise<Race[]> {
      const me = await requireMe(store);
      return (await store.read()).races.filter((r) => r.userId === me).sort((a, b) => a.date.localeCompare(b.date));
    },
    async createRace(draft: RaceDraft): Promise<Race> {
      const me = await requireMe(store);
      if (draft.name.trim().length === 0) throw new RepositoryError('validation', 'Ponle nombre a la carrera.');
      return store.update((db, clock) => {
        const race: Race = { location: null, goal: null, notes: null, ...draft, name: draft.name.trim(), id: clock.newId(), userId: me, createdAt: clock.now };
        const next = feedForRace({ ...db, races: [...db.races, race] }, race, clock);
        return { db: next, result: race };
      });
    },
    async updateRace(id: UUID, patch: Partial<RaceDraft>): Promise<Race> {
      const me = await requireMe(store);
      return store.update((db) => {
        const current = db.races.find((r) => r.id === id && r.userId === me);
        if (!current) throw notFound('Esa carrera ya no existe.');
        const updated: Race = { ...current, ...definedOnly(patch) };
        return { db: { ...db, races: db.races.map((r) => (r.id === id ? updated : r)) }, result: updated };
      });
    },
    async deleteRace(id: UUID): Promise<void> {
      const me = await requireMe(store);
      await store.update((db) => ({ db: { ...db, races: db.races.filter((r) => !(r.id === id && r.userId === me)) }, result: undefined }));
    },
  };
}

function lifeEventMethods(
  { store }: DemoDeps,
): Pick<Repository, 'listLifeEvents' | 'createLifeEvent' | 'updateLifeEvent' | 'deleteLifeEvent'> {
  return {
    async listLifeEvents(range: DateRange): Promise<LifeEvent[]> {
      const me = await requireMe(store);
      return (await store.read()).lifeEvents
        .filter((e) => e.userId === me && e.startDate <= range.to && e.endDate >= range.from)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    },
    async createLifeEvent(draft: LifeEventDraft): Promise<LifeEvent> {
      const endDate = draft.endDate ?? draft.startDate;
      assertLifeEventDates(draft.startDate, endDate);
      if (draft.title.trim().length === 0) throw new RepositoryError('validation', 'Ponle un título al imprevisto.');
      const me = await requireMe(store);
      return store.update((db, clock) => {
        const event: LifeEvent = {
          startTime: null,
          durationMin: null,
          bodyArea: null,
          notes: null,
          ...draft,
          title: draft.title.trim(),
          endDate,
          id: clock.newId(),
          userId: me,
          createdAt: clock.now,
        };
        return { db: { ...db, lifeEvents: [...db.lifeEvents, event] }, result: event };
      });
    },
    async updateLifeEvent(id: UUID, patch: Partial<LifeEventDraft>): Promise<LifeEvent> {
      const me = await requireMe(store);
      return store.update((db) => {
        const current = db.lifeEvents.find((e) => e.id === id && e.userId === me);
        if (!current) throw notFound('Ese imprevisto ya no existe.');
        const updated: LifeEvent = { ...current, ...definedOnly(patch) };
        assertLifeEventDates(updated.startDate, updated.endDate);
        return { db: { ...db, lifeEvents: db.lifeEvents.map((e) => (e.id === id ? updated : e)) }, result: updated };
      });
    },
    async deleteLifeEvent(id: UUID): Promise<void> {
      const me = await requireMe(store);
      await store.update((db) => ({ db: { ...db, lifeEvents: db.lifeEvents.filter((e) => !(e.id === id && e.userId === me)) }, result: undefined }));
    },
  };
}

function busyMethods(
  { store }: DemoDeps,
): Pick<Repository, 'listBusyBlocks' | 'replaceBusyBlocks' | 'createBusyBlock' | 'deleteBusyBlock'> {
  const toBlock = (d: BusyBlockDraft, userId: UUID, id: UUID): BusyBlock => ({
    id,
    userId,
    start: d.start,
    end: d.end,
    source: d.source,
    title: d.title ?? null,
    externalId: d.externalId ?? null,
  });
  return {
    async listBusyBlocks(range: DateRange): Promise<BusyBlock[]> {
      const me = await requireMe(store);
      return (await store.read()).busyBlocks
        .filter((b) => b.userId === me && overlapsRange(b, range))
        .sort((a, b) => a.start.localeCompare(b.start));
    },
    async replaceBusyBlocks(range, source, blocks): Promise<BusyBlock[]> {
      blocks.forEach(assertBusyDraft);
      const me = await requireMe(store);
      return store.update((db, clock) => {
        const created = blocks.map((b) => toBlock({ ...b, source }, me, clock.newId()));
        const kept = db.busyBlocks.filter((b) => !(b.userId === me && b.source === source && overlapsRange(b, range)));
        return { db: { ...db, busyBlocks: [...kept, ...created] }, result: created };
      });
    },
    async createBusyBlock(draft: BusyBlockDraft): Promise<BusyBlock> {
      assertBusyDraft(draft);
      const me = await requireMe(store);
      return store.update((db, clock) => {
        const block = toBlock(draft, me, clock.newId());
        return { db: { ...db, busyBlocks: [...db.busyBlocks, block] }, result: block };
      });
    },
    async deleteBusyBlock(id: UUID): Promise<void> {
      const me = await requireMe(store);
      await store.update((db) => ({ db: { ...db, busyBlocks: db.busyBlocks.filter((b) => !(b.id === id && b.userId === me)) }, result: undefined }));
    },
  };
}

export function planningDemo(deps: DemoDeps): PlanningMethods {
  return { ...profileMethods(deps), ...raceMethods(deps), ...lifeEventMethods(deps), ...busyMethods(deps) };
}
