-- Road to Ironman — morning journal (Whoop-style yes/no questions) and post-workout analysis.
--
-- 1. daily_checkins: the five 1–5 scales become optional (null = not answered) and
--    `habits` holds the journal's yes/no answers, { "<habit id>": true | false }.
--    Ids are validated by the app (src/domain/types.ts HABIT_IDS); here only the shape.
-- 2. profiles.journal_habits: the habits the athlete is asked about (null = the defaults),
--    client-updatable like watch_brand.
-- 3. workout_analyses: the coach's AI analysis of a completed session, one per workout.
--    Written only by the `analysis` Edge Function (service role); the owner reads it.

-- ---------------------------------------------------------------------------
-- 1. daily_checkins: optional scales + journal answers
-- ---------------------------------------------------------------------------
alter table public.daily_checkins alter column sleep_quality drop not null;
alter table public.daily_checkins alter column fatigue drop not null;
alter table public.daily_checkins alter column soreness drop not null;
alter table public.daily_checkins alter column stress drop not null;
alter table public.daily_checkins alter column motivation drop not null;

alter table public.daily_checkins add column if not exists habits jsonb not null default '{}'::jsonb;
alter table public.daily_checkins drop constraint if exists daily_checkins_habits_check;
alter table public.daily_checkins add constraint daily_checkins_habits_check
  check (jsonb_typeof(habits) = 'object' and octet_length(habits::text) <= 2000);

comment on column public.daily_checkins.habits is
  'Morning journal: { habit id: yes/no }. Habit ids: src/domain/types.ts HABIT_IDS.';

-- ---------------------------------------------------------------------------
-- 2. profiles.journal_habits
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists journal_habits text[];
alter table public.profiles drop constraint if exists profiles_journal_habits_check;
alter table public.profiles add constraint profiles_journal_habits_check
  check (journal_habits is null or cardinality(journal_habits) between 1 and 10);

comment on column public.profiles.journal_habits is
  'Habits asked in the morning journal (ids of src/domain/types.ts HABIT_IDS); null = the defaults.';

grant update (journal_habits) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. workout_analyses
-- ---------------------------------------------------------------------------
create table if not exists public.workout_analyses (
  workout_id uuid primary key references public.workouts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  headline text not null check (char_length(headline) between 1 and 160),
  went_well text[] not null default '{}' check (cardinality(went_well) <= 5),
  improve text[] not null default '{}' check (cardinality(improve) <= 5),
  next_step text not null default '' check (char_length(next_step) <= 600),
  model text check (model is null or char_length(model) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workout_analyses_user_idx on public.workout_analyses (user_id);

drop trigger if exists workout_analyses_set_updated_at on public.workout_analyses;
create trigger workout_analyses_set_updated_at
  before update on public.workout_analyses
  for each row execute function private.set_updated_at();

drop trigger if exists workout_analyses_keep_owner on public.workout_analyses;
create trigger workout_analyses_keep_owner
  before update of user_id on public.workout_analyses
  for each row execute function private.keep_owner();

-- Same model as briefings: read own, no client writes (service role only).
alter table public.workout_analyses enable row level security;
revoke all on public.workout_analyses from anon, authenticated;
grant all on public.workout_analyses to service_role;
grant select on public.workout_analyses to authenticated;

drop policy if exists workout_analyses_select_own on public.workout_analyses;
create policy workout_analyses_select_own on public.workout_analyses
  for select to authenticated using (user_id = (select auth.uid()));
