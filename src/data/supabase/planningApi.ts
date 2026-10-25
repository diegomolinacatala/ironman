import type {
  BusyBlock,
  BusyBlockDraft,
  DateRange,
  LifeEvent,
  LifeEventDraft,
  Race,
  RaceDraft,
  UUID,
} from '@/domain/types';

import type { Repository } from '../repository';
import { assertBusyDraft, assertLifeEventDates } from '../demo/validation';
import { localDayEndIso, localDayStartIso, run, runOne, runVoid, type SupabaseCtx } from './base';
import {
  busyBlockDraftToInsert,
  lifeEventDraftToInsert,
  lifeEventPatchToRow,
  raceDraftToInsert,
  racePatchToRow,
  rowToBusyBlock,
  rowToLifeEvent,
  rowToRace,
} from './mappers';
import type { BusyBlockRow, LifeEventRow, RaceRow } from './rows';

type PlanningMethods = Pick<
  Repository,
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

function racesApi(ctx: SupabaseCtx): Pick<Repository, 'listRaces' | 'createRace' | 'updateRace' | 'deleteRace'> {
  const { client } = ctx;
  return {
    async listRaces(): Promise<Race[]> {
      const me = await ctx.userId();
      const rows = await run<RaceRow[] | null>(
        'listRaces',
        client.from('races').select('*').eq('user_id', me).order('date', { ascending: true }),
      );
      return (rows ?? []).map(rowToRace);
    },
    async createRace(draft: RaceDraft): Promise<Race> {
      const me = await ctx.userId();
      const row = await runOne<RaceRow>(
        'createRace',
        client.from('races').insert(raceDraftToInsert(draft, me)).select('*').single(),
        'No se ha podido guardar la carrera.',
      );
      return rowToRace(row);
    },
    async updateRace(id: UUID, patch: Partial<RaceDraft>): Promise<Race> {
      const row = await runOne<RaceRow>(
        'updateRace',
        client.from('races').update({ ...racePatchToRow(patch), updated_at: ctx.now() }).eq('id', id).select('*').maybeSingle(),
        'Esa carrera ya no existe.',
      );
      return rowToRace(row);
    },
    async deleteRace(id: UUID): Promise<void> {
      await runVoid('deleteRace', client.from('races').delete().eq('id', id));
    },
  };
}

function lifeEventsApi(
  ctx: SupabaseCtx,
): Pick<Repository, 'listLifeEvents' | 'createLifeEvent' | 'updateLifeEvent' | 'deleteLifeEvent'> {
  const { client } = ctx;
  return {
    async listLifeEvents(range: DateRange): Promise<LifeEvent[]> {
      const me = await ctx.userId();
      const rows = await run<LifeEventRow[] | null>(
        'listLifeEvents',
        client
          .from('life_events')
          .select('*')
          .eq('user_id', me)
          .lte('start_date', range.to)
          .gte('end_date', range.from)
          .order('start_date', { ascending: true }),
      );
      return (rows ?? []).map(rowToLifeEvent);
    },
    async createLifeEvent(draft: LifeEventDraft): Promise<LifeEvent> {
      assertLifeEventDates(draft.startDate, draft.endDate ?? draft.startDate);
      const me = await ctx.userId();
      const row = await runOne<LifeEventRow>(
        'createLifeEvent',
        client.from('life_events').insert(lifeEventDraftToInsert(draft, me)).select('*').single(),
        'No se ha podido guardar el imprevisto.',
      );
      return rowToLifeEvent(row);
    },
    async updateLifeEvent(id: UUID, patch: Partial<LifeEventDraft>): Promise<LifeEvent> {
      if (patch.startDate && patch.endDate) assertLifeEventDates(patch.startDate, patch.endDate);
      const row = await runOne<LifeEventRow>(
        'updateLifeEvent',
        client
          .from('life_events')
          .update({ ...lifeEventPatchToRow(patch), updated_at: ctx.now() })
          .eq('id', id)
          .select('*')
          .maybeSingle(),
        'Ese imprevisto ya no existe.',
      );
      return rowToLifeEvent(row);
    },
    async deleteLifeEvent(id: UUID): Promise<void> {
      await runVoid('deleteLifeEvent', client.from('life_events').delete().eq('id', id));
    },
  };
}

function busyBlocksApi(
  ctx: SupabaseCtx,
): Pick<Repository, 'listBusyBlocks' | 'replaceBusyBlocks' | 'createBusyBlock' | 'deleteBusyBlock'> {
  const { client } = ctx;

  async function listBusyBlocks(range: DateRange): Promise<BusyBlock[]> {
    const me = await ctx.userId();
    const rows = await run<BusyBlockRow[] | null>(
      'listBusyBlocks',
      client
        .from('busy_blocks')
        .select('*')
        .eq('user_id', me)
        .lt('starts_at', localDayEndIso(range.to))
        .gt('ends_at', localDayStartIso(range.from))
        .order('starts_at', { ascending: true }),
    );
    return (rows ?? []).map(rowToBusyBlock);
  }

  async function replaceBusyBlocks(
    range: DateRange,
    source: BusyBlockDraft['source'],
    blocks: BusyBlockDraft[],
  ): Promise<BusyBlock[]> {
    blocks.forEach(assertBusyDraft);
    const me = await ctx.userId();
    await runVoid(
      'replaceBusyBlocks.delete',
      client
        .from('busy_blocks')
        .delete()
        .eq('user_id', me)
        .eq('source', source)
        .lt('starts_at', localDayEndIso(range.to))
        .gt('ends_at', localDayStartIso(range.from)),
    );
    if (blocks.length === 0) return [];
    const rows = await run<BusyBlockRow[] | null>(
      'replaceBusyBlocks.insert',
      client
        .from('busy_blocks')
        .insert(blocks.map((b) => busyBlockDraftToInsert({ ...b, source }, me)))
        .select('*'),
    );
    return (rows ?? []).map(rowToBusyBlock);
  }

  async function createBusyBlock(draft: BusyBlockDraft): Promise<BusyBlock> {
    assertBusyDraft(draft);
    const me = await ctx.userId();
    const row = await runOne<BusyBlockRow>(
      'createBusyBlock',
      client.from('busy_blocks').insert(busyBlockDraftToInsert(draft, me)).select('*').single(),
      'No se ha podido guardar el bloque.',
    );
    return rowToBusyBlock(row);
  }

  async function deleteBusyBlock(id: UUID): Promise<void> {
    await runVoid('deleteBusyBlock', client.from('busy_blocks').delete().eq('id', id));
  }

  return { listBusyBlocks, replaceBusyBlocks, createBusyBlock, deleteBusyBlock };
}

export function planningApi(ctx: SupabaseCtx): PlanningMethods {
  return { ...racesApi(ctx), ...lifeEventsApi(ctx), ...busyBlocksApi(ctx) };
}
