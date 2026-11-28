-- Friend lookups filter by either side (private.friend_ids, social RPCs): the addressee side
-- had its index, the requester side relied on the expression index of the pair.
create index if not exists friendships_requester_idx on public.friendships (requester_id);
