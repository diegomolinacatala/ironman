-- Road to Ironman — natural text-to-speech budget, v2: caps in characters (edge function `speech`).
--
-- 20261105000100_speech_budget.sql capped each user by CALLS (300 × 600 chars = 180k chars a day),
-- gave the premium budget to whoever came first and did not cap the basic voice at all, so one user
-- could spend the free Workers AI neurons (10.000 a day, reset 00:00 UTC, shared with the coach LLM)
-- of everybody. Aura-2 costs 2,727 neurons per 1k chars; MeloTTS ~18.6 neurons per audio minute
-- (~1k chars). This version replaces svc_reserve_speech(uuid, int, int, int) with:
-- * per user, rolling 24 h: characters already reserved + p_chars ≤ p_user_daily_chars, else null;
-- * since today 00:00 UTC, under the global lock:
--   - 'premium' when ALL users' premium characters + p_chars ≤ p_premium_budget AND this user's
--     premium characters + p_chars ≤ p_user_premium_chars (a per-user share of the premium budget);
--   - otherwise 'basic' when ALL users' basic characters + p_chars ≤ p_basic_budget;
--   - otherwise null.
--
-- One ai_usage row (function_name 'speech', model = tier, input_tokens = characters) is inserted
-- only when a tier is returned, BEFORE the worker call, so failed calls stay counted. The per-user
-- lock serializes one user's reservations; the constant global lock serializes the daily budgets of
-- every user. Locks are always taken in the same order (user, then global): no deadlocks.
-- The edge function is redeployed together with this migration (it calls the 6-argument version).

drop function if exists public.svc_reserve_speech(uuid, int, int, int);

create or replace function public.svc_reserve_speech(
  p_user uuid,
  p_chars int,
  p_user_daily_chars int,
  p_user_premium_chars int,
  p_premium_budget int,
  p_basic_budget int
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_chars bigint;
  v_day_start timestamptz;
  v_premium bigint;
  v_basic bigint;
  v_user_premium bigint;
  v_tier text;
begin
  if p_user is null then
    perform private.raise_error('validation', 'Usuario no válido');
  end if;
  if p_chars is null or p_chars < 1 or p_chars > 2000 then
    perform private.raise_error('validation', 'El texto debe tener entre 1 y 2000 caracteres');
  end if;
  if p_user_daily_chars is null or p_user_daily_chars < 0
     or p_user_premium_chars is null or p_user_premium_chars < 0 then
    perform private.raise_error('validation', 'Límite no válido');
  end if;
  if p_premium_budget is null or p_premium_budget < 0 or p_basic_budget is null or p_basic_budget < 0 then
    perform private.raise_error('validation', 'Presupuesto no válido');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('speech:user:' || p_user::text, 0)
  );

  if not exists (select 1 from public.profiles p where p.id = p_user) then
    perform private.raise_error('not_found', 'Usuario no encontrado');
  end if;

  select coalesce(sum(u.input_tokens), 0) into v_user_chars
  from public.ai_usage u
  where u.user_id = p_user and u.function_name = 'speech' and u.created_at > now() - interval '24 hours';

  if v_user_chars + p_chars > p_user_daily_chars then
    return null;
  end if;

  -- Same key as the first version: one global lock for every daily budget.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('speech:premium_budget', 0));

  -- Cloudflare resets the free neurons at 00:00 UTC, whatever the session time zone is.
  v_day_start := pg_catalog.date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';

  select
    coalesce(sum(u.input_tokens) filter (where u.model = 'premium'), 0),
    coalesce(sum(u.input_tokens) filter (where u.model = 'basic'), 0),
    coalesce(sum(u.input_tokens) filter (where u.model = 'premium' and u.user_id = p_user), 0)
  into v_premium, v_basic, v_user_premium
  from public.ai_usage u
  where u.function_name = 'speech' and u.created_at >= v_day_start;

  v_tier := case
    when v_premium + p_chars <= p_premium_budget and v_user_premium + p_chars <= p_user_premium_chars then 'premium'
    when v_basic + p_chars <= p_basic_budget then 'basic'
  end;

  if v_tier is null then
    return null;
  end if;

  insert into public.ai_usage (user_id, function_name, model, input_tokens)
  values (p_user, 'speech', v_tier, p_chars);
  return v_tier;
end;
$$;

revoke all on function public.svc_reserve_speech(uuid, int, int, int, int, int) from public, anon, authenticated;
grant execute on function public.svc_reserve_speech(uuid, int, int, int, int, int) to service_role;
