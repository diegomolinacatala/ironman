-- Rebufo — personal tokens (Claude connector / ICS feed), integration status, account deletion.
--
-- Token secrets: 'rb_' || 64 hex chars (two random UUIDs without dashes). Only
-- encode(sha256(convert_to(secret, 'UTF8')), 'hex') is stored; the plain secret is returned once.

create or replace function public.create_personal_token(p_scope text, p_label text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  v_label text := left(private.trim_text(coalesce(p_label, '')), 60);
  v_secret text;
  v_row public.personal_tokens%rowtype;
begin
  if coalesce(p_scope, '') not in ('mcp', 'ics') then
    perform private.raise_error('validation', 'Tipo de enlace no válido');
  end if;
  perform 1 from public.profiles p where p.id = v_me for update;  -- serialize per user
  if (
    select count(*) from public.personal_tokens t
    where t.user_id = v_me and t.scope = p_scope and t.revoked_at is null
  ) >= 5 then
    perform private.raise_error('conflict', 'Ya tienes 5 enlaces activos de este tipo. Revoca uno antes de crear otro.');
  end if;

  v_secret := 'rb_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.personal_tokens (user_id, scope, label, token_hash, prefix)
  values (v_me, p_scope, v_label, encode(sha256(convert_to(v_secret, 'UTF8')), 'hex'), left(v_secret, 10))
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'secret', v_secret,
    'prefix', v_row.prefix,
    'scope', v_row.scope,
    'label', v_row.label,
    'createdAt', v_row.created_at
  );
end;
$$;

create or replace function public.list_personal_tokens()
returns table (
  id uuid, scope text, label text, prefix text,
  created_at timestamptz, last_used_at timestamptz, revoked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.scope, t.label, t.prefix, t.created_at, t.last_used_at, t.revoked_at
  from public.personal_tokens t
  where t.user_id = private.require_uid()
  order by t.revoked_at is not null, t.created_at desc;
$$;

create or replace function public.revoke_personal_token(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
begin
  if not exists (select 1 from public.personal_tokens t where t.id = p_id and t.user_id = v_me) then
    perform private.raise_error('not_found', 'Enlace no encontrado');
  end if;
  update public.personal_tokens t set revoked_at = now()
  where t.id = p_id and t.user_id = v_me and t.revoked_at is null;
end;
$$;

-- Service role only: resolves a token hash to its user (null if unknown/revoked).
-- last_used_at is refreshed at most once per minute.
create or replace function public.svc_resolve_token(p_token_hash text, p_scope text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text := lower(coalesce(p_token_hash, ''));
  v_id uuid;
  v_user uuid;
begin
  if v_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select t.id, t.user_id into v_id, v_user
  from public.personal_tokens t
  where t.token_hash = v_hash and t.scope = p_scope and t.revoked_at is null;
  if v_id is null then
    return null;
  end if;
  update public.personal_tokens t set last_used_at = now()
  where t.id = v_id and (t.last_used_at is null or t.last_used_at < now() - interval '1 minute');
  return v_user;
end;
$$;

-- External integrations of the caller (never exposes the encrypted secret).
create or replace function public.integration_status()
returns table (provider text, state text, key_expires_at date, last_sync_at timestamptz, last_error text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.provider, c.state, c.key_expires_at, c.last_sync_at, c.last_error
  from public.integration_credentials c
  where c.user_id = private.require_uid()
  order by c.provider;
$$;

-- Permanently deletes the caller (auth user → profile → every owned row by cascade).
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
begin
  delete from auth.users u where u.id = v_me;
end;
$$;
