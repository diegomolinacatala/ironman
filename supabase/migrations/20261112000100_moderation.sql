-- Road to Ironman — moderation for the App Store (guideline 1.2: block abusive users and report
-- objectionable content).
--
-- * block_user: the pair's friendship row becomes `blocked`, owned by the blocker (requester_id).
--   Blocked rows are not friends (no calendars, feed, open quedadas) and are hidden from
--   list_friends; send_friend_request already refuses them.
-- * Only the blocker may delete a blocked row (= unblock); before, either party could delete it
--   and send a new request.
-- * report_user: stores a report for the owner to review (Table editor → user_reports).
-- * A block also hides each other in search and in the messages of quedadas they already share
--   (no messages either way, no comment notifications).

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reported_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('spam', 'harassment', 'inappropriate', 'other')),
  context text not null check (context in ('profile', 'request', 'comment')),
  target_id uuid,
  details text check (details is null or char_length(details) <= 500),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check (reporter_id <> reported_id)
);
create index if not exists user_reports_reporter_idx on public.user_reports (reporter_id, created_at);
create index if not exists user_reports_open_idx on public.user_reports (created_at) where reviewed_at is null;

alter table public.user_reports enable row level security;
revoke all on public.user_reports from anon, authenticated;
grant all on public.user_reports to service_role;

-- ---------------------------------------------------------------------------
-- Unblocking is the blocker's call.
-- ---------------------------------------------------------------------------
drop policy if exists friendships_delete_party on public.friendships;
create policy friendships_delete_party on public.friendships
  for delete to authenticated
  using (
    (select auth.uid()) in (requester_id, addressee_id)
    and (status <> 'blocked' or requester_id = (select auth.uid()))
  );

create or replace function private.is_blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'blocked'
      and least(f.requester_id, f.addressee_id) = least($1, $2)
      and greatest(f.requester_id, f.addressee_id) = greatest($1, $2)
  );
$$;

-- ---------------------------------------------------------------------------
-- block_user
-- ---------------------------------------------------------------------------
create or replace function public.block_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  v_id uuid;
  v_status text;
begin
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
    perform private.raise_error('not_found', 'No encontramos a esa persona');
  end if;
  if p_user = v_me then
    perform private.raise_error('validation', 'No puedes bloquearte a ti mismo');
  end if;

  select f.id, f.status into v_id, v_status from public.friendships f
  where least(f.requester_id, f.addressee_id) = least(v_me, p_user)
    and greatest(f.requester_id, f.addressee_id) = greatest(v_me, p_user)
  for update;

  if v_id is null then
    insert into public.friendships (requester_id, addressee_id, status, responded_at)
    values (v_me, p_user, 'blocked', now());
  elsif v_status = 'blocked' then
    -- Already blocked by either side: never hand the block (and the right to lift it) over.
    return;
  else
    update public.friendships
    set requester_id = v_me, addressee_id = p_user, status = 'blocked', responded_at = now()
    where id = v_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- report_user (max 20 a day per reporter, so it cannot be used to flood the table)
-- ---------------------------------------------------------------------------
create or replace function public.report_user(
  p_user uuid, p_reason text, p_context text, p_target uuid default null, p_details text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
begin
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
    perform private.raise_error('not_found', 'No encontramos a esa persona');
  end if;
  if p_user = v_me then
    perform private.raise_error('validation', 'No puedes denunciarte a ti mismo');
  end if;
  if p_reason is null or p_reason not in ('spam', 'harassment', 'inappropriate', 'other') then
    perform private.raise_error('validation', 'Elige un motivo');
  end if;
  if p_context is null or p_context not in ('profile', 'request', 'comment') then
    perform private.raise_error('validation', 'Denuncia no válida');
  end if;
  if v_details is not null and char_length(v_details) > 500 then
    perform private.raise_error('validation', 'Máximo 500 caracteres');
  end if;
  if (select count(*) from public.user_reports r
      where r.reporter_id = v_me and r.created_at > now() - interval '1 day') >= 20 then
    perform private.raise_error('rate_limited', 'Has enviado muchas denuncias hoy. Inténtalo mañana.');
  end if;

  insert into public.user_reports (reporter_id, reported_id, reason, context, target_id, details)
  values (v_me, p_user, p_reason, p_context, p_target, v_details);
end;
$$;

-- ---------------------------------------------------------------------------
-- Blocked pairs: hidden in search and in shared quedada messages
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
    and not private.is_blocked(p.id, pattern.me)
    and (p.username ilike pattern.anywhere or p.display_name ilike pattern.anywhere)
  order by (p.username = pattern.term) desc, (p.username ilike pattern.prefix) desc, p.display_name, p.username
  limit 20;
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
      and (c.user_id = v_me or not private.is_blocked(c.user_id, v_me))
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
  where p.session_id = s.id and p.user_id <> v_me and p.status <> 'declined'
    and not private.is_blocked(p.user_id, v_me);

  return private.joint_comment_json(c);
end;
$$;

revoke all on function private.is_blocked(uuid, uuid) from public, anon, authenticated;
revoke all on function public.block_user(uuid) from public, anon;
revoke all on function public.report_user(uuid, text, text, uuid, text) from public, anon;
grant execute on function public.block_user(uuid) to authenticated, service_role;
grant execute on function public.report_user(uuid, text, text, uuid, text) to authenticated, service_role;
