-- ============ TABLES ============
create extension if not exists pgcrypto;

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  share_slug text not null unique default encode(gen_random_bytes(8), 'hex'),
  status text not null default 'active' check (status in ('active','closed')),
  creator_participant_id uuid,
  created_at timestamptz not null default now()
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  claimed_by uuid references auth.users(id) on delete set null,
  all_expenses_in boolean not null default false,
  unique (trip_id, name)
);
create index participants_claimed_by_idx on public.participants (claimed_by);

alter table public.trips
  add constraint trips_creator_fk foreign key (creator_participant_id)
  references public.participants(id) on delete set null;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  payer_participant_id uuid not null references public.participants(id) on delete restrict,
  description text not null check (length(trim(description)) between 1 and 120),
  amount_cents integer not null check (amount_cents > 0),
  flagged boolean not null default false,
  flagged_by_participant_id uuid references public.participants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index expenses_trip_idx on public.expenses (trip_id, created_at desc);

create table public.expense_shares (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  primary key (expense_id, participant_id)
);

-- trip_id is denormalized here (not in the spec's table sketch) so realtime
-- subscriptions and RLS can filter comments by trip without a join.
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  expense_id uuid not null references public.expenses(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index comments_trip_idx on public.comments (trip_id);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  from_participant_id uuid not null references public.participants(id) on delete restrict,
  to_participant_id uuid not null references public.participants(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  check (from_participant_id <> to_participant_id)
);
create index settlements_trip_idx on public.settlements (trip_id);

-- ============ HELPERS ============
create or replace function public.is_member(p_trip uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from participants where trip_id = p_trip and claimed_by = auth.uid());
$$;

create or replace function public.trip_is_active(p_trip uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from trips where id = p_trip and status = 'active');
$$;

-- ============ RLS ============
alter table public.trips enable row level security;
alter table public.participants enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;
alter table public.comments enable row level security;
alter table public.settlements enable row level security;

create policy trips_member_select on public.trips for select using (is_member(id));
create policy trips_member_update on public.trips for update
  using (is_member(id)) with check (is_member(id));   -- close/reopen; friends-trust

create policy parts_member_select on public.participants for select using (is_member(trip_id));
create policy parts_self_update on public.participants for update
  using (claimed_by = auth.uid());                    -- all-in toggle + release own claim

create policy exp_member_select on public.expenses for select using (is_member(trip_id));
create policy exp_member_update on public.expenses for update
  using (is_member(trip_id) and trip_is_active(trip_id));   -- flag/resolve
create policy exp_member_delete on public.expenses for delete
  using (is_member(trip_id) and trip_is_active(trip_id));
-- no INSERT policy: inserting expenses goes through add_expense() only

create policy shares_member_select on public.expense_shares for select
  using (is_member((select trip_id from public.expenses e where e.id = expense_id)));
-- no direct writes: shares are managed by add_expense/update_expense only

create policy comments_member_select on public.comments for select using (is_member(trip_id));
create policy comments_own_insert on public.comments for insert with check (
  trip_is_active(trip_id)
  and exists (select 1 from participants p
              where p.id = participant_id and p.trip_id = comments.trip_id
                and p.claimed_by = auth.uid())
);

create policy settle_member_select on public.settlements for select using (is_member(trip_id));
create policy settle_member_insert on public.settlements for insert
  with check (is_member(trip_id) and trip_is_active(trip_id));

-- ============ RPCS ============
create or replace function public.create_trip(p_trip_name text, p_names text[], p_your_name text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_trip trips; v_you participants; v_name text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_names is null or array_length(p_names, 1) < 1 then raise exception 'need at least one participant'; end if;
  if not (trim(p_your_name) = any (select trim(n) from unnest(p_names) n)) then
    raise exception 'your name must be one of the participants';
  end if;
  insert into trips (name) values (trim(p_trip_name)) returning * into v_trip;
  foreach v_name in array p_names loop
    insert into participants (trip_id, name) values (v_trip.id, trim(v_name));
  end loop;
  update participants set claimed_by = auth.uid()
    where trip_id = v_trip.id and name = trim(p_your_name) returning * into v_you;
  update trips set creator_participant_id = v_you.id where id = v_trip.id;
  return json_build_object('trip_id', v_trip.id, 'share_slug', v_trip.share_slug);
end $$;

create or replace function public.get_trip_by_slug(p_slug text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'trip', json_build_object('id', t.id, 'name', t.name, 'status', t.status,
                              'share_slug', t.share_slug,
                              'creator_participant_id', t.creator_participant_id),
    'participants', (select coalesce(json_agg(json_build_object(
        'id', p.id, 'name', p.name,
        'claimed', p.claimed_by is not null,
        'is_you', p.claimed_by is not distinct from auth.uid(),
        'all_expenses_in', p.all_expenses_in) order by p.name), '[]'::json)
      from participants p where p.trip_id = t.id))
  from trips t where t.share_slug = p_slug;
$$;

create or replace function public.claim_participant(p_slug text, p_participant_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_trip_id uuid; v_count int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into v_trip_id from trips where share_slug = p_slug;
  if v_trip_id is null then raise exception 'trip not found'; end if;
  update participants set claimed_by = auth.uid()
    where id = p_participant_id and trip_id = v_trip_id and claimed_by is null;
  get diagnostics v_count = row_count;
  return v_count = 1;   -- false = someone else won the race ("name taken")
end $$;

create or replace function public.release_claim(p_participant_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_p participants; v_creator uuid;
begin
  select * into v_p from participants where id = p_participant_id;
  if not found then raise exception 'participant not found'; end if;
  select creator_participant_id into v_creator from trips where id = v_p.trip_id;
  if v_p.claimed_by = auth.uid()
     or exists (select 1 from participants c where c.id = v_creator and c.claimed_by = auth.uid())
  then
    update participants set claimed_by = null where id = p_participant_id;
  else
    raise exception 'only the participant or the trip creator can release a claim';
  end if;
end $$;

create or replace function public.add_expense(
  p_trip_id uuid, p_payer_participant_id uuid, p_description text,
  p_amount_cents integer, p_shares jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid; v_expense_id uuid; v_sum integer := 0; v_key text; v_val integer;
begin
  select id into v_me from participants where trip_id = p_trip_id and claimed_by = auth.uid();
  if v_me is null then raise exception 'not a member of this trip'; end if;
  if not trip_is_active(p_trip_id) then raise exception 'trip is closed'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'amount must be positive'; end if;
  if length(trim(coalesce(p_description, ''))) = 0 then raise exception 'description required'; end if;
  if not exists (select 1 from participants where id = p_payer_participant_id and trip_id = p_trip_id) then
    raise exception 'payer not in trip';
  end if;
  if p_shares is null or p_shares = '{}'::jsonb then raise exception 'split needs at least one participant'; end if;
  for v_key, v_val in select key, value::integer from jsonb_each_text(p_shares) loop
    if v_val <= 0 then raise exception 'shares must be positive'; end if;
    if not exists (select 1 from participants where id = v_key::uuid and trip_id = p_trip_id) then
      raise exception 'share participant not in trip';
    end if;
    v_sum := v_sum + v_val;
  end loop;
  if v_sum <> p_amount_cents then raise exception 'shares must sum exactly to the amount'; end if;
  insert into expenses (trip_id, payer_participant_id, description, amount_cents)
    values (p_trip_id, p_payer_participant_id, trim(p_description), p_amount_cents)
    returning id into v_expense_id;
  insert into expense_shares (expense_id, participant_id, amount_cents)
    select v_expense_id, key::uuid, value::integer from jsonb_each_text(p_shares);
  -- Spec: auto-reset keys on who LOGGED the expense (the caller), never the payer.
  update participants set all_expenses_in = false where id = v_me;
  return v_expense_id;
end $$;

create or replace function public.update_expense(
  p_expense_id uuid, p_payer_participant_id uuid, p_description text,
  p_amount_cents integer, p_shares jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_trip_id uuid; v_sum integer := 0; v_key text; v_val integer;
begin
  select trip_id into v_trip_id from expenses where id = p_expense_id;
  if v_trip_id is null then raise exception 'expense not found'; end if;
  if not is_member(v_trip_id) then raise exception 'not a member of this trip'; end if;
  if not trip_is_active(v_trip_id) then raise exception 'trip is closed'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'amount must be positive'; end if;
  if length(trim(coalesce(p_description, ''))) = 0 then raise exception 'description required'; end if;
  if not exists (select 1 from participants where id = p_payer_participant_id and trip_id = v_trip_id) then
    raise exception 'payer not in trip';
  end if;
  for v_key, v_val in select key, value::integer from jsonb_each_text(p_shares) loop
    if v_val <= 0 then raise exception 'shares must be positive'; end if;
    if not exists (select 1 from participants where id = v_key::uuid and trip_id = v_trip_id) then
      raise exception 'share participant not in trip';
    end if;
    v_sum := v_sum + v_val;
  end loop;
  if v_sum <> p_amount_cents then raise exception 'shares must sum exactly to the amount'; end if;
  update expenses set payer_participant_id = p_payer_participant_id,
    description = trim(p_description), amount_cents = p_amount_cents, updated_at = now()
    where id = p_expense_id;
  delete from expense_shares where expense_id = p_expense_id;
  insert into expense_shares (expense_id, participant_id, amount_cents)
    select p_expense_id, key::uuid, value::integer from jsonb_each_text(p_shares);
  -- Spec: edits are corrections — they reset NO ONE's all-in flag.
end $$;

create or replace function public.keepalive()
returns text language sql security definer set search_path = public as $$
  select 'ok:' || count(*)::text from trips;
$$;

-- ============ GRANTS ============
revoke execute on all functions in schema public from anon, authenticated;
grant execute on function public.get_trip_by_slug(text) to anon, authenticated;
grant execute on function public.keepalive() to anon, authenticated;
grant execute on function public.create_trip(text, text[], text) to authenticated;
grant execute on function public.claim_participant(text, uuid) to authenticated;
grant execute on function public.release_claim(uuid) to authenticated;
grant execute on function public.add_expense(uuid, uuid, text, integer, jsonb) to authenticated;
grant execute on function public.update_expense(uuid, uuid, text, integer, jsonb) to authenticated;
-- helpers run inside RLS policy expressions, which execute as the querying
-- role — anon needs execute too or its (empty) table queries error out
grant execute on function public.is_member(uuid) to anon, authenticated;
grant execute on function public.trip_is_active(uuid) to anon, authenticated;

-- ============ REALTIME ============
alter publication supabase_realtime add table
  public.trips, public.participants, public.expenses, public.comments, public.settlements;
