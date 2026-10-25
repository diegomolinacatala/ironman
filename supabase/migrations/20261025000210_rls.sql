-- Rebufo — table privileges + row level security.
--
-- Privileges are reset first so the result does not depend on whether the project auto-exposes
-- new tables to the Data API roles (legacy) or not (current Supabase default): anon gets nothing,
-- authenticated gets exactly what the policies below allow, service_role gets everything.

revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- RLS on EVERY public table (tables without policies are service-role only).
do $$
declare
  r record;
begin
  for r in select tablename from pg_catalog.pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Own-rows CRUD tables
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'workouts', 'races', 'life_events', 'busy_blocks', 'daily_checkins',
    'daily_metrics', 'nutrition_logs', 'plan_proposals'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
      t || '_select_own', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',
      t || '_insert_own', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated '
      'using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_update_own', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))',
      t || '_delete_own', t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles: read/update own row only (others are reached through RPCs).
-- Created by the sign-up trigger, deleted with the auth user.
-- ---------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (
  username, display_name, avatar_url, sports, level, thresholds, availability, visibility,
  notification_prefs, timezone, coach_notes, onboarded_at
) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Friendships: parties can read and delete (unfriend / cancel); writes via RPCs.
-- ---------------------------------------------------------------------------
grant select, delete on public.friendships to authenticated;

create policy friendships_select_party on public.friendships
  for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));
create policy friendships_delete_party on public.friendships
  for delete to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

-- ---------------------------------------------------------------------------
-- Joint sessions ("quedadas"): participants/organizer read; writes via RPCs.
-- ---------------------------------------------------------------------------
grant select on public.joint_sessions to authenticated;
grant select on public.joint_session_participants to authenticated;

create policy joint_sessions_select_participant on public.joint_sessions
  for select to authenticated
  using (id in (select private.session_ids_for((select auth.uid()))));
create policy joint_participants_select_participant on public.joint_session_participants
  for select to authenticated
  using (session_id in (select private.session_ids_for((select auth.uid()))));

-- ---------------------------------------------------------------------------
-- Feed + kudos
-- ---------------------------------------------------------------------------
grant select on public.activity_events to authenticated;
grant select, insert, delete on public.kudos to authenticated;

create policy activity_events_select_visible on public.activity_events
  for select to authenticated
  using (
    actor_id = (select auth.uid())
    or actor_id in (select private.friend_ids((select auth.uid())))
  );

-- The sub-select runs with activity_events' own RLS → "event visible to me".
create policy kudos_select_visible on public.kudos
  for select to authenticated
  using (event_id in (select e.id from public.activity_events e));
create policy kudos_insert_own on public.kudos
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and event_id in (select e.id from public.activity_events e)
  );
create policy kudos_delete_own on public.kudos
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Notifications (inbox) + push tokens
-- ---------------------------------------------------------------------------
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete_own on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, delete on public.push_tokens to authenticated;

create policy push_tokens_select_own on public.push_tokens
  for select to authenticated using (user_id = (select auth.uid()));
create policy push_tokens_delete_own on public.push_tokens
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- AI coach jobs + usage ledger: read own; written by the service role only.
-- ---------------------------------------------------------------------------
grant select on public.coach_jobs to authenticated;
grant select on public.ai_usage to authenticated;

create policy coach_jobs_select_own on public.coach_jobs
  for select to authenticated using (user_id = (select auth.uid()));
create policy ai_usage_select_own on public.ai_usage
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Personal tokens: read own WITHOUT token_hash (column grants), revoke own; create via RPC.
-- ---------------------------------------------------------------------------
grant select (id, user_id, scope, label, prefix, created_at, last_used_at, revoked_at)
  on public.personal_tokens to authenticated;
grant update (revoked_at) on public.personal_tokens to authenticated;

create policy personal_tokens_select_own on public.personal_tokens
  for select to authenticated using (user_id = (select auth.uid()));
-- Revoking only: a revoked token can never be re-activated by the client.
create policy personal_tokens_revoke_own on public.personal_tokens
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and revoked_at is not null);

-- ---------------------------------------------------------------------------
-- integration_credentials: RLS on, NO policies, NO grants → service role only.
-- ---------------------------------------------------------------------------
