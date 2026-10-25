/** PlanningStore over supabase-js (service role). Every query is scoped to `userId`. */
import {
  asRow,
  assembleJointSessions,
  mapAcceptedFriends,
  mapBusyBlock,
  mapCheckin,
  mapFriendWeekItem,
  mapLifeEvent,
  mapMetrics,
  mapNutrition,
  mapProfile,
  mapRace,
  mapWorkout,
} from '../db/rows.ts';
import type { MetricsUpsert, PlanningStore, RaceWrite } from '../planning/store.ts';
import type { JointSession, UUID } from '../types.ts';
import { rowsOf, unwrap } from './db.ts';
import type { Db } from './db.ts';

const WORKOUT_COLS =
  'id,user_id,date,start_time,sport,title,description,duration_min,distance_m,intensity,tss,steps,status,completed,source,is_key,joint_session_id,external_id,created_at,updated_at';
const PROFILE_COLS = 'id,username,display_name,sports,level,thresholds,availability,visibility,notification_prefs,timezone,coach_notes';
const RACE_COLS = 'id,name,date,distance,priority,location,goal,notes';
const EVENT_COLS = 'id,kind,title,start_date,end_date,start_time,duration_min,severity,body_area,notes';
const METRIC_COLS = 'date,source,hrv_ms,resting_hr,sleep_hours,sleep_score,body_battery,training_readiness,vo2max,steps,stress_avg,training_status';

const METRIC_FIELDS: Record<string, string> = {
  hrvMs: 'hrv_ms',
  restingHr: 'resting_hr',
  sleepHours: 'sleep_hours',
  sleepScore: 'sleep_score',
  bodyBattery: 'body_battery',
  trainingReadiness: 'training_readiness',
  vo2max: 'vo2max',
  steps: 'steps',
  stressAvg: 'stress_avg',
  trainingStatus: 'training_status',
};

function metricsRow(userId: UUID, source: string, m: MetricsUpsert, nowIso: string): Record<string, unknown> {
  const fields = Object.fromEntries(
    Object.entries(METRIC_FIELDS)
      .filter(([camel]) => (m as unknown as Record<string, unknown>)[camel] !== undefined)
      .map(([camel, snake]) => [snake, (m as unknown as Record<string, unknown>)[camel]]),
  );
  return { user_id: userId, date: m.date, source, ...fields, raw: m.raw, updated_at: nowIso };
}

function raceRow(r: RaceWrite): Record<string, unknown> {
  const map: Record<string, unknown> = {
    name: r.name,
    date: r.date,
    distance: r.distance,
    priority: r.priority,
    location: r.location,
    goal: r.goal,
    notes: r.notes,
  };
  return Object.fromEntries(Object.entries(map).filter(([, v]) => v !== undefined));
}

async function listJointSessions(db: Db, userId: UUID, from: string, to: string): Promise<JointSession[]> {
  const mine = rowsOf(await db.from('joint_session_participants').select('session_id').eq('user_id', userId).limit(500), 'joint mine');
  const ids = [...new Set(mine.map((r) => String(asRow(r).session_id)))];
  if (ids.length === 0) return [];
  const sessions = rowsOf(
    await db
      .from('joint_sessions')
      .select('id,organizer_id,sport,date,start_time,duration_min,intensity,title,location,status')
      .in('id', ids)
      .gte('date', from)
      .lte('date', to),
    'joint sessions',
  );
  const sessionIds = sessions.map((s) => String(asRow(s).id));
  if (sessionIds.length === 0) return [];
  const participants = rowsOf(
    await db.from('joint_session_participants').select('session_id,user_id,status,workout_id').in('session_id', sessionIds),
    'joint participants',
  );
  const userIds = [...new Set(participants.map((p) => String(asRow(p).user_id)))];
  const profiles = rowsOf(await db.from('profiles').select('id,display_name').in('id', userIds), 'joint profiles');
  return assembleJointSessions(sessions, participants, profiles);
}

