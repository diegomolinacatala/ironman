-- Rebufo — push token cleanup on sign-out + friend request deep link.

-- ---------------------------------------------------------------------------
-- Removes this device's Expo push token when it belongs to the caller (sign-out / account
-- deletion), so the signed-out account's pushes stop reaching the device. A token registered
-- by someone else is left untouched.
-- ---------------------------------------------------------------------------
create or replace function public.unregister_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  v_token text := private.trim_text(coalesce(p_token, ''));
begin
  if v_token = '' or char_length(v_token) > 300 then
    perform private.raise_error('validation', 'Token de notificaciones no válido');
  end if;
  delete from public.push_tokens t where t.token = v_token and t.user_id = v_me;
end;
$$;

revoke all on function public.unregister_push_token(text) from public, anon, authenticated;
grant execute on function public.unregister_push_token(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Friend requests open the Juntos tab (it shows the request card with Aceptar/Rechazar);
-- '/notifications' pushed another inbox on every tap.
-- ---------------------------------------------------------------------------
create or replace function private.on_friendship_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_username text;
begin
  if new.status = 'pending'
    and (tg_op = 'INSERT' or old.status <> 'pending' or old.requester_id <> new.requester_id) then
    select p.display_name, p.username into v_name, v_username
    from public.profiles p where p.id = new.requester_id;
    perform private.notify(
      new.addressee_id, 'friend_request', 'Nueva solicitud de amistad',
      format('%s (@%s) quiere entrenar contigo.', v_name, v_username),
      jsonb_build_object('url', '/together', 'friendshipId', new.id, 'fromUserId', new.requester_id)
    );
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status <> 'accepted' then
    perform private.notify(
      new.requester_id, 'friend_accepted',
      format('%s ha aceptado tu solicitud', private.display_name_of(new.addressee_id)),
      'Ya podéis ver vuestros calendarios y quedar para entrenar.',
      jsonb_build_object('url', '/friends/' || new.addressee_id, 'friendshipId', new.id, 'friendId', new.addressee_id)
    );
  end if;
  return null;
end;
$$;

-- Requests already in the inbox get the new link too.
update public.notifications n
set data = jsonb_set(n.data, '{url}', '"/together"'::jsonb)
where n.type = 'friend_request' and n.data ->> 'url' = '/notifications';
