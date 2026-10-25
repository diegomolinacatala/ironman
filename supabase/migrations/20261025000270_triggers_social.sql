-- Rebufo — notification + feed triggers.
-- Notifications are the in-app inbox and the push outbox (push-dispatch sends rows with pushed_at null).
-- data.url is an Expo Router path the app opens on tap.

create or replace function private.notify(p_user uuid, p_type text, p_title text, p_body text, p_data jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, type, title, body, data)
  values (p_user, p_type, left(p_title, 120), left(coalesce(p_body, ''), 500), coalesce(p_data, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Friendships: request (→ addressee) and accepted (→ requester)
-- ---------------------------------------------------------------------------
create or replace function private.on_friendship_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_username text;
begin
  if new.status = 'pending'
    and (tg_op = 'INSERT' or old.status <> 'pending' or old.requester_id <> new.requester_id) then
    select p.display_name, p.username into v_name, v_username
    from public.profiles p where p.id = new.requester_id;
    perform private.notify(
      new.addressee_id, 'friend_request', 'Nueva solicitud de amistad',
      format('%s (@%s) quiere entrenar contigo.', v_name, v_username),
      jsonb_build_object('url', '/notifications', 'friendshipId', new.id, 'fromUserId', new.requester_id)
    );
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status <> 'accepted' then
    perform private.notify(
      new.requester_id, 'friend_accepted',
      format('%s ha aceptado tu solicitud', private.display_name_of(new.addressee_id)),
      'Ya podéis ver vuestros calendarios y quedar para entrenar.',
      jsonb_build_object('url', '/friends/' || new.addressee_id, 'friendshipId', new.id, 'friendId', new.addressee_id)
    );
  end if;
  return null;
end;
$$;

drop trigger if exists friendships_notify on public.friendships;
create trigger friendships_notify
  after insert or update on public.friendships
  for each row execute function private.on_friendship_change();

-- ---------------------------------------------------------------------------
-- Joint sessions: invite (→ invitee), response (→ organizer), cancel (→ others), confirm (feed)
-- ---------------------------------------------------------------------------
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
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('accepted', 'declined') then
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

drop trigger if exists joint_participants_notify on public.joint_session_participants;
create trigger joint_participants_notify
  after insert or update of status on public.joint_session_participants
  for each row execute function private.on_joint_participant_change();

create or replace function private.on_joint_session_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visibility text;
begin
  if new.status = old.status then
    return null;
  end if;

  if new.status = 'cancelled' then
    insert into public.notifications (user_id, type, title, body, data)
    select p.user_id, 'joint_cancelled', 'Quedada cancelada',
      left(format('%s ha cancelado «%s» (%s).', private.display_name_of(new.organizer_id), new.title,
        private.format_when_es(new.date, new.start_time)), 500),
      jsonb_build_object('url', '/joint/' || new.id, 'jointSessionId', new.id, 'fromUserId', new.organizer_id)
    from public.joint_session_participants p
    where p.session_id = new.id and p.user_id <> new.organizer_id and p.status <> 'declined';
  elsif new.status = 'confirmed' and old.status = 'proposed' then
    select pr.visibility into v_visibility from public.profiles pr where pr.id = new.organizer_id;
    if v_visibility in ('full', 'summary') and not exists (
      select 1 from public.activity_events e
      where e.type = 'joint_confirmed' and e.payload ->> 'jointSessionId' = new.id::text
    ) then
      insert into public.activity_events (actor_id, type, payload)
      values (new.organizer_id, 'joint_confirmed', jsonb_strip_nulls(jsonb_build_object(
        'jointSessionId', new.id,
        'sport', new.sport,
        'title', case when v_visibility = 'full' then new.title end,
        'date', new.date,
        'startTime', to_char(new.start_time, 'HH24:MI'),
        'durationMin', new.duration_min,
        'participants', (
          select coalesce(jsonb_agg(pr.display_name order by pr.display_name), '[]'::jsonb)
          from public.joint_session_participants p
          join public.profiles pr on pr.id = p.user_id
          where p.session_id = new.id and p.status = 'accepted'
        )
      )));
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists joint_sessions_status on public.joint_sessions;
create trigger joint_sessions_status
  after update of status on public.joint_sessions
  for each row execute function private.on_joint_session_status();

-- ---------------------------------------------------------------------------
-- Plan proposals from the AI coach or the user's Claude (→ owner)
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
  if new.source not in ('claude', 'ai_coach') or v_count = 0 then
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

drop trigger if exists plan_proposals_notify on public.plan_proposals;
create trigger plan_proposals_notify
  after insert on public.plan_proposals
  for each row execute function private.on_plan_proposal_insert();

-- ---------------------------------------------------------------------------
-- Kudos (→ event actor), deduplicated per giver/event/day
-- ---------------------------------------------------------------------------
create or replace function private.on_kudos_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.activity_events%rowtype;
begin
  select * into e from public.activity_events where id = new.event_id;
  if e.id is null or e.actor_id = new.user_id then
    return null;
  end if;
  if exists (
    select 1 from public.notifications n
    where n.user_id = e.actor_id and n.type = 'kudos'
      and n.data ->> 'eventId' = e.id::text and n.data ->> 'fromUserId' = new.user_id::text
      and n.created_at > now() - interval '1 day'
  ) then
    return null;
  end if;
  perform private.notify(
    e.actor_id, 'kudos',
    format('%s te ha dado kudos', private.display_name_of(new.user_id)),
    case e.type
      when 'workout_completed' then coalesce('Por «' || (e.payload ->> 'title') || '»', 'Por tu entreno')
      when 'race_added' then 'Por tu nueva carrera'
      when 'joint_confirmed' then 'Por vuestra quedada'
      else 'Por tu actividad' end,
    jsonb_build_object('url', '/together', 'eventId', e.id, 'fromUserId', new.user_id)
  );
  return null;
end;
$$;

drop trigger if exists kudos_notify on public.kudos;
create trigger kudos_notify
  after insert on public.kudos
  for each row execute function private.on_kudos_insert();

-- ---------------------------------------------------------------------------
-- Feed: completed workouts (skipped for 'busy' visibility, no title for 'summary')
-- ---------------------------------------------------------------------------
create or replace function private.on_workout_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visibility text;
begin
  if new.status <> 'completed' or new.sport = 'rest'
    or (tg_op = 'UPDATE' and old.status = 'completed') then
    return null;
  end if;
  select p.visibility into v_visibility from public.profiles p where p.id = new.user_id;
  if v_visibility is null or v_visibility = 'busy' then
    return null;
  end if;
  if exists (
    select 1 from public.activity_events e
    where e.actor_id = new.user_id and e.type = 'workout_completed'
      and e.payload ->> 'workoutId' = new.id::text
  ) then
    return null;
  end if;
  insert into public.activity_events (actor_id, type, payload)
  values (new.user_id, 'workout_completed', jsonb_strip_nulls(jsonb_build_object(
    'workoutId', new.id,
    'sport', new.sport,
    'title', case when v_visibility = 'full' then new.title end,
    'date', new.date,
    'durationMin', coalesce(round(private.jsonb_number(new.completed -> 'durationMin'))::int, new.duration_min),
    'distanceM', coalesce(round(private.jsonb_number(new.completed -> 'distanceM'))::int, new.distance_m),
    'jointSessionId', new.joint_session_id
  )));
  return null;
end;
$$;

drop trigger if exists workouts_feed on public.workouts;
create trigger workouts_feed
  after insert or update of status on public.workouts
  for each row execute function private.on_workout_completed();

-- Un-completing or deleting a completed workout removes its feed event (and its kudos).
create or replace function private.on_workout_uncompleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'completed' and (tg_op = 'DELETE' or new.status <> 'completed') then
    delete from public.activity_events e
    where e.actor_id = old.user_id and e.type = 'workout_completed'
      and e.payload ->> 'workoutId' = old.id::text;
  end if;
  return null;
end;
$$;

drop trigger if exists workouts_feed_cleanup on public.workouts;
create trigger workouts_feed_cleanup
  after delete or update of status on public.workouts
  for each row execute function private.on_workout_uncompleted();

-- Feed: new races (skipped for 'busy' visibility, no name for 'summary')
create or replace function private.on_race_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visibility text;
begin
  select p.visibility into v_visibility from public.profiles p where p.id = new.user_id;
  if v_visibility is null or v_visibility = 'busy' then
    return null;
  end if;
  insert into public.activity_events (actor_id, type, payload)
  values (new.user_id, 'race_added', jsonb_strip_nulls(jsonb_build_object(
    'raceId', new.id,
    'name', case when v_visibility = 'full' then new.name end,
    'date', new.date,
    'distance', new.distance,
    'priority', new.priority
  )));
  return null;
end;
$$;

drop trigger if exists races_feed on public.races;
create trigger races_feed
  after insert on public.races
  for each row execute function private.on_race_insert();

create or replace function private.on_race_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.activity_events e
  where e.actor_id = old.user_id and e.type = 'race_added' and e.payload ->> 'raceId' = old.id::text;
  return null;
end;
$$;

drop trigger if exists races_feed_cleanup on public.races;
create trigger races_feed_cleanup
  after delete on public.races
  for each row execute function private.on_race_delete();