export function createPlanningStore(db: Db, now: () => Date = () => new Date()): PlanningStore {
  const findByExternalId: PlanningStore['findByExternalId'] = async (userId, externalId, rawId) => {
    const rows = rowsOf(
      await db
        .from('workouts')
        .select(WORKOUT_COLS)
        .eq('user_id', userId)
        .or(`external_id.eq."${externalId.replace(/"/g, '')}",completed->>externalId.eq."${rawId.replace(/"/g, '')}"`)
        .limit(1),
      'find external',
    );
    return rows.length ? mapWorkout(rows[0]) : null;
  };

  return {
    async getProfile(userId) {
      const data = unwrap(await db.from('profiles').select(PROFILE_COLS).eq('id', userId).maybeSingle(), 'profile');
      return data ? mapProfile(data) : null;
    },
    async listWorkouts(userId, from, to) {
      const rows = rowsOf(
        await db.from('workouts').select(WORKOUT_COLS).eq('user_id', userId).gte('date', from).lte('date', to).order('date').limit(1000),
        'workouts',
      );
      return rows.map(mapWorkout);
    },
    async listRaces(userId) {
      return rowsOf(await db.from('races').select(RACE_COLS).eq('user_id', userId).order('date').limit(100), 'races').map(mapRace);
    },
    async listLifeEvents(userId, from, to) {
      const rows = rowsOf(
        await db.from('life_events').select(EVENT_COLS).eq('user_id', userId).lte('start_date', to).gte('end_date', from).order('start_date').limit(300),
        'life events',
      );
      return rows.map(mapLifeEvent);
    },
    async listBusyBlocks(userId, fromIso, toIso) {
      const rows = rowsOf(
        await db.from('busy_blocks').select('id,starts_at,ends_at,title').eq('user_id', userId).gte('starts_at', fromIso).lt('starts_at', toIso).order('starts_at').limit(500),
        'busy blocks',
      );
      return rows.map(mapBusyBlock);
    },
    async listCheckins(userId, from, to) {
      const rows = rowsOf(
        await db.from('daily_checkins').select('date,sleep_quality,sleep_hours,fatigue,soreness,stress,motivation,notes').eq('user_id', userId).gte('date', from).lte('date', to).order('date'),
        'checkins',
      );
      return rows.map(mapCheckin);
    },
    async listMetrics(userId, from, to) {
      const rows = rowsOf(await db.from('daily_metrics').select(METRIC_COLS).eq('user_id', userId).gte('date', from).lte('date', to).order('date'), 'metrics');
      return rows.map(mapMetrics);
    },
    async listNutrition(userId, from, to) {
      const rows = rowsOf(
        await db.from('nutrition_logs').select('date,meal,description,kcal,carbs_g,protein_g,fat_g').eq('user_id', userId).gte('date', from).lte('date', to).order('date').limit(100),
        'nutrition',
      );
      return rows.map(mapNutrition);
    },
    listJointSessions: (userId, from, to) => listJointSessions(db, userId, from, to),
    async listFriends(userId) {
      return mapAcceptedFriends(rowsOf(await db.rpc('svc_list_friends', { p_user: userId }), 'svc_list_friends'));
    },
    async getFriendWeek(viewerId, friendId, from, to) {
      const rows = rowsOf(
        await db.rpc('svc_get_friend_week', { p_viewer: viewerId, p_friend: friendId, p_from: from, p_to: to }),
        'svc_get_friend_week',
      );
      return rows.map(mapFriendWeekItem);
    },
    async insertProposal(userId, draft) {
      const data = unwrap(
        await db
          .from('plan_proposals')
          .insert({
            user_id: userId,
            kind: draft.kind,
            source: draft.source,
            week_start: draft.weekStart,
            summary: draft.summary.slice(0, 4000),
            changes: draft.changes,
            status: 'pending',
            model: draft.model,
          })
          .select('id')
          .single(),
        'insert proposal',
      );
      return String(asRow(data).id);
    },
    async applyPlanChanges(userId, changes, proposalId) {
      const data = asRow(
        unwrap(await db.rpc('svc_apply_plan_changes', { p_user: userId, p_changes: changes, p_proposal_id: proposalId }), 'svc_apply_plan_changes'),
      );
      const failed = Array.isArray(data.failed)
        ? data.failed.map(asRow).map((f) => ({ index: Number(f.index ?? -1), error: String(f.error ?? 'error') }))
        : [];
      return { applied: Number(data.applied ?? 0), failed };
    },
    async insertLifeEvent(userId, e) {
      const data = unwrap(
        await db
          .from('life_events')
          .insert({
            user_id: userId,
            kind: e.kind,
            title: e.title,
            start_date: e.startDate,
            end_date: e.endDate,
            start_time: e.startTime,
            duration_min: e.durationMin,
            severity: e.severity,
            body_area: e.bodyArea,
            notes: e.notes,
          })
          .select(EVENT_COLS)
          .single(),
        'insert life event',
      );
      return mapLifeEvent(data);
    },
    async upsertMetrics(userId, source, rows) {
      const nowIso = now().toISOString();
      for (const row of rows) {
        // One row per call: PostgREST then updates only the columns present (field-level merge).
        unwrap(await db.from('daily_metrics').upsert(metricsRow(userId, source, row, nowIso), { onConflict: 'user_id,date,source' }), 'upsert metrics');
      }
      return rows.length;
    },
    async completeWorkout(userId, workoutId, completed) {
      const rows = rowsOf(
        await db.from('workouts').update({ status: 'completed', completed }).eq('id', workoutId).eq('user_id', userId).eq('status', 'planned').select('id'),
        'complete workout',
      );
      return rows.length > 0;
    },
    findByExternalId,
    async insertCompletedWorkout(userId, w) {
      if (w.externalId && (await findByExternalId(userId, w.externalId, w.externalId.replace(/^garmin:/, '')))) return null;
      const result = await db
        .from('workouts')
        .insert({
          user_id: userId,
          date: w.date,
          start_time: w.startTime,
          sport: w.sport,
          title: w.title.slice(0, 120),
          duration_min: w.durationMin,
          distance_m: w.distanceM,
          intensity: w.intensity,
          status: 'completed',
          completed: w.completed,
          source: w.source,
          external_id: w.externalId,
        })
        .select(WORKOUT_COLS)
        .single();
      if (result.error?.code === '23505') return null; // concurrent import of the same activity
      return mapWorkout(unwrap(result, 'insert completed workout'));
    },
    async insertRace(userId, race) {
      const data = unwrap(await db.from('races').insert({ user_id: userId, ...raceRow(race) }).select(RACE_COLS).single(), 'insert race');
      return mapRace(data);
    },
    async updateRace(userId, raceId, patch) {
      const data = unwrap(await db.from('races').update(raceRow(patch)).eq('id', raceId).eq('user_id', userId).select(RACE_COLS).maybeSingle(), 'update race');
      return data ? mapRace(data) : null;
    },
  };
}

