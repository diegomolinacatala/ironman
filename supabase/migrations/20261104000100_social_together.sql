-- Road to Ironman — "Juntos" v3 (CLAUDE.md, social next steps):
--   * open quedadas (any accepted friend of the organizer can join) + notification to friends,
--   * editing a quedada (organizer) keeps every linked workout in sync and notifies the others,
--   * short comments per quedada (participants only),
--   * "entrenasteis juntos": one feed event once every accepted participant completed the session,
--   * friends' upcoming races (shared race countdown), masked by visibility,
--   * service-role propose for the MCP connector (svc_propose_joint_session).

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------
alter table public.joint_sessions add column if not exists is_open boolean not null default false;
comment on column public.joint_sessions.is_open is 'Open quedada: any accepted friend of the organizer may join.';

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'friend_request', 'friend_accepted', 'joint_invite', 'joint_response',
  'joint_cancelled', 'plan_updated', 'friend_completed', 'kudos',
  'joint_updated', 'joint_comment', 'joint_open'
));

alter table public.activity_events drop constraint if exists activity_events_type_check;
alter table public.activity_events add constraint activity_events_type_check check (type in (
  'workout_completed', 'race_added', 'joint_confirmed', 'plan_updated', 'joint_completed'
));

create table if not exists public.joint_session_comments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.joint_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists joint_session_comments_session_idx on public.joint_session_comments (session_id, created_at);

-- Read and written only through the RPCs below (security definer).
alter table public.joint_session_comments enable row level security;
revoke all on public.joint_session_comments from anon, authenticated;
grant all on public.joint_session_comments to service_role;

-- ---------------------------------------------------------------------------
-- 2. JSON of a quedada: adds isOpen (same shape otherwise)
-- ---------------------------------------------------------------------------
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
    'isOpen', s.is_open,
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

