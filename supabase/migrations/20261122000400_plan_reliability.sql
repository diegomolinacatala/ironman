-- Road to Ironman — reliable plan changes (imprevistos + Claude).
--
-- 1. apply_plan_changes re-checks on apply that no change lands in the past (the athlete's local
--    today, profiles.timezone): adds, moves and updates with a date before today fail with
--    'La fecha ya ha pasado' (same text as src/domain/changes.ts). Moving a missed session from
--    the past to today or later is still allowed.
-- 2. A new proposal discards the user's older pending `rules` proposals whose 14-day window
--    overlaps its own (they are stale and pushed newer ones out of the Hoy banners).
-- 3. Only pending proposals notify: a proposal stored already applied (Claude's apply_now) no
--    longer sends "N cambios propuestos".

-- ---------------------------------------------------------------------------
-- 1. No changes into the past
-- ---------------------------------------------------------------------------
create or replace function private.user_local_today(p_user uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone private.safe_tz(coalesce(
    (select p.timezone from public.profiles p where p.id = p_user),
    'Europe/Madrid'
  )))::date;
$$;

-- Destination date of a PlanChange (add: workout.date, move: toDate, update: patch.date) or null.
create or replace function private.plan_change_destination(p_change jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_change ->> 'op'
    when 'add' then case when jsonb_typeof(p_change -> 'workout') = 'object' then p_change -> 'workout' ->> 'date' end
    when 'move' then p_change ->> 'toDate'
    when 'update' then case when jsonb_typeof(p_change -> 'patch') = 'object' then p_change -> 'patch' ->> 'date' end
  end;
$$;

-- Same as 20261025000220, plus the past-date check once the change itself is valid (the caller's
-- per-change exception block rolls the write back).
create or replace function private.apply_plan_change(p_user uuid, p_change jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op text := case when jsonb_typeof(p_change) = 'object' then p_change ->> 'op' end;
  v_status text;
  v_to text;
begin
  if v_op is null or v_op not in ('add', 'update', 'move', 'delete') then
    perform private.raise_error('validation', 'Cambio no válido');
  end if;
  if v_op = 'add' then
    perform private.plan_add(p_user, p_change -> 'workout');
  else
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
  end if;

  v_to := private.plan_change_destination(p_change);
  if v_to is not null and private.is_valid_date_text(v_to) and v_to::date < private.user_local_today(p_user) then
    perform private.raise_error('validation', 'La fecha ya ha pasado');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2 + 3. Proposal insert: supersede stale rules proposals, notify only pending ones
-- ---------------------------------------------------------------------------
create or replace function private.on_plan_proposal_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int := jsonb_array_length(new.changes);
begin
  update public.plan_proposals pp set status = 'discarded'
  where pp.user_id = new.user_id
    and pp.id <> new.id
    and pp.status = 'pending'
    and pp.source = 'rules'
    and pp.created_at <= new.created_at
    and pp.week_start <= new.week_start + 13
    and new.week_start <= pp.week_start + 13;

  if new.status <> 'pending' or new.source not in ('claude', 'ai_coach') or v_count = 0 then
    return null;
  end if;
  perform private.notify(
    new.user_id, 'plan_updated',
    case when v_count = 1 then 'Tu semana tiene 1 cambio propuesto'
      else format('Tu semana tiene %s cambios propuestos', v_count) end,
    coalesce(
      nullif(left(private.trim_text(new.summary), 300), ''),
      case when new.source = 'claude' then 'Tu Claude ha preparado una propuesta. Revísala y acepta lo que te encaje.'
        else 'Tu entrenador ha preparado una propuesta. Revísala y acepta lo que te encaje.' end
    ),
    jsonb_build_object('url', '/proposal/' || new.id, 'proposalId', new.id, 'source', new.source)
  );
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: the new helpers only run inside the security definer functions above.
-- ---------------------------------------------------------------------------
revoke all on function private.user_local_today(uuid) from public, anon, authenticated;
revoke all on function private.plan_change_destination(jsonb) from public, anon, authenticated;
grant execute on function
  private.user_local_today(uuid),
  private.plan_change_destination(jsonb)
to service_role;
