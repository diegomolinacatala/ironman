-- Rebufo — AI coach: explicit consent + atomic daily rate limit.

-- ---------------------------------------------------------------------------
-- AI consent. Null = the user has not agreed (or withdrew) to send their data to the AI provider
-- (Anthropic); the coach edge function answers 403 consent_required and the app falls back to the
-- local rules engine. Set and cleared by the client (column grant below).
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists ai_consent_at timestamptz;

comment on column public.profiles.ai_consent_at is
  'When the user agreed to send coaching data to the AI provider; null = no consent (withdrawn).';

grant update (ai_consent_at) on public.profiles to authenticated;

-- The consent timestamp is the server time at which consent was given: a client value is replaced
-- by now() when consent is granted, and later writes of another non-null value keep the original
-- moment (no back/forward dating). Writing null withdraws it.
create or replace function private.stamp_ai_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ai_consent_at is null then
    return new;
  end if;
  if old.ai_consent_at is null then
    new.ai_consent_at := now();
  else
    new.ai_consent_at := old.ai_consent_at;
  end if;
  return new;
end;
$$;

revoke all on function private.stamp_ai_consent() from public, anon, authenticated;
grant execute on function private.stamp_ai_consent() to service_role;

drop trigger if exists profiles_ai_consent on public.profiles;
create trigger profiles_ai_consent
  before update of ai_consent_at on public.profiles
  for each row execute function private.stamp_ai_consent();

-- ---------------------------------------------------------------------------
-- Coach rate limit: reserve a job slot atomically (service role / coach edge function only).
-- Concurrent reservations of the same user are serialized with a transaction-scoped advisory
-- lock, so "count the last 24 h, then insert" cannot be raced. Returns the new running job id,
-- or null when the user already has p_limit jobs in the last 24 h.
-- ---------------------------------------------------------------------------
create or replace function public.svc_reserve_coach_job(p_user uuid, p_request jsonb, p_limit int default 30)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used int;
  v_id uuid;
begin
  if p_user is null then
    perform private.raise_error('validation', 'Usuario no válido');
  end if;
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    perform private.raise_error('validation', 'Petición del coach no válida');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coach_job:' || p_user::text, 0));

  if not exists (select 1 from public.profiles p where p.id = p_user) then
    perform private.raise_error('not_found', 'Usuario no encontrado');
  end if;

  select count(*)::int into v_used
  from public.coach_jobs j
  where j.user_id = p_user and j.created_at > now() - interval '24 hours';

  if v_used >= greatest(coalesce(p_limit, 30), 0) then
    return null;
  end if;

  insert into public.coach_jobs (user_id, request, status)
  values (p_user, p_request, 'running')
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.svc_reserve_coach_job(uuid, jsonb, int) from public, anon, authenticated;
grant execute on function public.svc_reserve_coach_job(uuid, jsonb, int) to service_role;
