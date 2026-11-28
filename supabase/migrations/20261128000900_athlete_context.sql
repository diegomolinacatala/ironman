-- Road to Ironman — «Tu contexto» (Tú › Tu contexto, and the prompt on Hoy).
--
-- * profiles.athlete_context jsonb, nullable: null = the athlete has told the coach nothing yet.
--   Client-writable (own row only, like the rest of the profile). Shape (src/domain/athleteContext.ts):
--     { sports: {swim?|bike?|run?: {background?: 'new'|'some'|'years'|'lifelong', goal?: 'maintain'|'improve'|'improve_lot'}},
--       limitations: text|null, previousRaces: text|null,
--       occupation: 'study'|'work'|'both'|'none'|null, load: 'light'|'medium'|'high'|null,
--       schedule: 'morning'|'afternoon'|'full_day'|'shifts'|'flexible'|null,
--       periods: [{kind: 'exams'|'busy', from, to: 'YYYY-MM-DD', label, eventId}] (≤ 8; each also a life event
--                 of kind 'exam' / 'work' the planner already understands),
--       habits: {breakfast, lunch, dinner, wake, bed, weekendWake, weekendBed: 'HH:MM'|null, weekendsDiffer: bool,
--                preferredTime: 'morning'|'midday'|'evening'|'any'|null},
--       notes: [text] (≤ 5, «¿Algo más que deba saber?» without the AI), answered: [question id], completedAt, promptDismissed }
--   The database checks the outline and the size; the app (zod) checks every field and both readers
--   (app mappers, edge functions) drop anything odd instead of failing.
-- * Read by the rules planner in the app (sport focus, studies/work load, waking day, meals, preferred
--   time) and by the planning context of the edge functions (MCP get_planning_context → athlete.context,
--   the coach and the briefing). Deploy this migration before the functions: they select the column.

alter table public.profiles add column if not exists athlete_context jsonb;
alter table public.profiles drop constraint if exists profiles_athlete_context_check;
alter table public.profiles add constraint profiles_athlete_context_check
  check (
    athlete_context is null or (
      jsonb_typeof(athlete_context) = 'object'
      and octet_length(athlete_context::text) <= 8192
      and coalesce(jsonb_typeof(athlete_context -> 'sports'), 'object') = 'object'
      and coalesce(jsonb_typeof(athlete_context -> 'habits'), 'object') = 'object'
      and coalesce(jsonb_typeof(athlete_context -> 'periods'), 'array') = 'array'
      and coalesce(jsonb_typeof(athlete_context -> 'notes'), 'array') = 'array'
      and coalesce(jsonb_typeof(athlete_context -> 'answered'), 'array') = 'array'
      and coalesce(athlete_context ->> 'occupation', 'none') in ('study', 'work', 'both', 'none')
      and coalesce(athlete_context ->> 'load', 'medium') in ('light', 'medium', 'high')
      and (jsonb_typeof(athlete_context -> 'periods') is distinct from 'array'
           or jsonb_array_length(athlete_context -> 'periods') <= 8)
      and (jsonb_typeof(athlete_context -> 'notes') is distinct from 'array'
           or jsonb_array_length(athlete_context -> 'notes') <= 5)
    )
  );

comment on column public.profiles.athlete_context is
  '«Tu contexto»: sport background and goals, studies/work and its load, periods with less time, meal and sleep habits, preferred training time and free notes; null = not told yet.';

grant update (athlete_context) on public.profiles to authenticated;
