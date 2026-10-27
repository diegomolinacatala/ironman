-- Road to Ironman v2 — atomic 24 h limits for the synchronous AI functions (briefing, meal).
--
-- Same model as svc_reserve_coach_job: reservations of one user + function are serialized with a
-- transaction-scoped advisory lock, so "count the last 24 h, then insert" cannot be raced by
-- parallel requests. The provisional ai_usage row is inserted BEFORE the model call (failed calls
-- stay counted); the edge function fills model/tokens afterwards (best effort).
-- Returns the new ai_usage id, or null when the user already has p_limit calls in the last 24 h.
create or replace function public.svc_reserve_ai_call(p_user uuid, p_function text, p_limit int)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used int;
  v_id bigint;
begin
  if p_user is null then
    perform private.raise_error('validation', 'Usuario no válido');
  end if;
  if p_function is null or p_function !~ '^[a-z][a-z_]{0,39}$' then
    perform private.raise_error('validation', 'Función de IA no válida');
  end if;
  if p_limit is null or p_limit < 0 then
    perform private.raise_error('validation', 'Límite no válido');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ai_call:' || p_user::text || ':' || p_function, 0)
  );

  if not exists (select 1 from public.profiles p where p.id = p_user) then
    perform private.raise_error('not_found', 'Usuario no encontrado');
  end if;

  select count(*)::int into v_used
  from public.ai_usage u
  where u.user_id = p_user and u.function_name = p_function and u.created_at > now() - interval '24 hours';

  if v_used >= p_limit then
    return null;
  end if;

  insert into public.ai_usage (user_id, function_name)
  values (p_user, p_function)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.svc_reserve_ai_call(uuid, text, int) from public, anon, authenticated;
grant execute on function public.svc_reserve_ai_call(uuid, text, int) to service_role;
