-- incremental — paste into SQL editor; full schema already applied
create or replace function public.add_participant(p_trip_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_member(p_trip_id) then raise exception 'not a member of this trip'; end if;
  if not trip_is_active(p_trip_id) then raise exception 'trip is closed'; end if;
  insert into participants (trip_id, name) values (p_trip_id, trim(p_name))
    returning id into v_id;   -- unclaimed; unique(trip_id,name) raises on duplicate
  return v_id;
end $$;
grant execute on function public.add_participant(uuid, text) to authenticated;
