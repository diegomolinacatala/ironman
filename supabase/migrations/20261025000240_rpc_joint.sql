-- Road to Ironman — joint sessions ("quedadas"): propose / respond / cancel / list.
-- Every participant who accepted gets a linked workout (workouts.joint_session_id, source 'joint'),
-- so quedadas show up in both calendars and re-planners treat them as fixed.

-- JointSession camelCase JSON (src/domain/types.ts), participants: organizer first.
create or replace function private.joint_session_json(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id,
    'organizerId', s.organizer_id,
    'sport', s.sport,
    'date', s.date,
    'startTime', to_char(s.start_time, 'HH24:MI'),
    'durationMin', s.duration_min,
    'intensity', s.intensity,
    'title', s.title,
    'location', s.location,
    'notes', s.notes,
    'status', s.status,
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
          'userId', p.user_id,
          'displayName', pr.display_name,
          'avatarUrl', pr.avatar_url,
          'status', p.status,
          'workoutId', p.workout_id
        ) order by (p.user_id = s.organizer_id) desc, pr.display_name)
      from public.joint_session_participants p
      join public.profiles pr on pr.id = p.user_id
      where p.session_id = s.id
    ), '[]'::jsonb),
    'createdAt', s.created_at
  )
  from public.joint_sessions s
  where s.id = p_session_id;
$$;

