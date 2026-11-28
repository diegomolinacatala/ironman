-- Road to Ironman — «Mis sitios» and the Sunday/Wednesday questions (Tú › Ajustes).
--
-- * profiles.places jsonb, nullable: null = not set (the planner ignores places). Shape
--   (src/domain/places.ts):
--     { home: {name, gear: {roadBike, trainer, pool, gym: bool}},
--       away: {name, gear} | null }          -- the city they go back to at weekends
-- * profiles.week_questions jsonb, nullable: null = off. Shape (src/domain/weekQuestions.ts):
--     { enabled: bool,
--       weeks: [{weekStart 'YYYY-MM-DD', priority?: 'together'|'mix'|'flexible',
--                load?: 'busy'|'normal'|'free', plans?: text, sundayDone?: bool,
--                awayWeekend?: bool, awayRide?: bool, wednesdayDone?: bool}] (≤ 8) }
-- Client-writable (own row only, like the rest of the profile: the existing profiles RLS).
-- The database checks the outline and the size; the app (zod) checks every field and the
-- reader drops anything odd instead of failing. Read only by the app's rules planner and
-- re-planner for now (not by the edge functions).

alter table public.profiles add column if not exists places jsonb;
alter table public.profiles add column if not exists week_questions jsonb;

alter table public.profiles drop constraint if exists profiles_places_check;
alter table public.profiles add constraint profiles_places_check
  check (
    -- coalesce: a missing key makes the comparisons null, which a check would let through.
    places is null or coalesce((
      jsonb_typeof(places) = 'object'
      and octet_length(places::text) <= 2048
      and jsonb_typeof(places -> 'home') = 'object'
      and jsonb_typeof(places -> 'home' -> 'name') = 'string'
      and char_length(btrim(places -> 'home' ->> 'name')) between 1 and 60
      and coalesce(jsonb_typeof(places -> 'home' -> 'gear'), 'object') = 'object'
      and coalesce(jsonb_typeof(places -> 'away'), 'null') in ('object', 'null')
      and (jsonb_typeof(places -> 'away') is distinct from 'object' or (
        jsonb_typeof(places -> 'away' -> 'name') = 'string'
        and char_length(btrim(places -> 'away' ->> 'name')) between 1 and 60
        and coalesce(jsonb_typeof(places -> 'away' -> 'gear'), 'object') = 'object'
      ))
    ), false)
  );

alter table public.profiles drop constraint if exists profiles_week_questions_check;
alter table public.profiles add constraint profiles_week_questions_check
  check (
    week_questions is null or coalesce((
      jsonb_typeof(week_questions) = 'object'
      and octet_length(week_questions::text) <= 8192
      and coalesce(jsonb_typeof(week_questions -> 'enabled'), 'boolean') = 'boolean'
      and coalesce(jsonb_typeof(week_questions -> 'weeks'), 'array') = 'array'
      and (jsonb_typeof(week_questions -> 'weeks') is distinct from 'array'
           or jsonb_array_length(week_questions -> 'weeks') <= 8)
    ), false)
  );

comment on column public.profiles.places is
  '«Mis sitios»: main city and the city of the weekends away, each with its gear (road bike, trainer, pool, gym); null = not set.';
comment on column public.profiles.week_questions is
  'Sunday («Tu semana») and Wednesday («Tu fin de semana») questions: enabled flag and the answers of the last weeks; null = off.';

grant update (places, week_questions) on public.profiles to authenticated;
