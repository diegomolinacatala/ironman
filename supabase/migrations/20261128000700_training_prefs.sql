-- Road to Ironman — «Tu forma de entrenar» (Tú › Tu forma de entrenar).
--
-- * profiles.training_prefs jsonb, nullable: null = everything «Automático». Client-writable
--   (own row only, like the rest of the profile). Shape (src/domain/trainingPrefs.ts):
--     { sessionsPerWeek: {swim?, bike?, run?, strength?: int 0-7 (strength 0-3)},
--       preferredDays: {swim?, bike?, run?, strength?: [0-6]},   -- 0 = Monday
--       longRideDays: [0-6], longRunDays: [0-6],
--       intensityModel: 'auto' | 'polarized' | 'pyramidal',
--       fixedSessions: [{sport, weekday 0-6, startTime 'HH:MM' | null, durationMin 10-360, title}] (≤ 10) }
--   The database checks the outline and the size; the app (zod) checks every field and both
--   readers (app mappers, edge functions) drop anything odd instead of failing.
-- * Read by the rules planner in the app and by the planning context of the edge functions
--   (MCP get_planning_context → athlete.trainingPrefs, the coach and the briefing).

alter table public.profiles add column if not exists training_prefs jsonb;
alter table public.profiles drop constraint if exists profiles_training_prefs_check;
alter table public.profiles add constraint profiles_training_prefs_check
  check (
    training_prefs is null or (
      jsonb_typeof(training_prefs) = 'object'
      and octet_length(training_prefs::text) <= 8192
      and coalesce(jsonb_typeof(training_prefs -> 'sessionsPerWeek'), 'object') = 'object'
      and coalesce(jsonb_typeof(training_prefs -> 'preferredDays'), 'object') = 'object'
      and coalesce(jsonb_typeof(training_prefs -> 'longRideDays'), 'array') = 'array'
      and coalesce(jsonb_typeof(training_prefs -> 'longRunDays'), 'array') = 'array'
      and coalesce(training_prefs ->> 'intensityModel', 'auto') in ('auto', 'polarized', 'pyramidal')
      and coalesce(jsonb_typeof(training_prefs -> 'fixedSessions'), 'array') = 'array'
      and (jsonb_typeof(training_prefs -> 'fixedSessions') is distinct from 'array'
           or jsonb_array_length(training_prefs -> 'fixedSessions') <= 10)
    )
  );

comment on column public.profiles.training_prefs is
  '«Tu forma de entrenar»: sessions per sport, preferred days, long ride/run days, intensity model and fixed weekly sessions; null = automático.';

grant update (training_prefs) on public.profiles to authenticated;