-- Validates a JointSessionDraft-like JSON object; raises a Spanish 'validation' error.
create or replace function private.check_joint_draft(p jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_error text;
  v_duration numeric := private.jsonb_number(p -> 'durationMin');
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    v_error := 'Datos de la quedada no válidos';
  elsif coalesce(p ->> 'sport', '') not in ('swim', 'bike', 'run', 'brick', 'strength', 'mobility', 'other') then
    v_error := 'Deporte no válido';
  elsif not private.is_valid_date_text(p ->> 'date') then
    v_error := 'Fecha inválida';
  elsif (p ->> 'date')::date < current_date - 1 then
    v_error := 'No puedes proponer una quedada en el pasado';
  elsif coalesce(jsonb_typeof(p -> 'startTime'), 'null') <> 'null'
    and not private.is_valid_time_text(p ->> 'startTime') then
    v_error := 'Hora inválida';
  elsif v_duration is null or v_duration < 5 or v_duration > 720 then
    v_error := 'Duración inválida';
  elsif coalesce(p ->> 'intensity', 'endurance') not in ('recovery', 'endurance', 'tempo', 'threshold', 'vo2', 'race') then
    v_error := 'Intensidad no válida';
  elsif private.trim_text(coalesce(p ->> 'title', '')) = '' then
    v_error := 'Título vacío';
  elsif char_length(private.trim_text(p ->> 'title')) > 120 then
    v_error := 'Título demasiado largo';
  elsif char_length(coalesce(p ->> 'location', '')) > 200 then
    v_error := 'Lugar demasiado largo';
  elsif char_length(coalesce(p ->> 'notes', '')) > 2000 then
    v_error := 'Notas demasiado largas';
  end if;
  if v_error is not null then
    perform private.raise_error('validation', v_error);
  end if;
end;
$$;

-- Distinct invitees, all accepted friends of the organizer (1..10).
create or replace function private.check_invitees(p_me uuid, p_invitees uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := array(select distinct x from unnest(coalesce(p_invitees, '{}'::uuid[])) as x where x is not null);
begin
  if cardinality(v_ids) = 0 then
    perform private.raise_error('validation', 'Invita al menos a un amigo');
  end if;
  if cardinality(v_ids) > 10 then
    perform private.raise_error('validation', 'Puedes invitar como máximo a 10 personas');
  end if;
  if p_me = any(v_ids) then
    perform private.raise_error('validation', 'No puedes invitarte a ti mismo');
  end if;
  if exists (select 1 from unnest(v_ids) as x where not private.are_friends(p_me, x)) then
    perform private.raise_error('forbidden', 'Solo puedes invitar a tus amigos');
  end if;
  return v_ids;
end;
$$;

-- Creates the user's linked workout for the session, or links (and aligns) an existing planned one.
create or replace function private.link_joint_workout(p_session_id uuid, p_user uuid, p_workout_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.joint_sessions%rowtype;
  v_id uuid;
begin
  select * into s from public.joint_sessions where id = p_session_id;
  if p_workout_id is null then
    insert into public.workouts (
      user_id, date, start_time, sport, title, description, duration_min, intensity,
      status, source, joint_session_id
    ) values (
      p_user, s.date, s.start_time, s.sport, s.title, s.notes, s.duration_min, s.intensity,
      'planned', 'joint', s.id
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.workouts w
  set joint_session_id = s.id, date = s.date, start_time = coalesce(s.start_time, w.start_time)
  where w.id = p_workout_id and w.user_id = p_user and w.status = 'planned' and w.joint_session_id is null
  returning w.id into v_id;
  if v_id is null then
    perform private.raise_error('not_found', 'El entreno no existe, ya está completado o ya pertenece a otra quedada');
  end if;
  return v_id;
end;
$$;

create or replace function public.propose_joint_session(p_session jsonb, p_invitees uuid[], p_from_workout uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  v_invitees uuid[];
  v_id uuid;
  v_workout uuid;
begin
  perform private.check_joint_draft(p_session);
  v_invitees := private.check_invitees(v_me, p_invitees);

  insert into public.joint_sessions (
    organizer_id, sport, date, start_time, duration_min, intensity, title, location, notes
  ) values (
    v_me,
    p_session ->> 'sport',
    (p_session ->> 'date')::date,
    (p_session ->> 'startTime')::time,
    round(private.jsonb_number(p_session -> 'durationMin'))::int,
    coalesce(p_session ->> 'intensity', 'endurance'),
    private.trim_text(p_session ->> 'title'),
    nullif(private.trim_text(coalesce(p_session ->> 'location', '')), ''),
    nullif(private.trim_text(coalesce(p_session ->> 'notes', '')), '')
  )
  returning id into v_id;

  insert into public.joint_session_participants (session_id, user_id, status, responded_at)
  values (v_id, v_me, 'accepted', now());
  insert into public.joint_session_participants (session_id, user_id)
  select v_id, x from unnest(v_invitees) as x;

  v_workout := private.link_joint_workout(v_id, v_me, p_from_workout);
  update public.joint_session_participants set workout_id = v_workout
  where session_id = v_id and user_id = v_me;
  return v_id;
end;
$$;

create or replace function public.respond_joint_session(p_session_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  s public.joint_sessions%rowtype;
  p public.joint_session_participants%rowtype;
  v_workout uuid;
begin
  if p_accept is null then
    perform private.raise_error('validation', 'Indica si te apuntas a la quedada');
  end if;
  select * into s from public.joint_sessions where id = p_session_id for update;
  select * into p from public.joint_session_participants
  where session_id = p_session_id and user_id = v_me for update;
  if s.id is null or p.session_id is null then
    perform private.raise_error('not_found', 'Quedada no encontrada');
  end if;
  if s.organizer_id = v_me then
    perform private.raise_error('validation', 'Organizas esta quedada: no necesitas responder');
  end if;
  if s.status = 'cancelled' then
    perform private.raise_error('conflict', 'Esta quedada se ha cancelado');
  end if;

  if p_accept then
    if p.status = 'accepted' and p.workout_id is not null then
      return;
    end if;
    -- Accept first: the workout guard requires a non-declined participant.
    update public.joint_session_participants
    set status = 'accepted', responded_at = now()
    where session_id = s.id and user_id = v_me;
    select w.id into v_workout from public.workouts w
    where w.joint_session_id = s.id and w.user_id = v_me limit 1;
    if v_workout is null then
      v_workout := private.link_joint_workout(s.id, v_me, null);
    end if;
    update public.joint_session_participants set workout_id = v_workout
    where session_id = s.id and user_id = v_me;
    update public.joint_sessions set status = 'confirmed' where id = s.id and status = 'proposed';
    return;
  end if;

  if p.status = 'declined' then
    return;
  end if;
  update public.joint_session_participants
  set status = 'declined', responded_at = now(), workout_id = null
  where session_id = s.id and user_id = v_me;
  delete from public.workouts w where w.joint_session_id = s.id and w.user_id = v_me and w.status = 'planned';
  update public.workouts w set joint_session_id = null where w.joint_session_id = s.id and w.user_id = v_me;
  update public.joint_sessions js set status = 'proposed'
  where js.id = s.id and js.status = 'confirmed'
    and not exists (
      select 1 from public.joint_session_participants x
      where x.session_id = s.id and x.user_id <> s.organizer_id and x.status = 'accepted'
    );
end;
$$;

create or replace function public.cancel_joint_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  s public.joint_sessions%rowtype;
begin
  select * into s from public.joint_sessions where id = p_session_id for update;
  if s.id is null or not private.is_session_participant(s.id, v_me) then
    perform private.raise_error('not_found', 'Quedada no encontrada');
  end if;
  if s.organizer_id <> v_me then
    perform private.raise_error('forbidden', 'Solo quien organiza la quedada puede cancelarla');
  end if;
  if s.status = 'cancelled' then
    return;
  end if;

  delete from public.workouts w
  where w.joint_session_id = s.id and w.user_id <> v_me and w.status = 'planned';
  update public.workouts w set joint_session_id = null where w.joint_session_id = s.id;
  update public.joint_session_participants set workout_id = null where session_id = s.id;
  update public.joint_sessions set status = 'cancelled' where id = s.id;
end;
$$;

create or replace function public.list_joint_sessions(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    perform private.raise_error('validation', 'Rango de fechas no válido');
  end if;
  select coalesce(jsonb_agg(private.joint_session_json(s.id) order by s.date, s.start_time nulls first, s.created_at), '[]'::jsonb)
  into v_result
  from public.joint_sessions s
  where s.id in (select private.session_ids_for(v_me))
    and s.date between p_from and p_to;
  return v_result;
end;
$$;

-- Single session (null when it does not exist or the caller does not take part).
create or replace function public.get_joint_session(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.joint_session_json(s.id)
  from public.joint_sessions s
  where s.id = p_session_id and private.is_session_participant(s.id, private.require_uid());
$$;
