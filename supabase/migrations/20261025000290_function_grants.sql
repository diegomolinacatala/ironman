-- Rebufo — function privileges (runs after every function is defined).
--
-- Postgres grants EXECUTE to PUBLIC by default (and legacy Supabase projects also grant it to
-- anon/authenticated): start from nothing for our own functions, then open the public API.

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and not exists (
        select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end;
$$;

-- Helpers evaluated inside RLS policies run as the caller.
grant execute on function
  private.are_friends(uuid, uuid),
  private.friend_ids(uuid),
  private.session_ids_for(uuid),
  private.is_session_participant(uuid, uuid)
to authenticated;

-- RPCs callable by signed-in users (each one resolves the caller with auth.uid()).
grant execute on function
  public.apply_plan_changes(jsonb, uuid),
  public.is_username_available(text),
  public.send_friend_request(text),
  public.respond_friend_request(uuid, boolean),
  public.list_friends(),
  public.search_profiles(text),
  public.get_friend_week(uuid, date, date),
  public.propose_joint_session(jsonb, uuid[], uuid),
  public.respond_joint_session(uuid, boolean),
  public.cancel_joint_session(uuid),
  public.list_joint_sessions(date, date),
  public.get_joint_session(uuid),
  public.list_feed(int),
  public.toggle_kudos(uuid),
  public.register_push_token(text, text),
  public.mark_notifications_read(uuid[]),
  public.create_personal_token(text, text),
  public.list_personal_tokens(),
  public.revoke_personal_token(uuid),
  public.integration_status(),
  public.delete_my_account()
to authenticated;

-- Service-role-only variants (edge functions): svc_resolve_token, svc_apply_plan_changes,
-- svc_get_friend_week, svc_list_friends — executable by service_role only (granted above).
