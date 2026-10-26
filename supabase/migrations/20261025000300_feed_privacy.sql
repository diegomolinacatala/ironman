-- Road to Ironman — feed privacy hardening.
--
-- 1. activity_events and kudos are no longer readable or writable by clients. Stored payloads are
--    written at event time, so a direct `select` ignored later visibility changes (a friend who
--    switched to 'busy'/'summary' kept leaking old titles). The app reads the feed only through
--    list_feed() and writes kudos only through toggle_kudos(), both security definer, which
--    re-apply the masking at read time.
-- 2. joint_confirmed events no longer store participant names. list_feed() rebuilds the list for
--    each viewer from the live session: names only for participants the viewer may see (the
--    viewer, or friends of the viewer whose visibility is not 'busy'); the rest are counted in
--    `othersCount`. Session participants see every accepted name (as in get_joint_session).

-- ---------------------------------------------------------------------------
-- 1. No direct client access to the feed tables (RLS stays on, no policies).
-- ---------------------------------------------------------------------------
drop policy if exists kudos_select_visible on public.kudos;
drop policy if exists kudos_insert_own on public.kudos;
drop policy if exists kudos_delete_own on public.kudos;
drop policy if exists activity_events_select_visible on public.activity_events;

revoke all on public.activity_events from anon, authenticated;
revoke all on public.kudos from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Read-time masking helpers
-- ---------------------------------------------------------------------------

-- Accepted participants of a quedada as seen by p_viewer:
-- {participants: [names the viewer may see], othersCount: hidden ones}.
create or replace function private.joint_feed_participants(p_viewer uuid, p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with parts as (
    select p.user_id, pr.display_name, pr.visibility
    from public.joint_session_participants p
    join public.profiles pr on pr.id = p.user_id
    where p.session_id = p_session_id and p.status = 'accepted'
  ),
  shown as (
    select parts.display_name,
      coalesce(
        inside.yes
          or parts.user_id = p_viewer
          or (parts.visibility <> 'busy' and private.are_friends(p_viewer, parts.user_id)),
        false
      ) as visible
    from parts
    cross join (select private.is_session_participant(p_session_id, p_viewer) as yes) inside
  )
  select jsonb_build_object(
    'participants',
    coalesce(jsonb_agg(shown.display_name order by shown.display_name) filter (where shown.visible), '[]'::jsonb),
    'othersCount',
    count(*) filter (where not shown.visible)
  )
  from shown;
$$;

-- Payload of a feed event as seen by p_viewer: no title/name when the actor shares 'summary',
-- joint participants rebuilt per viewer.
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
    when p_type = 'joint_confirmed' then
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

revoke all on function private.joint_feed_participants(uuid, uuid) from public, anon, authenticated;
revoke all on function private.feed_payload(uuid, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function private.joint_feed_participants(uuid, uuid) to service_role;
grant execute on function private.feed_payload(uuid, uuid, text, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- list_feed: same signature (grants preserved), payload masked per viewer.
-- ---------------------------------------------------------------------------
create or replace function public.list_feed(p_limit int default 30)
returns table (
  id uuid, actor_id uuid, actor_username text, actor_display_name text, actor_avatar_url text,
  actor_sports text[], type text, payload jsonb, created_at timestamptz,
  kudos_count integer, has_kudoed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select private.require_uid() as id)
  select
    e.id, e.actor_id, p.username, p.display_name, p.avatar_url, p.sports, e.type,
    private.feed_payload(me.id, e.actor_id, e.type, e.payload, p.visibility),
    e.created_at,
    (select count(*)::integer from public.kudos k where k.event_id = e.id),
    exists (select 1 from public.kudos k where k.event_id = e.id and k.user_id = me.id)
  from me
  join public.activity_events e
    on e.actor_id = me.id or e.actor_id in (select private.friend_ids(me.id))
  join public.profiles p on p.id = e.actor_id
  where e.actor_id = me.id or p.visibility <> 'busy'
  order by e.created_at desc, e.id
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

-- toggle_kudos: the event must be visible in the caller's feed (own, or a friend's whose
-- visibility is not 'busy'), exactly like list_feed.
create or replace function public.toggle_kudos(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
begin
  if not exists (
    select 1
    from public.activity_events e
    join public.profiles p on p.id = e.actor_id
    where e.id = p_event_id
      and (e.actor_id = v_me or (p.visibility <> 'busy' and private.are_friends(e.actor_id, v_me)))
  ) then
    perform private.raise_error('not_found', 'Publicación no encontrada');
  end if;

  delete from public.kudos k where k.event_id = p_event_id and k.user_id = v_me;
  if found then
    return false;
  end if;
  insert into public.kudos (event_id, user_id) values (p_event_id, v_me);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- joint_confirmed events: store the session facts only (no participant names).
-- ---------------------------------------------------------------------------
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
        'durationMin', new.duration_min
      )));
    end if;
  end if;
  return null;
end;
$$;

-- Events written before this migration may carry participant names: drop them from storage
-- (list_feed rebuilds the list at read time).
update public.activity_events e
set payload = (e.payload - 'participants') - 'participantIds'
where e.type = 'joint_confirmed' and (e.payload ? 'participants' or e.payload ? 'participantIds');
