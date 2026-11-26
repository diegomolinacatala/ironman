-- Imported training plans (a coach's PDF, a photo, pasted text, Excel/CSV, a TrainingPeaks feed).
--   * plan_imports: one row per import (own rows readable; writes only through the RPCs below);
--   * workouts.source + 'imported', workouts.plan_import_id (set null when the import is deleted);
--   * apply_plan_import(p_import, p_workouts, p_replace): creates the import and its planned workouts
--     atomically; with p_replace, removes the sessions the app planned itself (rules / AI / Claude,
--     planned, not linked to a quedada, from today) in the weeks the import covers: the imported plan
--     is the athlete's base there;
--   * delete_plan_import(p_id): deletes the import and its still planned workouts (completed and
--     skipped ones stay as history, unlinked).
-- Re-runnable: if not exists / drop … if exists, explicit privileges for every function below.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.plan_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source text not null check (source in ('pdf', 'photo', 'text', 'csv', 'xlsx', 'trainingpeaks')),
  title text not null check (char_length(title) between 1 and 120),
  start_date date not null,
  end_date date not null,
  session_count integer not null check (session_count between 0 and 400),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  -- The reviewed ImportedPlan (camelCase JSON, src/domain/planImport.ts), for reference.
  plan jsonb not null default '{}'::jsonb check (jsonb_typeof(plan) = 'object' and pg_column_size(plan) <= 524288),
  created_at timestamptz not null default now(),
  constraint plan_imports_dates check (end_date >= start_date)
);
create index if not exists plan_imports_user_idx on public.plan_imports (user_id, start_date);

comment on table public.plan_imports is
  'Imported training plans; workouts.plan_import_id points here. Written only by apply_plan_import / delete_plan_import.';

alter table public.plan_imports enable row level security;
revoke all on public.plan_imports from public, anon, authenticated;
grant select on public.plan_imports to authenticated;
grant all on public.plan_imports to service_role;

drop policy if exists plan_imports_select_own on public.plan_imports;
create policy plan_imports_select_own on public.plan_imports
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. Workouts: source 'imported' + link to the import
-- ---------------------------------------------------------------------------
alter table public.workouts drop constraint if exists workouts_source_check;
alter table public.workouts add constraint workouts_source_check
  check (source in ('manual', 'rules', 'ai_coach', 'claude', 'joint', 'healthkit', 'garmin', 'imported'));

alter table public.workouts
  add column if not exists plan_import_id uuid references public.plan_imports (id) on delete set null;
create index if not exists workouts_plan_import_idx on public.workouts (plan_import_id) where plan_import_id is not null;

comment on column public.workouts.plan_import_id is
  'Imported plan this session came from (source ''imported''); null when created otherwise or the import was deleted.';

-- A workout can only point to an import of its owner (clients update their own workouts directly).
create or replace function private.check_workout_plan_import()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.plan_import_id is not null and not exists (
    select 1 from public.plan_imports i where i.id = new.plan_import_id and i.user_id = new.user_id
  ) then
    perform private.raise_error('forbidden', 'Ese plan importado no es tuyo');
  end if;
  return new;
end;
$$;

drop trigger if exists workouts_check_plan_import on public.workouts;
create trigger workouts_check_plan_import
  before insert or update of plan_import_id, user_id on public.workouts
  for each row execute function private.check_workout_plan_import();

