-- Road to Ironman v4 — "un entrenador de verdad", COROS and the general plan (docs/V4.md §3):
--   * workouts.coaching: the coach's prescription (objective, keys, success criterion, plan B),
--     read and validated by apply_plan_changes (add / update); steps stay unchecked JSON (explicit
--     targets, cues, brick legs) apart from the existing checks, capped at 50 items;
--   * profiles.watch_brand ('garmin' | 'coros'; null = not chosen yet = Garmin), client-updatable;
--   * daily_metrics.source 'coros': COROS data the athlete's Claude saves through the connector;
--   * week_plans: week-level entries of Plan → General (own rows; the edge functions write them
--     with the service role, no RPC). Realtime: 20261109000900_week_plans_platform.sql.
-- Re-runnable: if not exists / drop … if exists, explicit privileges for every function below.

-- ---------------------------------------------------------------------------
-- 1. workouts.coaching
-- ---------------------------------------------------------------------------
alter table public.workouts add column if not exists coaching jsonb;
alter table public.workouts drop constraint if exists workouts_coaching_check;
alter table public.workouts add constraint workouts_coaching_check check (
  coaching is null or (jsonb_typeof(coaching) = 'object' and pg_column_size(coaching) <= 4000)
);

comment on column public.workouts.coaching is
  'v4: { "objective": text, "keys": text[] (≤ 4), "success": text, "planB": text | null }; null = none.';

