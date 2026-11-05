-- Road to Ironman — natural text-to-speech budget (edge function `speech`).
--
-- The `speech` function sends a coach answer / the morning briefing to our Cloudflare worker
-- (POST /v1/speech) and gets neural audio back. Workers AI is free up to 10.000 neurons a day, shared
-- with the LLM calls, and resets at 00:00 UTC, so speech is capped twice:
-- * per user: p_user_limit `speech` calls in the last 24 h (rolling, like svc_reserve_ai_call);
-- * globally: the premium voice (Deepgram Aura-2, the expensive one) is used while the characters
--   already sent to it since today 00:00 UTC, across ALL users, plus this request fit in
--   p_premium_budget; after that the request gets the cheap 'basic' voice (MeloTTS).
--
-- One ai_usage row per call (function_name 'speech', model = tier, input_tokens = characters) is
-- inserted BEFORE the worker call, so failed calls stay counted. The per-user lock serializes one
-- user's reservations; the constant global lock serializes the premium budget check of every user.
-- Locks are always taken in the same order (user, then global), so they cannot deadlock.
-- Returns 'premium' | 'basic', or null when the user reached p_user_limit.

-- Global premium sum ("speech rows since 00:00 UTC") without scanning every user's ai_usage.
create index if not exists ai_usage_speech_created_idx
  on public.ai_usage (created_at)
  where function_name = 'speech';

create or replace function public.svc_reserve_speech(p_user uuid, p_chars int, p_user_limit int, p_premium_budget int)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used int;
  v_day_start timestamptz;
  v_premium bigint;
  v_tier text;
begin
  if p_user is null then
    perform private.raise_error('validation', 'Usuario no válido');
  end if;
  if p_chars is null or p_chars < 1 or p_chars > 2000 then
    perform private.raise_error('validation', 'El texto debe tener entre 1 y 2000 caracteres');
  end if;
  if p_user_limit is null or p_user_limit < 0 then
    perform private.raise_error('validation', 'Límite no válido');
  end if;
  if p_premium_budget is null or p_premium_budget < 0 then
    perform private.raise_error('validation', 'Presupuesto no válido');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('speech:user:' || p_user::text, 0)
  );

  if not exists (select 1 from public.profiles p where p.id = p_user) then
    perform private.raise_error('not_found', 'Usuario no encontrado');
  end if;

  select count(*)::int into v_used
  from public.ai_usage u
  where u.user_id = p_user and u.function_name = 'speech' and u.created_at > now() - interval '24 hours';

  if v_used >= p_user_limit then
    return null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('speech:premium_budget', 0));

  -- Cloudflare resets the free neurons at 00:00 UTC, whatever the session time zone is.
  v_day_start := pg_catalog.date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';

  select coalesce(sum(u.input_tokens), 0) into v_premium
  from public.ai_usage u
  where u.function_name = 'speech' and u.model = 'premium' and u.created_at >= v_day_start;

  v_tier := case when v_premium + p_chars <= p_premium_budget then 'premium' else 'basic' end;

  insert into public.ai_usage (user_id, function_name, model, input_tokens)
  values (p_user, 'speech', v_tier, p_chars);
  return v_tier;
end;
$$;

revoke all on function public.svc_reserve_speech(uuid, int, int, int) from public, anon, authenticated;
grant execute on function public.svc_reserve_speech(uuid, int, int, int) to service_role;
