-- Road to Ironman — private helpers, generic triggers and the sign-up hook.
--
-- Conventions for every function in this project:
-- * `security definer` functions live in schema `private` (not exposed by the Data API) or are
--   explicit RPCs in `public`; all of them use `set search_path = ''` and fully qualified names.
-- * User-facing errors are raised through private.raise_error(kind, message): the Spanish message
--   goes to `message`, and `hint` carries a stable machine code that matches the app's
--   RepositoryErrorCode ('not_authenticated' | 'forbidden' | 'not_found' | 'validation' |
--   'conflict' | 'rate_limited').

grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Owner defaults: clients may omit user_id; RLS still enforces ownership.
-- ---------------------------------------------------------------------------
alter table public.workouts alter column user_id set default auth.uid();
alter table public.races alter column user_id set default auth.uid();
alter table public.life_events alter column user_id set default auth.uid();
alter table public.busy_blocks alter column user_id set default auth.uid();
alter table public.daily_checkins alter column user_id set default auth.uid();
alter table public.daily_metrics alter column user_id set default auth.uid();
alter table public.nutrition_logs alter column user_id set default auth.uid();
alter table public.plan_proposals alter column user_id set default auth.uid();

-- ---------------------------------------------------------------------------
-- Errors
-- ---------------------------------------------------------------------------
create or replace function private.raise_error(p_kind text, p_message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    message = p_message,
    hint = p_kind,
    errcode = case p_kind
      when 'not_authenticated' then '42501'
      when 'forbidden' then '42501'
      when 'not_found' then 'P0002'
      when 'validation' then '22023'
      when 'conflict' then '23505'
      else 'P0001'
    end;
end;
$$;

-- Caller id or a 'not_authenticated' error.
create or replace function private.require_uid()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    perform private.raise_error('not_authenticated', 'Tienes que iniciar sesión');
  end if;
  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Social graph helpers (used by RLS policies → executable by authenticated)
-- ---------------------------------------------------------------------------
create or replace function private.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select $1 is not null and $2 is not null and $1 <> $2 and exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and least(f.requester_id, f.addressee_id) = least($1, $2)
      and greatest(f.requester_id, f.addressee_id) = greatest($1, $2)
  );
$$;

