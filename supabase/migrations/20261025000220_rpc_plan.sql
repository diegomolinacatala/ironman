-- Rebufo — apply_plan_changes: server-side mirror of src/domain/changes.ts.
--
-- PlanChange JSON (camelCase, as in src/domain/types.ts):
--   { op: 'add',    workout: WorkoutDraft, reason }
--   { op: 'update', workoutId, patch: Partial<WorkoutDraft>, reason }
--   { op: 'move',   workoutId, toDate, toStartTime?, reason }
--   { op: 'delete', workoutId, reason }
-- Semantics (same as applyPlanChanges):
-- * changes are applied in order; a failing change is skipped and reported as {index, error}
--   (0-based) without aborting the others;
-- * only the user's own workouts can be targeted ('Entreno no encontrado' otherwise);
-- * completed workouts can only be changed through 'update' (patch never touches status/completed);
-- * validation mirrors validateDraft (dates YYYY-MM-DD, times HH:mm, duration 0..720, title).

-- Mirrors validateDraft(draft, partial) and returns the first error (Spanish) or null.
create or replace function private.validate_workout_draft(p_draft jsonb, p_partial boolean)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_duration numeric;
begin
  if not p_partial or p_draft ? 'date' then
    if jsonb_typeof(p_draft -> 'date') is distinct from 'string'
      or not private.is_valid_date_text(p_draft ->> 'date') then
      return 'Fecha inválida';
    end if;
  end if;
  if coalesce(jsonb_typeof(p_draft -> 'startTime'), 'null') <> 'null' then
    if jsonb_typeof(p_draft -> 'startTime') <> 'string'
      or not private.is_valid_time_text(p_draft ->> 'startTime') then
      return 'Hora inválida';
    end if;
  end if;
  if not p_partial or p_draft ? 'durationMin' then
    v_duration := private.jsonb_number(p_draft -> 'durationMin');
    if v_duration is null or v_duration < 0 or v_duration > 720 then
      return 'Duración inválida';
    end if;
  end if;
  if not p_partial or p_draft ? 'title' then
    if jsonb_typeof(p_draft -> 'title') is distinct from 'string'
      or private.trim_text(p_draft ->> 'title') = '' then
      return 'Título vacío';
    end if;
  end if;
  return null;
end;
$$;

-- Extra checks the database needs (the TS types guarantee them on the client side).
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
  if coalesce(jsonb_typeof(p_draft -> 'isKey'), 'absent') not in ('absent', 'boolean')
    and not (jsonb_typeof(p_draft -> 'isKey') = 'null' and not p_partial) then
    return 'Sesión clave no válida';
  end if;
  if coalesce(jsonb_typeof(p_draft -> 'source'), 'null') <> 'null'
    and p_draft ->> 'source' not in ('manual', 'rules', 'ai_coach', 'claude', 'joint', 'healthkit', 'garmin') then
    return 'Origen no válido';
  end if;
  return null;
end;
$$;

create or replace function private.check_workout_draft(p_draft jsonb, p_partial boolean)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_error text;
begin
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' then
    perform private.raise_error('validation', 'Fecha inválida');
  end if;
  v_error := coalesce(
    private.validate_workout_draft(p_draft, p_partial),
    private.validate_workout_fields(p_draft, p_partial)
  );
  if v_error is not null then
    perform private.raise_error('validation', v_error);
  end if;
end;
$$;

-- op 'add'
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
    intensity, tss, steps, status, source, is_key
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
    coalesce((p_draft ->> 'isKey')::boolean, false)
  );
end;
$$;