-- True when v is a JSON string whose trimmed text has between p_min and p_max characters.
create or replace function private.json_text_between(v jsonb, p_min int, p_max int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(v) = 'string' and char_length(private.trim_text(v #>> '{}')) between p_min and p_max,
    false
  );
$$;

-- Stored copy of a valid WorkoutCoaching: trimmed texts and only the known keys
-- (keys absent → [], planB absent → null). Null for anything that is not an object.
create or replace function private.normalize_workout_coaching(p_coaching jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when jsonb_typeof(p_coaching) = 'object' then jsonb_build_object(
    'objective', private.trim_text(p_coaching ->> 'objective'),
    'keys', coalesce((
      select jsonb_agg(private.trim_text(k.v) order by k.ord)
      from jsonb_array_elements_text(
        case when jsonb_typeof(p_coaching -> 'keys') = 'array' then p_coaching -> 'keys' else '[]'::jsonb end
      ) with ordinality as k(v, ord)
    ), '[]'::jsonb),
    'success', private.trim_text(p_coaching ->> 'success'),
    'planB', case when jsonb_typeof(p_coaching -> 'planB') = 'string'
      then private.trim_text(p_coaching ->> 'planB') end
  ) end;
$$;

-- First error (Spanish) of a WorkoutCoaching JSON; null when it is valid, absent or JSON null.
create or replace function private.validate_workout_coaching(p_coaching jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_keys jsonb := case when jsonb_typeof(p_coaching -> 'keys') = 'array' then p_coaching -> 'keys' else '[]'::jsonb end;
begin
  if p_coaching is null or jsonb_typeof(p_coaching) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_coaching) <> 'object' then
    return 'Indicaciones del entreno no válidas';
  end if;
  if not private.json_text_between(p_coaching -> 'objective', 1, 200) then
    return 'Objetivo del entreno no válido (1–200 caracteres)';
  end if;
  if jsonb_array_length(v_keys) > 4 then
    return 'Máximo 4 claves por entreno';
  end if;
  if coalesce(jsonb_typeof(p_coaching -> 'keys'), 'null') not in ('null', 'array')
    or exists (select 1 from jsonb_array_elements(v_keys) as k(v) where not private.json_text_between(k.v, 1, 160)) then
    return 'Claves del entreno no válidas (1–160 caracteres cada una)';
  end if;
  if not private.json_text_between(p_coaching -> 'success', 1, 200) then
    return 'Criterio de éxito no válido (1–200 caracteres)';
  end if;
  if coalesce(jsonb_typeof(p_coaching -> 'planB'), 'null') <> 'null'
    and not private.json_text_between(p_coaching -> 'planB', 1, 200) then
    return 'Plan B no válido (1–200 caracteres)';
  end if;
  if pg_column_size(private.normalize_workout_coaching(p_coaching)) > 4000 then
    return 'Indicaciones del entreno demasiado largas';
  end if;
  return null;
end;
$$;

-- Extra checks the database needs (20261025000220_rpc_plan.sql + v4: at most 50 steps, coaching).
create or replace function private.validate_workout_fields(p_draft jsonb, p_partial boolean)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  if (not p_partial or p_draft ? 'sport')
    and coalesce(p_draft ->> 'sport', '') not in ('swim', 'bike', 'run', 'brick', 'strength', 'mobility', 'other', 'rest') then
    return 'Deporte no válido';
  end if;
  if (not p_partial or p_draft ? 'intensity')
    and coalesce(p_draft ->> 'intensity', '') not in ('recovery', 'endurance', 'tempo', 'threshold', 'vo2', 'race') then
    return 'Intensidad no válida';
  end if;
  if char_length(private.trim_text(coalesce(p_draft ->> 'title', ''))) > 120 then
    return 'Título demasiado largo';
  end if;
  if coalesce(jsonb_typeof(p_draft -> 'description'), 'null') not in ('null', 'string')
    or char_length(coalesce(p_draft ->> 'description', '')) > 4000 then
    return 'Descripción no válida';
  end if;
  if coalesce(jsonb_typeof(p_draft -> 'distanceM'), 'null') <> 'null'
    and coalesce(private.jsonb_number(p_draft -> 'distanceM') not between 0 and 1000000, true) then
    return 'Distancia inválida';
  end if;
  if coalesce(jsonb_typeof(p_draft -> 'tss'), 'null') <> 'null'
    and coalesce(private.jsonb_number(p_draft -> 'tss') not between 0 and 2000, true) then
    return 'Carga inválida';
  end if;
  -- Absent keys are fine; JSON null is only accepted when creating (defaults apply).
  if coalesce(jsonb_typeof(p_draft -> 'steps'), 'absent') not in ('absent', 'array')
    and not (jsonb_typeof(p_draft -> 'steps') = 'null' and not p_partial) then
    return 'Pasos no válidos';
  end if;
  -- Steps stay unchecked JSON (explicit targets, cues, brick legs…), at most 50 of them.
  if jsonb_typeof(p_draft -> 'steps') = 'array' and jsonb_array_length(p_draft -> 'steps') > 50 then
    return 'Demasiados pasos (máximo 50)';
  end if;
  if coalesce(jsonb_typeof(p_draft -> 'isKey'), 'absent') not in ('absent', 'boolean')
    and not (jsonb_typeof(p_draft -> 'isKey') = 'null' and not p_partial) then
    return 'Sesión clave no válida';
  end if;
  if coalesce(jsonb_typeof(p_draft -> 'source'), 'null') <> 'null'
    and p_draft ->> 'source' not in ('manual', 'rules', 'ai_coach', 'claude', 'joint', 'healthkit', 'garmin') then
    return 'Origen no válido';
  end if;
  -- coaching: absent = none (add) / unchanged (update), JSON null = none / clear.
  return private.validate_workout_coaching(p_draft -> 'coaching');
end;
$$;

-- op 'add' (+ coaching)
create or replace function private.plan_add(p_user uuid, p_draft jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_workout_draft(p_draft, false);
  insert into public.workouts (
    user_id, date, start_time, sport, title, description, duration_min, distance_m,
    intensity, tss, steps, status, source, is_key, coaching
  ) values (
    p_user,
    (p_draft ->> 'date')::date,
    (p_draft ->> 'startTime')::time,
    p_draft ->> 'sport',
    private.trim_text(p_draft ->> 'title'),
    p_draft ->> 'description',
    round(private.jsonb_number(p_draft -> 'durationMin'))::int,
    round(private.jsonb_number(p_draft -> 'distanceM'))::int,
    p_draft ->> 'intensity',
    round(private.jsonb_number(p_draft -> 'tss'), 1),
    coalesce(case when jsonb_typeof(p_draft -> 'steps') = 'array' then p_draft -> 'steps' end, '[]'::jsonb),
    'planned',
    coalesce(p_draft ->> 'source', 'manual'),
    coalesce((p_draft ->> 'isKey')::boolean, false),
    private.normalize_workout_coaching(p_draft -> 'coaching')
  );
end;
$$;

-- op 'update': only WorkoutDraft keys present in the patch are applied (coaching null = clear).
create or replace function private.plan_update(p_user uuid, p_workout_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    perform private.raise_error('validation', 'Cambio no válido');
  end if;
  perform private.check_workout_draft(p_patch, true);
  update public.workouts w set
    date = case when p_patch ? 'date' then (p_patch ->> 'date')::date else w.date end,
    start_time = case when p_patch ? 'startTime' then (p_patch ->> 'startTime')::time else w.start_time end,
    sport = case when p_patch ? 'sport' then p_patch ->> 'sport' else w.sport end,
    title = case when p_patch ? 'title' then private.trim_text(p_patch ->> 'title') else w.title end,
    description = case when p_patch ? 'description' then p_patch ->> 'description' else w.description end,
    duration_min = case when p_patch ? 'durationMin'
      then round(private.jsonb_number(p_patch -> 'durationMin'))::int else w.duration_min end,
    distance_m = case when p_patch ? 'distanceM'
      then round(private.jsonb_number(p_patch -> 'distanceM'))::int else w.distance_m end,
    intensity = case when p_patch ? 'intensity' then p_patch ->> 'intensity' else w.intensity end,
    tss = case when p_patch ? 'tss' then round(private.jsonb_number(p_patch -> 'tss'), 1) else w.tss end,
    steps = case when p_patch ? 'steps' then p_patch -> 'steps' else w.steps end,
    is_key = case when p_patch ? 'isKey' then (p_patch ->> 'isKey')::boolean else w.is_key end,
    source = coalesce(p_patch ->> 'source', w.source),
    -- A new sport or intensity without new coaching would keep an objective written for the old
    -- session (e.g. "sostener umbral" on a Z2 run): clear it.
    coaching = case
      when p_patch ? 'coaching' then private.normalize_workout_coaching(p_patch -> 'coaching')
      when (p_patch ? 'sport' and p_patch ->> 'sport' is distinct from w.sport)
        or (p_patch ? 'intensity' and p_patch ->> 'intensity' is distinct from w.intensity) then null
      else w.coaching end
  where w.id = p_workout_id and w.user_id = p_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. profiles.watch_brand (the client writes it: onboarding "Tu reloj", Tú › Conexiones)
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists watch_brand text;
alter table public.profiles drop constraint if exists profiles_watch_brand_check;
alter table public.profiles add constraint profiles_watch_brand_check
  check (watch_brand is null or watch_brand in ('garmin', 'coros'));

comment on column public.profiles.watch_brand is
  'v4: the athlete''s watch, ''garmin'' | ''coros''; null = not chosen yet (treated as Garmin).';

grant update (watch_brand) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. daily_metrics.source + 'coros' (COROS → Apple Salud still lands as 'healthkit').
--    Merge priority everywhere: garmin > coros > healthkit > manual.
-- ---------------------------------------------------------------------------
alter table public.daily_metrics drop constraint if exists daily_metrics_source_check;
alter table public.daily_metrics add constraint daily_metrics_source_check
  check (source in ('healthkit', 'garmin', 'coros', 'manual'));

-- ---------------------------------------------------------------------------
-- 4. week_plans: one entry per user and Monday overriding the computed periodization
--    (load = carga, push = más volumen, recovery = descarga, rest = semana libre).
-- ---------------------------------------------------------------------------
create table if not exists public.week_plans (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  kind text not null check (kind in ('load', 'push', 'recovery', 'rest')),
  target_minutes integer check (target_minutes is null or target_minutes between 0 and 3000),
  note text check (note is null or char_length(note) <= 300),
  source text not null default 'manual' check (source in ('manual', 'ai_coach', 'claude')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

comment on table public.week_plans is
  'v4 Plan → General: week-level plan per user and Monday; null target_minutes = weekly hours × the phase factor.';

drop trigger if exists week_plans_set_updated_at on public.week_plans;
create trigger week_plans_set_updated_at
  before update on public.week_plans
  for each row execute function private.set_updated_at();

drop trigger if exists week_plans_keep_owner on public.week_plans;
create trigger week_plans_keep_owner
  before update of user_id on public.week_plans
  for each row execute function private.keep_owner();

-- Own rows for the app; the service role (coach, MCP set_week_plans) bypasses RLS.
alter table public.week_plans enable row level security;
revoke all on public.week_plans from public, anon, authenticated;
grant select, insert, update, delete on public.week_plans to authenticated;
grant all on public.week_plans to service_role;

drop policy if exists week_plans_select_own on public.week_plans;
create policy week_plans_select_own on public.week_plans
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists week_plans_insert_own on public.week_plans;
create policy week_plans_insert_own on public.week_plans
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists week_plans_update_own on public.week_plans;
create policy week_plans_update_own on public.week_plans
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists week_plans_delete_own on public.week_plans;
create policy week_plans_delete_own on public.week_plans
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. Privileges: functions created or replaced here run only inside apply_plan_changes /
--    svc_apply_plan_changes (security definer); no API role calls them directly.
-- ---------------------------------------------------------------------------
revoke all on function private.json_text_between(jsonb, int, int) from public, anon, authenticated;
revoke all on function private.normalize_workout_coaching(jsonb) from public, anon, authenticated;
revoke all on function private.validate_workout_coaching(jsonb) from public, anon, authenticated;
revoke all on function private.validate_workout_fields(jsonb, boolean) from public, anon, authenticated;
revoke all on function private.plan_add(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.plan_update(uuid, uuid, jsonb) from public, anon, authenticated;

grant execute on function
  private.json_text_between(jsonb, int, int),
  private.normalize_workout_coaching(jsonb),
  private.validate_workout_coaching(jsonb),
  private.validate_workout_fields(jsonb, boolean),
  private.plan_add(uuid, jsonb),
  private.plan_update(uuid, uuid, jsonb)
to service_role;