create or replace function private.friend_ids(u uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when f.requester_id = $1 then f.addressee_id else f.requester_id end
  from public.friendships f
  where f.status = 'accepted' and (f.requester_id = $1 or f.addressee_id = $1);
$$;

create or replace function private.is_session_participant(session uuid, u uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.joint_session_participants p where p.session_id = $1 and p.user_id = $2
  ) or exists (
    select 1 from public.joint_sessions s where s.id = $1 and s.organizer_id = $2
  );
$$;

-- Sessions the user organizes or was invited to (evaluated once per statement in policies).
create or replace function private.session_ids_for(u uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.session_id from public.joint_session_participants p where p.user_id = $1
  union
  select s.id from public.joint_sessions s where s.organizer_id = $1;
$$;

-- ---------------------------------------------------------------------------
-- Value helpers
-- ---------------------------------------------------------------------------
create or replace function private.is_valid_date_text(v text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}$' then
    return false;
  end if;
  perform v::date;
  return true;
exception when others then
  return false;
end;
$$;

-- Same rule as the app: strict 24 h 'HH:mm'.
create or replace function private.is_valid_time_text(v text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select v is not null and v ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';
$$;

create or replace function private.try_uuid(v text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if v is null or v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return v::uuid;
end;
$$;

-- JS-like trim (all leading/trailing whitespace).
create or replace function private.trim_text(v text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(v, '^[[:space:]]+|[[:space:]]+$', '', 'g');
$$;

-- Numeric value of a jsonb number, null for anything else (never raises).
create or replace function private.jsonb_number(v jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(v) = 'number' then (v)::numeric end;
$$;

-- Valid IANA zone name or Europe/Madrid.
create or replace function private.safe_tz(tz text)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  if tz is null or tz = '' then
    return 'Europe/Madrid';
  end if;
  perform now() at time zone tz;
  return tz;
exception when others then
  return 'Europe/Madrid';
end;
$$;

-- 'lun 27 oct'
create or replace function private.format_day_es(d date)
returns text
language sql
immutable
set search_path = ''
as $$
  select (array['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'])[extract(isodow from d)::int]
    || ' ' || extract(day from d)::int
    || ' ' || (array['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'])[extract(month from d)::int];
$$;

-- 'lun 27 oct a las 18:30' (time optional)
create or replace function private.format_when_es(d date, t time)
returns text
language sql
immutable
set search_path = ''
as $$
  select private.format_day_es(d) || coalesce(' a las ' || to_char(t, 'HH24:MI'), '');
$$;

create or replace function private.display_name_of(u uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.display_name from public.profiles p where p.id = u), 'Alguien');
$$;

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.keep_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    perform private.raise_error('forbidden', 'No se puede cambiar el propietario de un registro');
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'joint_sessions', 'workouts', 'races', 'life_events', 'daily_checkins',
    'daily_metrics', 'plan_proposals', 'coach_jobs', 'integration_credentials'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;

  foreach t in array array[
    'workouts', 'races', 'life_events', 'busy_blocks', 'daily_checkins', 'daily_metrics',
    'nutrition_logs', 'plan_proposals', 'notifications', 'coach_jobs', 'personal_tokens',
    'ai_usage', 'integration_credentials', 'joint_session_participants'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_keep_owner', t);
    execute format(
      'create trigger %I before update of user_id on public.%I for each row execute function private.keep_owner()',
      t || '_keep_owner', t
    );
  end loop;
end;
$$;

-- Profiles: validate the time zone name (used by masking and notifications).
create or replace function private.validate_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.safe_tz(new.timezone) <> new.timezone then
    perform private.raise_error('validation', 'Zona horaria no válida');
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_validate on public.profiles;
create trigger profiles_validate
  before insert or update of timezone on public.profiles
  for each row execute function private.validate_profile();

-- Workouts can only be linked to a quedada the owner takes part in (organizer or not declined).
create or replace function private.guard_workout_joint()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.joint_session_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.joint_session_id is not distinct from old.joint_session_id then
    return new;
  end if;
  if not exists (
    select 1 from public.joint_sessions s
    where s.id = new.joint_session_id and s.organizer_id = new.user_id
  ) and not exists (
    select 1 from public.joint_session_participants p
    where p.session_id = new.joint_session_id and p.user_id = new.user_id and p.status <> 'declined'
  ) then
    perform private.raise_error('forbidden', 'No participas en esta quedada');
  end if;
  return new;
end;
$$;

drop trigger if exists workouts_guard_joint on public.workouts;
create trigger workouts_guard_joint
  before insert or update of joint_session_id on public.workouts
  for each row execute function private.guard_workout_joint();

-- ---------------------------------------------------------------------------
-- Sign-up hook: every auth user gets a profile.
-- username = 'u' + 8 hex chars; display_name from metadata full_name/name or the email local part.
-- ---------------------------------------------------------------------------
create or replace function private.display_name_from(p_email text, p_meta jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(coalesce(
    nullif(private.trim_text(coalesce(p_meta ->> 'full_name', p_meta ->> 'name', '')), ''),
    nullif(initcap(private.trim_text(regexp_replace(split_part(coalesce(p_email, ''), '@', 1), '[._+-]+', ' ', 'g'))), ''),
    'Atleta'
  ), 60);
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
begin
  loop
    v_username := 'u' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    exit when not exists (select 1 from public.profiles p where p.username = v_username);
  end loop;

  insert into public.profiles (id, username, display_name)
  values (new.id, v_username, private.display_name_from(new.email, coalesce(new.raw_user_meta_data, '{}'::jsonb)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