-- Locks and returns the status of the user's workout, or raises 'Entreno no encontrado'.
create or replace function private.plan_target_status(p_user uuid, p_workout_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select w.status into v_status
  from public.workouts w
  where w.id = private.try_uuid(p_workout_id) and w.user_id = p_user
  for update;
  if v_status is null then
    perform private.raise_error('not_found', 'Entreno no encontrado');
  end if;
  return v_status;
end;
$$;

-- op 'move'
create or replace function private.plan_move(p_user uuid, p_change jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(p_change -> 'toDate') is distinct from 'string'
    or not private.is_valid_date_text(p_change ->> 'toDate') then
    perform private.raise_error('validation', 'Fecha inválida');
  end if;
  if coalesce(jsonb_typeof(p_change -> 'toStartTime'), 'null') <> 'null'
    and (jsonb_typeof(p_change -> 'toStartTime') <> 'string'
      or not private.is_valid_time_text(p_change ->> 'toStartTime')) then
    perform private.raise_error('validation', 'Hora inválida');
  end if;
  update public.workouts w set
    date = (p_change ->> 'toDate')::date,
    start_time = case when p_change ? 'toStartTime' then (p_change ->> 'toStartTime')::time else w.start_time end
  where w.id = (p_change ->> 'workoutId')::uuid and w.user_id = p_user;
end;
$$;

-- op 'update': only WorkoutDraft keys present in the patch are applied.
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
    source = coalesce(p_patch ->> 'source', w.source)
  where w.id = p_workout_id and w.user_id = p_user;
end;
$$;

-- Applies one change or raises (message = Spanish error reported to the caller).
create or replace function private.apply_plan_change(p_user uuid, p_change jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op text := case when jsonb_typeof(p_change) = 'object' then p_change ->> 'op' end;
  v_status text;
begin
  if v_op is null or v_op not in ('add', 'update', 'move', 'delete') then
    perform private.raise_error('validation', 'Cambio no válido');
  end if;
  if v_op = 'add' then
    perform private.plan_add(p_user, p_change -> 'workout');
    return;
  end if;

  v_status := private.plan_target_status(p_user, p_change ->> 'workoutId');
  if v_status = 'completed' and v_op <> 'update' then
    perform private.raise_error('validation', 'No se puede modificar un entreno completado');
  end if;

  if v_op = 'delete' then
    delete from public.workouts w where w.id = (p_change ->> 'workoutId')::uuid and w.user_id = p_user;
  elsif v_op = 'move' then
    perform private.plan_move(p_user, p_change);
  else
    perform private.plan_update(p_user, (p_change ->> 'workoutId')::uuid, p_change -> 'patch');
  end if;
end;
$$;

-- Marks the proposal as applied / partially applied (nothing when no change was applied).
create or replace function private.mark_proposal_applied(p_user uuid, p_proposal_id uuid, p_applied int, p_failed int)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.plan_proposals pp set status = case
      when p_failed = 0 and p_applied >= jsonb_array_length(pp.changes) then 'applied'
      else 'partially_applied'
    end
  where pp.id = p_proposal_id and pp.user_id = p_user and p_applied > 0
    and pp.status in ('pending', 'partially_applied');
$$;

create or replace function public.svc_apply_plan_changes(p_user uuid, p_changes jsonb, p_proposal_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_applied int := 0;
  v_failed jsonb := '[]'::jsonb;
  v_hint text;
  v_message text;
begin
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
    perform private.raise_error('not_authenticated', 'Tienes que iniciar sesión');
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    perform private.raise_error('validation', 'Los cambios deben ser una lista');
  end if;
  if jsonb_array_length(p_changes) > 200 then
    perform private.raise_error('validation', 'Demasiados cambios a la vez (máximo 200)');
  end if;

  for r in
    select e.value as change, (e.ord - 1)::int as idx
    from jsonb_array_elements(p_changes) with ordinality as e(value, ord)
    order by e.ord
  loop
    begin
      perform private.apply_plan_change(p_user, r.change);
      v_applied := v_applied + 1;
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint, v_message = message_text;
      v_failed := v_failed || jsonb_build_array(jsonb_build_object(
        'index', r.idx,
        'error', case when v_hint in ('validation', 'not_found', 'forbidden', 'conflict')
          then v_message else 'Cambio no válido' end
      ));
    end;
  end loop;

  if p_proposal_id is not null then
    perform private.mark_proposal_applied(p_user, p_proposal_id, v_applied, jsonb_array_length(v_failed));
  end if;

  return jsonb_build_object('applied', v_applied, 'failed', v_failed);
end;
$$;

create or replace function public.apply_plan_changes(p_changes jsonb, p_proposal_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.svc_apply_plan_changes(private.require_uid(), p_changes, p_proposal_id);
end;
$$;
