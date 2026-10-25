-- Rebufo — social feed, kudos, notification inbox helpers and push tokens.

-- Own + friends' events, newest first. Masking is re-applied at read time so a later change of
-- visibility is respected: 'busy' friends show no workouts, 'summary' friends show no titles.
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
    case when e.actor_id <> me.id and p.visibility = 'summary'
      then e.payload - 'title' - 'name' else e.payload end,
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

-- Toggles the caller's kudos on a visible event; returns true when the event is now kudoed.
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
    select 1 from public.activity_events e
    where e.id = p_event_id and (e.actor_id = v_me or private.are_friends(e.actor_id, v_me))
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

-- Upserts an Expo push token and (re)assigns it to the caller.
create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  v_token text := private.trim_text(coalesce(p_token, ''));
begin
  if v_token = '' or char_length(v_token) > 300 then
    perform private.raise_error('validation', 'Token de notificaciones no válido');
  end if;
  if coalesce(p_platform, '') not in ('ios', 'android', 'web') then
    perform private.raise_error('validation', 'Plataforma no válida');
  end if;
  insert into public.push_tokens (token, user_id, platform)
  values (v_token, v_me, p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now();
end;
$$;

-- Marks the given notifications (or all when null) as read.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications n
  set read_at = now()
  where n.user_id = private.require_uid()
    and n.read_at is null
    and (p_ids is null or n.id = any(p_ids));
$$;
