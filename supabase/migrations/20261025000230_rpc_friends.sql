-- Rebufo — friends, profile search and the masked friend calendar.

-- ---------------------------------------------------------------------------
-- Usernames
-- ---------------------------------------------------------------------------
create or replace function private.normalize_username(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(private.trim_text(coalesce(p, '')), '^@', ''));
$$;

-- True when the username is well formed and not used by someone else (own name counts as free).
create or replace function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.normalize_username(p_username) ~ '^[a-z0-9_.]{3,24}$'
    and not exists (
      select 1 from public.profiles p
      where p.username = private.normalize_username(p_username)
        and p.id is distinct from auth.uid()
    );
$$;

-- ---------------------------------------------------------------------------
-- Friend requests
-- ---------------------------------------------------------------------------
create or replace function public.send_friend_request(p_username text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  v_name text := private.normalize_username(p_username);
  v_target uuid;
  v_row public.friendships%rowtype;
  v_id uuid;
begin
  if v_name = '' then
    perform private.raise_error('validation', 'Escribe un nombre de usuario');
  end if;
  select p.id into v_target from public.profiles p where p.username = v_name;
  if v_target is null then
    perform private.raise_error('not_found', format('No hay nadie con el usuario @%s', v_name));
  end if;
  if v_target = v_me then
    perform private.raise_error('validation', 'No puedes enviarte una solicitud a ti mismo');
  end if;

  select * into v_row from public.friendships f
  where least(f.requester_id, f.addressee_id) = least(v_me, v_target)
    and greatest(f.requester_id, f.addressee_id) = greatest(v_me, v_target)
  for update;

  if v_row.id is null then
    insert into public.friendships (requester_id, addressee_id)
    values (v_me, v_target)
    returning id into v_id;
    return v_id;
  end if;

  if v_row.status = 'accepted' then
    perform private.raise_error('conflict', 'Ya sois amigos');
  elsif v_row.status = 'blocked' then
    perform private.raise_error('forbidden', 'No puedes enviar una solicitud a este usuario');
  elsif v_row.status = 'pending' and v_row.requester_id = v_me then
    return v_row.id;  -- already sent: idempotent
  elsif v_row.status = 'pending' then
    -- They had already asked me: sending back means accepting.
    update public.friendships set status = 'accepted', responded_at = now() where id = v_row.id;
  else
    -- Previously declined: start a fresh request from me.
    update public.friendships
    set requester_id = v_me, addressee_id = v_target, status = 'pending',
        created_at = now(), responded_at = null
    where id = v_row.id;
  end if;
  return v_row.id;
end;
$$;

create or replace function public.respond_friend_request(p_friendship_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  v_status text;
begin
  if p_accept is null then
    perform private.raise_error('validation', 'Indica si aceptas la solicitud');
  end if;
  select f.status into v_status
  from public.friendships f
  where f.id = p_friendship_id and f.addressee_id = v_me
  for update;
  if v_status is null then
    perform private.raise_error('not_found', 'Solicitud no encontrada');
  end if;
  if v_status <> 'pending' then
    perform private.raise_error('conflict', 'Esta solicitud ya no está pendiente');
  end if;
  update public.friendships
  set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
  where id = p_friendship_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Friends list
-- ---------------------------------------------------------------------------
create or replace function public.svc_list_friends(p_user uuid)
returns table (
  friendship_id uuid, status text, direction text, created_at timestamptz,
  friend_id uuid, username text, display_name text, avatar_url text, sports text[],
  visibility text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    f.id,
    f.status,
    case when f.status = 'accepted' then 'mutual'
         when f.requester_id = p_user then 'outgoing'
         else 'incoming' end,
    f.created_at,
    p.id, p.username, p.display_name, p.avatar_url, p.sports,
    -- What the friend shares with me; only meaningful (and only exposed) once accepted.
    case when f.status = 'accepted' then p.visibility end
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = p_user then f.addressee_id else f.requester_id end
  where p_user in (f.requester_id, f.addressee_id)
    and f.status in ('pending', 'accepted')
  order by
    case when f.status = 'pending' and f.addressee_id = p_user then 0
         when f.status = 'accepted' then 1 else 2 end,
    p.display_name;
$$;

create or replace function public.list_friends()
returns table (
  friendship_id uuid, status text, direction text, created_at timestamptz,
  friend_id uuid, username text, display_name text, avatar_url text, sports text[],
  visibility text
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.svc_list_friends(private.require_uid());
$$;

-- ---------------------------------------------------------------------------
-- Profile search (username or display name, ≥ 2 chars, max 20, excludes self)
-- ---------------------------------------------------------------------------
create or replace function public.search_profiles(p_query text)
returns table (id uuid, username text, display_name text, avatar_url text, sports text[])
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select
      left(private.normalize_username(p_query), 60) as term,
      private.require_uid() as me
  ), pattern as (
    select q.me, q.term,
      '%' || replace(replace(replace(q.term, '\', '\\'), '%', '\%'), '_', '\_') || '%' as anywhere,
      replace(replace(replace(q.term, '\', '\\'), '%', '\%'), '_', '\_') || '%' as prefix
    from q
    where char_length(q.term) >= 2
  )
  select p.id, p.username, p.display_name, p.avatar_url, p.sports
  from public.profiles p, pattern
  where p.id <> pattern.me
    and (p.username ilike pattern.anywhere or p.display_name ilike pattern.anywhere)
  order by (p.username = pattern.term) desc, (p.username ilike pattern.prefix) desc, p.display_name, p.username
  limit 20;
$$;

-- ---------------------------------------------------------------------------
-- Friend calendar, masked by the friend's visibility:
--   full    → workouts (with titles) + shareable life events (with titles) + busy time
--   summary → same without any title
--   busy    → only 'busy' intervals (busy blocks, timed workouts, timed shareable events, travel days)
-- Busy-block titles are NEVER returned; health life events (injury, illness, overload, stress) and
-- work/exam/other are NEVER returned. Intervals are split per day in the friend's time zone.
-- ---------------------------------------------------------------------------
create or replace function private.friend_busy_intervals(p_friend uuid, p_from date, p_to date, p_visibility text, p_tz text)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.starts_at, b.ends_at
  from public.busy_blocks b
  where b.user_id = p_friend
    and b.starts_at < ((p_to + 1)::timestamp at time zone p_tz)
    and b.ends_at > (p_from::timestamp at time zone p_tz)
  union all
  select (w.date + w.start_time) at time zone p_tz,
         ((w.date + w.start_time) at time zone p_tz) + make_interval(mins => w.duration_min)
  from public.workouts w
  where p_visibility = 'busy' and w.user_id = p_friend
    and w.date between p_from - 1 and p_to
    and w.start_time is not null and w.duration_min > 0 and w.status <> 'skipped'
  union all
  select (e.start_date + e.start_time) at time zone p_tz,
         ((e.start_date + e.start_time) at time zone p_tz) + make_interval(mins => e.duration_min)
  from public.life_events e
  where p_visibility = 'busy' and e.user_id = p_friend
    and e.kind in ('padel', 'football', 'other_sport', 'travel', 'social')
    and e.start_time is not null and coalesce(e.duration_min, 0) > 0
    and e.start_date between p_from - 1 and p_to
  union all
  select (g.d::date)::timestamp at time zone p_tz, (g.d::date + 1)::timestamp at time zone p_tz
  from public.life_events e
  cross join lateral generate_series(greatest(e.start_date, p_from), least(e.end_date, p_to), interval '1 day') as g(d)
  where p_visibility = 'busy' and e.user_id = p_friend
    and e.kind = 'travel' and e.start_time is null
    and e.start_date <= p_to and e.end_date >= p_from;
$$;

create or replace function private.friend_week_items(p_friend uuid, p_from date, p_to date, p_visibility text, p_tz text)
returns table (
  kind text, id uuid, date date, start_time time, end_time time, duration_min integer,
  sport text, intensity text, title text, status text, joint_session_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select g.d::date as day,
           (g.d::date)::timestamp at time zone p_tz as day_start,
           (g.d::date + 1)::timestamp at time zone p_tz as day_end
    from generate_series(p_from, p_to, interval '1 day') as g(d)
  ),
  busy as (
    select 'busy'::text as kind, null::uuid as id, d.day as date,
      (greatest(i.starts_at, d.day_start) at time zone p_tz)::time as start_time,
      case when i.ends_at >= d.day_end then time '23:59' else (i.ends_at at time zone p_tz)::time end as end_time,
      (extract(epoch from least(i.ends_at, d.day_end) - greatest(i.starts_at, d.day_start)) / 60)::integer as duration_min,
      null::text as sport, null::text as intensity, null::text as title, null::text as status,
      null::uuid as joint_session_id
    from private.friend_busy_intervals(p_friend, p_from, p_to, p_visibility, p_tz) i
    join days d on i.starts_at < d.day_end and i.ends_at > d.day_start
  ),
  workout_items as (
    select 'workout'::text, w.id, w.date, w.start_time,
      case when w.start_time is null then null
           when extract(epoch from w.start_time) / 60 + w.duration_min < 1440
             then w.start_time + make_interval(mins => w.duration_min)
           else time '23:59' end,
      w.duration_min, w.sport, w.intensity,
      case when p_visibility = 'full' then w.title end,
      w.status, w.joint_session_id
    from public.workouts w
    where p_visibility in ('full', 'summary') and w.user_id = p_friend
      and w.date between p_from and p_to
  ),
  event_items as (
    select 'event'::text, e.id, g.d::date,
      case when g.d::date = e.start_date then e.start_time end,
      case when g.d::date = e.start_date and e.start_time is not null and e.duration_min is not null
             and extract(epoch from e.start_time) / 60 + e.duration_min < 1440
             then e.start_time + make_interval(mins => e.duration_min)
           when g.d::date = e.start_date and e.start_time is not null and e.duration_min is not null
             then time '23:59' end,
      e.duration_min, null::text, null::text,
      case when p_visibility = 'full' then e.title end,
      null::text, null::uuid
    from public.life_events e
    cross join lateral generate_series(greatest(e.start_date, p_from), least(e.end_date, p_to), interval '1 day') as g(d)
    where p_visibility in ('full', 'summary') and e.user_id = p_friend
      and e.kind in ('padel', 'football', 'other_sport', 'travel', 'social')
      and e.start_date <= p_to and e.end_date >= p_from
  )
  select * from busy
  union all select * from workout_items
  union all select * from event_items
  order by date, start_time nulls first, kind, end_time nulls first, duration_min;
$$;

create or replace function public.svc_get_friend_week(p_viewer uuid, p_friend uuid, p_from date, p_to date)
returns table (
  kind text, id uuid, date date, start_time time, end_time time, duration_min integer,
  sport text, intensity text, title text, status text, joint_session_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_visibility text;
  v_tz text;
begin
  if p_viewer is null then
    perform private.raise_error('not_authenticated', 'Tienes que iniciar sesión');
  end if;
  if p_friend is null or p_from is null or p_to is null then
    perform private.raise_error('validation', 'Faltan el amigo o las fechas');
  end if;
  if p_to < p_from or p_to - p_from > 30 then
    perform private.raise_error('validation', 'El rango de fechas debe ser de 1 a 31 días');
  end if;
  if not private.are_friends(p_viewer, p_friend) then
    perform private.raise_error('forbidden', 'Solo puedes ver el calendario de tus amigos');
  end if;

  select p.visibility, private.safe_tz(p.timezone) into v_visibility, v_tz
  from public.profiles p where p.id = p_friend;

  return query select * from private.friend_week_items(p_friend, p_from, p_to, v_visibility, v_tz);
end;
$$;

create or replace function public.get_friend_week(p_friend uuid, p_from date, p_to date)
returns table (
  kind text, id uuid, date date, start_time time, end_time time, duration_min integer,
  sport text, intensity text, title text, status text, joint_session_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.svc_get_friend_week(private.require_uid(), p_friend, p_from, p_to);
$$;