-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------
create or replace function public.apply_plan_import(p_import jsonb, p_workouts jsonb, p_replace boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_uid();
  v_today date := private.user_local_today(v_user);
  v_title text;
  v_source text;
  v_confidence text;
  v_plan jsonb;
  v_draft jsonb;
  v_date date;
  v_start date;
  v_end date;
  v_id uuid;
  v_added int := 0;
  v_replaced int := 0;
begin
  if p_import is null or jsonb_typeof(p_import) <> 'object' then
    perform private.raise_error('validation', 'Plan no válido');
  end if;
  v_source := p_import ->> 'source';
  if coalesce(v_source, '') not in ('pdf', 'photo', 'text', 'csv', 'xlsx', 'trainingpeaks') then
    perform private.raise_error('validation', 'Origen del plan no válido');
  end if;
  v_title := private.trim_text(coalesce(p_import ->> 'title', ''));
  if char_length(v_title) not between 1 and 120 then
    perform private.raise_error('validation', 'El plan necesita un nombre (máximo 120 caracteres)');
  end if;
  v_confidence := coalesce(p_import ->> 'confidence', 'medium');
  if v_confidence not in ('high', 'medium', 'low') then
    perform private.raise_error('validation', 'Confianza no válida');
  end if;
  v_plan := case when jsonb_typeof(p_import -> 'plan') = 'object' then p_import -> 'plan' else '{}'::jsonb end;
  if pg_column_size(v_plan) > 524288 then
    perform private.raise_error('validation', 'El plan es demasiado grande');
  end if;
  if p_workouts is null or jsonb_typeof(p_workouts) <> 'array' or jsonb_array_length(p_workouts) = 0 then
    perform private.raise_error('validation', 'El plan no tiene sesiones desde hoy');
  end if;
  if jsonb_array_length(p_workouts) > 400 then
    perform private.raise_error('validation', 'Demasiadas sesiones (máximo 400)');
  end if;

  -- Validate every session first (same rules as apply_plan_changes), dates from today to a year ahead.
  for v_draft in select value from jsonb_array_elements(p_workouts) loop
    perform private.check_workout_draft(v_draft - 'source', false);
    v_date := (v_draft ->> 'date')::date;
    if v_date < v_today then
      perform private.raise_error('validation', 'La fecha ya ha pasado');
    end if;
    if v_date > v_today + 400 then
      perform private.raise_error('validation', 'Hay sesiones a más de un año vista');
    end if;
    v_start := least(coalesce(v_start, v_date), v_date);
    v_end := greatest(coalesce(v_end, v_date), v_date);
  end loop;

  insert into public.plan_imports (user_id, source, title, start_date, end_date, session_count, confidence, plan)
  values (v_user, v_source, v_title, v_start, v_end, jsonb_array_length(p_workouts), v_confidence, v_plan)
  returning id into v_id;

  if coalesce(p_replace, true) then
    with weeks as (
      select distinct date_trunc('week', (value ->> 'date')::date)::date as monday
      from jsonb_array_elements(p_workouts)
    ), removed as (
      delete from public.workouts w
      using weeks
      where w.user_id = v_user
        and w.status = 'planned'
        and w.source in ('rules', 'ai_coach', 'claude')
        and w.joint_session_id is null
        and w.date >= v_today
        and w.date between weeks.monday and weeks.monday + 6
      returning w.id
    )
    select count(*) into v_replaced from removed;
  end if;

  insert into public.workouts (
    user_id, date, start_time, sport, title, description, duration_min, distance_m,
    intensity, tss, steps, status, source, is_key, coaching, plan_import_id
  )
  select
    v_user,
    (d ->> 'date')::date,
    (d ->> 'startTime')::time,
    d ->> 'sport',
    private.trim_text(d ->> 'title'),
    d ->> 'description',
    round(private.jsonb_number(d -> 'durationMin'))::int,
    round(private.jsonb_number(d -> 'distanceM'))::int,
    d ->> 'intensity',
    round(private.jsonb_number(d -> 'tss'), 1),
    coalesce(case when jsonb_typeof(d -> 'steps') = 'array' then d -> 'steps' end, '[]'::jsonb),
    'planned',
    'imported',
    coalesce((d ->> 'isKey')::boolean, false),
    private.normalize_workout_coaching(d -> 'coaching'),
    v_id
  from jsonb_array_elements(p_workouts) as e(d);
  get diagnostics v_added = row_count;

  return jsonb_build_object(
    'import', jsonb_build_object(
      'id', v_id, 'source', v_source, 'title', v_title, 'startDate', v_start, 'endDate', v_end,
      'sessionCount', v_added, 'confidence', v_confidence,
      'createdAt', (select i.created_at from public.plan_imports i where i.id = v_id)
    ),
    'added', v_added,
    'replaced', v_replaced
  );
end;
$$;

create or replace function public.delete_plan_import(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_uid();
  v_removed int;
begin
  if not exists (select 1 from public.plan_imports i where i.id = p_id and i.user_id = v_user) then
    perform private.raise_error('not_found', 'No encuentro ese plan importado');
  end if;
  delete from public.workouts w
  where w.user_id = v_user and w.plan_import_id = p_id and w.status = 'planned';
  get diagnostics v_removed = row_count;
  -- Completed and skipped sessions stay as history (plan_import_id → null).
  delete from public.plan_imports i where i.id = p_id and i.user_id = v_user;
  return v_removed;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Privileges
-- ---------------------------------------------------------------------------
revoke all on function private.check_workout_plan_import() from public, anon, authenticated;
revoke all on function public.apply_plan_import(jsonb, jsonb, boolean) from public, anon;
revoke all on function public.delete_plan_import(uuid) from public, anon;
grant execute on function public.apply_plan_import(jsonb, jsonb, boolean) to authenticated, service_role;
grant execute on function public.delete_plan_import(uuid) to authenticated, service_role;