-- ---------------------------------------------------------------------------
-- 3. Propose: shared body for the app (auth.uid()) and the MCP (service role)
-- ---------------------------------------------------------------------------
create or replace function private.propose_joint_session_as(
  p_me uuid, p_session jsonb, p_invitees uuid[], p_from_workout uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open boolean := coalesce(p_session ->> 'isOpen', 'false') = 'true';
  v_invitees uuid[];
  v_id uuid;
  v_workout uuid;
begin
  -- Anti-spam (invites and joint_open notify friends): a few per day is plenty.
  if (
    select count(*) from public.joint_sessions s
    where s.organizer_id = p_me and s.created_at > now() - interval '24 hours'
  ) >= 15 then
    perform private.raise_error('conflict', 'Has propuesto muchas quedadas hoy. Prueba mañana.');
  end if;
  perform private.check_joint_draft(p_session);
  if v_open and cardinality(coalesce(p_invitees, '{}'::uuid[])) = 0 then
    v_invitees := '{}'::uuid[];
  else
    v_invitees := private.check_invitees(p_me, p_invitees);
  end if;

  insert into public.joint_sessions (
    organizer_id, sport, date, start_time, duration_min, intensity, title, location, notes, is_open
  ) values (
    p_me,
    p_session ->> 'sport',
    (p_session ->> 'date')::date,
    (p_session ->> 'startTime')::time,
    round(private.jsonb_number(p_session -> 'durationMin'))::int,
    coalesce(p_session ->> 'intensity', 'endurance'),
    private.trim_text(p_session ->> 'title'),
    nullif(private.trim_text(coalesce(p_session ->> 'location', '')), ''),
    nullif(private.trim_text(coalesce(p_session ->> 'notes', '')), ''),
    v_open
  )
  returning id into v_id;

  insert into public.joint_session_participants (session_id, user_id, status, responded_at)
  values (v_id, p_me, 'accepted', now());
  insert into public.joint_session_participants (session_id, user_id)
  select v_id, x from unnest(v_invitees) as x;

  v_workout := private.link_joint_workout(v_id, p_me, p_from_workout);
  update public.joint_session_participants set workout_id = v_workout
  where session_id = v_id and user_id = p_me;

  -- Open quedada: every other friend hears about it once (invitees already got joint_invite).
  if v_open then
    insert into public.notifications (user_id, type, title, body, data)
    select f, 'joint_open',
      left(format('%s abre una quedada', private.display_name_of(p_me)), 120),
      left(format('%s · %s. Apúntate si te encaja.', private.trim_text(p_session ->> 'title'),
        private.format_when_es((p_session ->> 'date')::date, (p_session ->> 'startTime')::time)), 500),
      jsonb_build_object('url', '/joint/' || v_id, 'jointSessionId', v_id, 'fromUserId', p_me)
    from private.friend_ids(p_me) as f
    where not (f = any(v_invitees));
  end if;
  return v_id;
end;
$$;

create or replace function public.propose_joint_session(p_session jsonb, p_invitees uuid[], p_from_workout uuid default null)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.propose_joint_session_as(private.require_uid(), p_session, p_invitees, p_from_workout);
$$;

-- MCP connector (Edge Function, service role): returns the created quedada as JSON.
create or replace function public.svc_propose_joint_session(p_user uuid, p_session jsonb, p_invitees uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
    perform private.raise_error('not_found', 'Usuario no encontrado');
  end if;
  v_id := private.propose_joint_session_as(p_user, p_session, p_invitees, null);
  return private.joint_session_json(v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Open quedadas: list (friends' open ones I am not in) and join.
--    Opening a quedada is a deliberate publication to every friend: title, time, place and notes
--    are shown to them whatever the organizer's calendar visibility.
-- ---------------------------------------------------------------------------
create or replace function public.list_open_joint_sessions(p_from date, p_to date)
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
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 120 then
    perform private.raise_error('validation', 'Rango de fechas no válido');
  end if;
  -- Participants the viewer is not friends with are left out of the list.
  select coalesce(jsonb_agg(
      (j.v - 'participants') || jsonb_build_object('participants', coalesce((
        select jsonb_agg(x)
        from jsonb_array_elements(j.v -> 'participants') as x
        where (x ->> 'userId')::uuid = j.organizer_id or private.are_friends(v_me, (x ->> 'userId')::uuid)
      ), '[]'::jsonb))
      order by j.date, j.start_time nulls first
    ), '[]'::jsonb)
  into v_result
  from (
    select private.joint_session_json(s.id) as v, s.organizer_id, s.date, s.start_time
    from public.joint_sessions s
    where s.is_open
      and s.status <> 'cancelled'
      and s.date between greatest(p_from, current_date) and p_to
      and s.organizer_id in (select private.friend_ids(v_me))
      and not exists (
        select 1 from public.joint_session_participants p
        where p.session_id = s.id and p.user_id = v_me and p.status <> 'declined'
      )
  ) j;
  return v_result;
end;
$$;

create or replace function public.join_joint_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  s public.joint_sessions%rowtype;
  v_existing public.joint_session_participants%rowtype;
  v_workout uuid;
begin
  select * into s from public.joint_sessions where id = p_session_id for update;
  if s.id is null or not s.is_open or not private.are_friends(v_me, s.organizer_id) then
    perform private.raise_error('not_found', 'Quedada no encontrada');
  end if;
  if s.status = 'cancelled' then
    perform private.raise_error('conflict', 'Esta quedada se ha cancelado');
  end if;
  if s.date < current_date then
    perform private.raise_error('conflict', 'Esta quedada ya ha pasado');
  end if;

  select * into v_existing from public.joint_session_participants
  where session_id = s.id and user_id = v_me;
  if v_existing.session_id is not null then
    if v_existing.status = 'accepted' and v_existing.workout_id is not null then
      return private.joint_session_json(s.id);
    end if;
    perform public.respond_joint_session(s.id, true);
    return private.joint_session_json(s.id);
  end if;

  if (select count(*) from public.joint_session_participants p where p.session_id = s.id) >= 11 then
    perform private.raise_error('conflict', 'Esta quedada ya está completa');
  end if;
  insert into public.joint_session_participants (session_id, user_id, status, responded_at)
  values (s.id, v_me, 'accepted', now());
  v_workout := private.link_joint_workout(s.id, v_me, null);
  update public.joint_session_participants set workout_id = v_workout
  where session_id = s.id and user_id = v_me;
  update public.joint_sessions set status = 'confirmed' where id = s.id and status = 'proposed';
  return private.joint_session_json(s.id);
end;
$$;

-- Single quedada: participants, and also friends of the organizer for an open one (to join it);
-- those only see the participants they are friends with.
create or replace function public.get_joint_session(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  s public.joint_sessions%rowtype;
  v jsonb;
begin
  select * into s from public.joint_sessions where id = p_session_id;
  if s.id is null then
    return null;
  end if;
  if private.is_session_participant(s.id, v_me) then
    return private.joint_session_json(s.id);
  end if;
  if not s.is_open or not private.are_friends(v_me, s.organizer_id) then
    return null;
  end if;
  v := private.joint_session_json(s.id);
  return (v - 'participants') || jsonb_build_object('participants', coalesce((
    select jsonb_agg(x)
    from jsonb_array_elements(v -> 'participants') as x
    where (x ->> 'userId')::uuid = s.organizer_id or private.are_friends(v_me, (x ->> 'userId')::uuid)
  ), '[]'::jsonb));
end;
$$;

-- Participant trigger: also tells the organizer when someone joins an open quedada.
create or replace function private.on_joint_participant_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.joint_sessions%rowtype;
begin
  select * into s from public.joint_sessions where id = new.session_id;
  if s.id is null or new.user_id = s.organizer_id then
    return null;
  end if;

  if tg_op = 'INSERT' and new.status = 'invited' then
    perform private.notify(
      new.user_id, 'joint_invite',
      format('%s te invita a entrenar', private.display_name_of(s.organizer_id)),
      format('%s · %s', s.title, private.format_when_es(s.date, s.start_time)),
      jsonb_build_object('url', '/joint/' || s.id, 'jointSessionId', s.id, 'fromUserId', s.organizer_id)
    );
  elsif (tg_op = 'INSERT' and new.status = 'accepted')
    or (tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('accepted', 'declined')) then
    perform private.notify(
      s.organizer_id, 'joint_response',
      case when new.status = 'accepted'
        then format('%s se apunta a «%s»', private.display_name_of(new.user_id), s.title)
        else format('%s no puede ir a «%s»', private.display_name_of(new.user_id), s.title) end,
      private.format_when_es(s.date, s.start_time),
      jsonb_build_object('url', '/joint/' || s.id, 'jointSessionId', s.id, 'fromUserId', new.user_id, 'accepted', new.status = 'accepted')
    );
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Edit a quedada (organizer): linked planned workouts follow, others are told
-- ---------------------------------------------------------------------------
create or replace function public.update_joint_session(p_session_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  s public.joint_sessions%rowtype;
  v_merged jsonb;
  v_changed_when boolean;
  v_was_open boolean;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    perform private.raise_error('validation', 'Cambios no válidos');
  end if;
  select * into s from public.joint_sessions where id = p_session_id for update;
  if s.id is null or not private.is_session_participant(s.id, v_me) then
    perform private.raise_error('not_found', 'Quedada no encontrada');
  end if;
  if s.organizer_id <> v_me then
    perform private.raise_error('forbidden', 'Solo quien organiza la quedada puede cambiarla');
  end if;
  if s.status = 'cancelled' then
    perform private.raise_error('conflict', 'Esta quedada se ha cancelado');
  end if;

  v_merged := jsonb_build_object(
    'sport', s.sport,
    'date', s.date,
    'startTime', to_char(s.start_time, 'HH24:MI'),
    'durationMin', s.duration_min,
    'intensity', s.intensity,
    'title', s.title,
    'location', s.location,
    'notes', s.notes,
    'isOpen', s.is_open
  ) || (p_patch - 'id' - 'organizerId' - 'status' - 'participants');
  perform private.check_joint_draft(v_merged);
  if (v_merged ->> 'date')::date < current_date then
    perform private.raise_error('validation', 'No puedes mover la quedada al pasado');
  end if;

  v_was_open := s.is_open;
  v_changed_when := (v_merged ->> 'date')::date is distinct from s.date
    or (v_merged ->> 'startTime')::time is distinct from s.start_time;

  update public.joint_sessions set
    sport = v_merged ->> 'sport',
    date = (v_merged ->> 'date')::date,
    start_time = (v_merged ->> 'startTime')::time,
    duration_min = round(private.jsonb_number(v_merged -> 'durationMin'))::int,
    intensity = coalesce(v_merged ->> 'intensity', 'endurance'),
    title = private.trim_text(v_merged ->> 'title'),
    location = nullif(private.trim_text(coalesce(v_merged ->> 'location', '')), ''),
    notes = nullif(private.trim_text(coalesce(v_merged ->> 'notes', '')), ''),
    is_open = coalesce(v_merged ->> 'isOpen', 'false') = 'true'
  where id = s.id
  returning * into s;

  update public.workouts w set
    date = s.date,
    start_time = coalesce(s.start_time, w.start_time),
    sport = s.sport,
    title = s.title,
    duration_min = s.duration_min,
    intensity = s.intensity,
    description = s.notes
  where w.joint_session_id = s.id and w.status = 'planned';

  if s.is_open and not v_was_open then
    insert into public.notifications (user_id, type, title, body, data)
    select f, 'joint_open',
      left(format('%s abre una quedada', private.display_name_of(v_me)), 120),
      left(format('%s · %s. Apúntate si te encaja.', s.title, private.format_when_es(s.date, s.start_time)), 500),
      jsonb_build_object('url', '/joint/' || s.id, 'jointSessionId', s.id, 'fromUserId', v_me)
    from private.friend_ids(v_me) as f
    where not exists (
      select 1 from public.joint_session_participants p where p.session_id = s.id and p.user_id = f
    );
  end if;

  insert into public.notifications (user_id, type, title, body, data)
  select p.user_id, 'joint_updated',
    left(format('%s ha cambiado «%s»', private.display_name_of(v_me), s.title), 120),
    left(case when v_changed_when
      then format('Ahora es %s.', private.format_when_es(s.date, s.start_time))
      else format('%s · %s', private.format_when_es(s.date, s.start_time), coalesce(s.location, 'mira los detalles')) end, 500),
    jsonb_build_object('url', '/joint/' || s.id, 'jointSessionId', s.id, 'fromUserId', v_me)
  from public.joint_session_participants p
  where p.session_id = s.id and p.user_id <> v_me and p.status <> 'declined';

  return private.joint_session_json(s.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Comments per quedada (participants: organizer, invited or accepted)
-- ---------------------------------------------------------------------------
create or replace function private.joint_comment_json(c public.joint_session_comments)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'sessionId', c.session_id,
    'userId', c.user_id,
    'displayName', private.display_name_of(c.user_id),
    'body', c.body,
    'createdAt', c.created_at
  );
$$;

create or replace function public.list_joint_comments(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
begin
  if not private.is_session_participant(p_session_id, v_me) or exists (
    select 1 from public.joint_session_participants p
    where p.session_id = p_session_id and p.user_id = v_me and p.status = 'declined'
  ) then
    perform private.raise_error('not_found', 'Quedada no encontrada');
  end if;
  return coalesce((
    select jsonb_agg(private.joint_comment_json(c) order by c.created_at, c.id)
    from public.joint_session_comments c
    where c.session_id = p_session_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.add_joint_comment(p_session_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  v_body text := private.trim_text(coalesce(p_body, ''));
  s public.joint_sessions%rowtype;
  c public.joint_session_comments%rowtype;
begin
  select * into s from public.joint_sessions where id = p_session_id;
  if s.id is null or not private.is_session_participant(s.id, v_me) then
    perform private.raise_error('not_found', 'Quedada no encontrada');
  end if;
  if exists (
    select 1 from public.joint_session_participants p
    where p.session_id = s.id and p.user_id = v_me and p.status = 'declined'
  ) then
    perform private.raise_error('forbidden', 'Has dicho que no vas a esta quedada');
  end if;
  if v_body = '' then
    perform private.raise_error('validation', 'Escribe un mensaje');
  end if;
  if char_length(v_body) > 500 then
    perform private.raise_error('validation', 'Mensaje demasiado largo (máximo 500 caracteres)');
  end if;
  if (
    select count(*) from public.joint_session_comments x
    where x.session_id = s.id and x.user_id = v_me and x.created_at > now() - interval '1 minute'
  ) >= 5 then
    perform private.raise_error('conflict', 'Vas muy rápido: espera un momento antes de enviar otro mensaje.');
  end if;
  if (select count(*) from public.joint_session_comments x where x.session_id = s.id) >= 200 then
    perform private.raise_error('conflict', 'Esta quedada ya tiene demasiados mensajes');
  end if;

  insert into public.joint_session_comments (session_id, user_id, body)
  values (s.id, v_me, v_body)
  returning * into c;

  insert into public.notifications (user_id, type, title, body, data)
  select p.user_id, 'joint_comment',
    left(format('%s en «%s»', private.display_name_of(v_me), s.title), 120),
    left(v_body, 500),
    jsonb_build_object('url', '/joint/' || s.id, 'jointSessionId', s.id, 'fromUserId', v_me)
  from public.joint_session_participants p
  where p.session_id = s.id and p.user_id <> v_me and p.status <> 'declined';

  return private.joint_comment_json(c);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. "Entrenasteis juntos": once every accepted participant (2+) completed their linked workout
-- ---------------------------------------------------------------------------
create or replace function private.on_joint_workout_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.joint_sessions%rowtype;
  v_visibility text;
  v_accepted int;
  v_done int;
begin
  if new.joint_session_id is null or new.status <> 'completed'
    or (tg_op = 'UPDATE' and old.status = 'completed') then
    return null;
  end if;
  -- Row lock: two participants completing at the same instant must not both miss the event.
  select * into s from public.joint_sessions where id = new.joint_session_id for update;
  if s.id is null or s.status = 'cancelled' then
    return null;
  end if;
  select count(*), count(*) filter (where w.status = 'completed')
  into v_accepted, v_done
  from public.joint_session_participants p
  left join public.workouts w on w.id = p.workout_id
  where p.session_id = s.id and p.status = 'accepted';
  if v_accepted < 2 or v_done < v_accepted then
    return null;
  end if;
  select pr.visibility into v_visibility from public.profiles pr where pr.id = s.organizer_id;
  if v_visibility is null or v_visibility = 'busy' then
    return null;
  end if;
  if exists (
    select 1 from public.activity_events e
    where e.type = 'joint_completed' and e.payload ->> 'jointSessionId' = s.id::text
  ) then
    return null;
  end if;
  insert into public.activity_events (actor_id, type, payload)
  values (s.organizer_id, 'joint_completed', jsonb_strip_nulls(jsonb_build_object(
    'jointSessionId', s.id,
    'sport', s.sport,
    'title', case when v_visibility = 'full' then s.title end,
    'date', s.date,
    'durationMin', s.duration_min
  )));
  return null;
end;
$$;

drop trigger if exists workouts_joint_completed on public.workouts;
create trigger workouts_joint_completed
  after insert or update of status on public.workouts
  for each row execute function private.on_joint_workout_completed();

-- Un-completing a linked workout removes the "entrenasteis juntos" event.
create or replace function private.on_joint_workout_uncompleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.joint_session_id is not null and old.status = 'completed'
    and (tg_op = 'DELETE' or new.status <> 'completed') then
    delete from public.activity_events e
    where e.type = 'joint_completed' and e.payload ->> 'jointSessionId' = old.joint_session_id::text;
  end if;
  return null;
end;
$$;

drop trigger if exists workouts_joint_uncompleted on public.workouts;
create trigger workouts_joint_uncompleted
  after delete or update of status on public.workouts
  for each row execute function private.on_joint_workout_uncompleted();

-- The feed rebuilds participant names per viewer for both quedada events.
create or replace function private.feed_payload(
  p_viewer uuid, p_actor uuid, p_type text, p_payload jsonb, p_actor_visibility text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_type in ('joint_confirmed', 'joint_completed') then
      ((v.base - 'participants') - 'participantIds')
        || private.joint_feed_participants(p_viewer, private.try_uuid(v.base ->> 'jointSessionId'))
    else v.base
  end
  from (
    select case
      when p_actor <> p_viewer and p_actor_visibility = 'summary' then (p_payload - 'title') - 'name'
      else coalesce(p_payload, '{}'::jsonb)
    end as base
  ) v;
$$;

-- ---------------------------------------------------------------------------
-- 8. Friends' upcoming races (shared countdown): 'busy' friends are skipped, 'summary' ones
--    without the race name.
-- ---------------------------------------------------------------------------
create or replace function public.list_friend_races()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select private.require_uid() as id)
  select coalesce(jsonb_agg(jsonb_build_object(
      'friendId', pr.id,
      'displayName', pr.display_name,
      'raceId', r.id,
      'name', case when pr.visibility = 'full' then r.name end,
      'date', r.date,
      'distance', r.distance,
      'priority', r.priority
    ) order by r.date, pr.display_name), '[]'::jsonb)
  from me
  join public.profiles pr on pr.id in (select private.friend_ids(me.id))
  join public.races r on r.user_id = pr.id
  where pr.visibility <> 'busy' and r.date >= current_date;
$$;

-- ---------------------------------------------------------------------------
-- 9. Privileges: functions created after 20261025000290 keep Postgres' PUBLIC default.
-- ---------------------------------------------------------------------------
revoke all on function private.propose_joint_session_as(uuid, jsonb, uuid[], uuid) from public, anon, authenticated;
revoke all on function private.joint_comment_json(public.joint_session_comments) from public, anon, authenticated;
revoke all on function private.on_joint_workout_completed() from public, anon, authenticated;
revoke all on function private.on_joint_workout_uncompleted() from public, anon, authenticated;
revoke all on function public.svc_propose_joint_session(uuid, jsonb, uuid[]) from public, anon, authenticated;
revoke all on function public.list_open_joint_sessions(date, date) from public, anon;
revoke all on function public.join_joint_session(uuid) from public, anon;
revoke all on function public.update_joint_session(uuid, jsonb) from public, anon;
revoke all on function public.list_joint_comments(uuid) from public, anon;
revoke all on function public.add_joint_comment(uuid, text) from public, anon;
revoke all on function public.list_friend_races() from public, anon;

grant execute on function
  private.propose_joint_session_as(uuid, jsonb, uuid[], uuid),
  private.joint_comment_json(public.joint_session_comments),
  private.on_joint_workout_completed(),
  private.on_joint_workout_uncompleted(),
  public.svc_propose_joint_session(uuid, jsonb, uuid[]),
  public.list_open_joint_sessions(date, date),
  public.join_joint_session(uuid),
  public.update_joint_session(uuid, jsonb),
  public.list_joint_comments(uuid),
  public.add_joint_comment(uuid, text),
  public.list_friend_races()
to service_role;

grant execute on function
  public.list_open_joint_sessions(date, date),
  public.join_joint_session(uuid),
  public.update_joint_session(uuid, jsonb),
  public.list_joint_comments(uuid),
  public.add_joint_comment(uuid, text),
  public.list_friend_races()
to authenticated;
