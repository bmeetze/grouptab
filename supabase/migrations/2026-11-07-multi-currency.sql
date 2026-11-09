-- incremental — paste into the Supabase SQL editor; full schema already applied.
-- Feature 01 (multi-currency). Safe to apply before the client deploy: the new
-- RPC parameters all have defaults, so the currently deployed (and any cached)
-- client keeps working unchanged. Paste and run the whole file at once.

-- 1. expenses carry their currency; existing rows become USD (what they were).
alter table public.expenses
  add column currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$');

-- 2. shared per-trip rates
-- One shared rate per foreign currency per trip (feature 01, decisions 4/6/7).
-- Integer billionths of a USD per ONE major unit (MXN 0.0586 -> 58600000): the
-- schema holds only integer amounts, and integers keep conversion exact. Written
-- only by add_expense (first use) and set_rate — no client write policies.
create table public.trip_rates (
  trip_id uuid not null references public.trips(id) on delete cascade,
  currency text not null check (currency ~ '^[A-Z]{3}$' and currency <> 'USD'),
  usd_nanos_per_unit bigint not null check (usd_nanos_per_unit > 0),
  set_by_participant_id uuid references public.participants(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (trip_id, currency)
);

alter table public.trip_rates enable row level security;
create policy rates_member_select on public.trip_rates for select using (is_member(trip_id));
revoke insert, update, delete on public.trip_rates from anon, authenticated;

-- 3. write RPCs gain currency parameters (signature change: drop, then recreate)
drop function public.add_expense(uuid, uuid, text, integer, jsonb);
drop function public.update_expense(uuid, uuid, text, integer, jsonb);

-- p_currency / p_usd_nanos default so a cached pre-multi-currency client
-- (five named args) keeps working: its expenses are USD, as they always were.
create or replace function public.add_expense(
  p_trip_id uuid, p_payer_participant_id uuid, p_description text,
  p_amount_cents integer, p_shares jsonb,
  p_currency text default 'USD', p_usd_nanos bigint default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid; v_expense_id uuid; v_sum integer := 0; v_key text; v_val integer;
  v_currency text := upper(trim(coalesce(p_currency, 'USD')));
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
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'invalid currency'; end if;
  -- First use of a currency saves its trip rate in the same call, so a currency
  -- with expenses never lacks a rate. An existing rate is never overwritten here
  -- (that's set_rate's job); on conflict covers two simultaneous first expenses.
  if v_currency <> 'USD'
     and not exists (select 1 from trip_rates where trip_id = p_trip_id and currency = v_currency) then
    if p_usd_nanos is null or p_usd_nanos <= 0 then
      raise exception 'a rate is required for the first % expense', v_currency;
    end if;
    insert into trip_rates (trip_id, currency, usd_nanos_per_unit, set_by_participant_id)
      values (p_trip_id, v_currency, p_usd_nanos, v_me)
      on conflict (trip_id, currency) do nothing;
  end if;
  insert into expenses (trip_id, payer_participant_id, description, currency, amount_cents)
    values (p_trip_id, p_payer_participant_id, trim(p_description), v_currency, p_amount_cents)
    returning id into v_expense_id;
  insert into expense_shares (expense_id, participant_id, amount_cents)
    select v_expense_id, key::uuid, value::integer from jsonb_each_text(p_shares);
  -- Spec: auto-reset keys on who LOGGED the expense (the caller), never the payer.
  update participants set all_expenses_in = false where id = v_me;
  return v_expense_id;
end $$;

-- p_currency null = keep the expense's current currency, so a cached old
-- client editing an MXN expense can't silently turn it into USD.
create or replace function public.update_expense(
  p_expense_id uuid, p_payer_participant_id uuid, p_description text,
  p_amount_cents integer, p_shares jsonb,
  p_currency text default null, p_usd_nanos bigint default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_trip_id uuid; v_sum integer := 0; v_key text; v_val integer;
  v_me uuid; v_old_currency text; v_currency text;
begin
  select trip_id, currency into v_trip_id, v_old_currency from expenses where id = p_expense_id;
  if v_trip_id is null then raise exception 'expense not found'; end if;
  if not is_member(v_trip_id) then raise exception 'not a member of this trip'; end if;
  select id into v_me from participants where trip_id = v_trip_id and claimed_by = auth.uid();
  v_currency := coalesce(upper(trim(p_currency)), v_old_currency);
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
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'invalid currency'; end if;
  if v_currency <> 'USD'
     and not exists (select 1 from trip_rates where trip_id = v_trip_id and currency = v_currency) then
    if p_usd_nanos is null or p_usd_nanos <= 0 then
      raise exception 'a rate is required for the first % expense', v_currency;
    end if;
    insert into trip_rates (trip_id, currency, usd_nanos_per_unit, set_by_participant_id)
      values (v_trip_id, v_currency, p_usd_nanos, v_me)
      on conflict (trip_id, currency) do nothing;
  end if;
  update expenses set payer_participant_id = p_payer_participant_id,
    description = trim(p_description), currency = v_currency, amount_cents = p_amount_cents,
    updated_at = now()
    where id = p_expense_id;
  delete from expense_shares where expense_id = p_expense_id;
  insert into expense_shares (expense_id, participant_id, amount_cents)
    select p_expense_id, key::uuid, value::integer from jsonb_each_text(p_shares);
  -- Spec: edits are corrections — they reset NO ONE's all-in flag.
end $$;

-- Decision 7: any member may change a rate while the trip is open; because it
-- moves everyone's numbers, an actual change clears EVERYONE's all-in (unlike
-- add_expense, which resets only the logger). Saving the same value is a no-op.
create or replace function public.set_rate(p_trip_id uuid, p_currency text, p_usd_nanos bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid; v_currency text := upper(trim(coalesce(p_currency, ''))); v_old bigint;
begin
  select id into v_me from participants where trip_id = p_trip_id and claimed_by = auth.uid();
  if v_me is null then raise exception 'not a member of this trip'; end if;
  if not trip_is_active(p_trip_id) then raise exception 'trip is closed'; end if;
  if v_currency !~ '^[A-Z]{3}$' or v_currency = 'USD' then raise exception 'invalid currency'; end if;
  if p_usd_nanos is null or p_usd_nanos <= 0 then raise exception 'rate must be positive'; end if;
  select usd_nanos_per_unit into v_old from trip_rates where trip_id = p_trip_id and currency = v_currency;
  if v_old = p_usd_nanos then return; end if;
  insert into trip_rates (trip_id, currency, usd_nanos_per_unit, set_by_participant_id, set_at)
    values (p_trip_id, v_currency, p_usd_nanos, v_me, now())
    on conflict (trip_id, currency) do update
      set usd_nanos_per_unit = excluded.usd_nanos_per_unit,
          set_by_participant_id = excluded.set_by_participant_id, set_at = excluded.set_at;
  update participants set all_expenses_in = false where trip_id = p_trip_id;
end $$;

revoke execute on function public.add_expense(uuid, uuid, text, integer, jsonb, text, bigint) from public;
revoke execute on function public.update_expense(uuid, uuid, text, integer, jsonb, text, bigint) from public;
revoke execute on function public.set_rate(uuid, text, bigint) from public;
grant execute on function public.add_expense(uuid, uuid, text, integer, jsonb, text, bigint) to authenticated;
grant execute on function public.update_expense(uuid, uuid, text, integer, jsonb, text, bigint) to authenticated;
grant execute on function public.set_rate(uuid, text, bigint) to authenticated;

-- 4. realtime: rate changes refetch every connected client
alter publication supabase_realtime add table public.trip_rates;
