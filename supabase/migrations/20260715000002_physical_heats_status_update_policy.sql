-- Let any signed-in coach flip a physical_heat's status as part of the normal timing workflow
-- (Start All -> in_progress, all lanes finished -> completed) — this is not a "structural edit"
-- under CLAUDE.md invariant #4 (that's combine heats / re-seat lanes / scratches), so it shouldn't
-- require can_score(). The existing physical_heats_update policy (can_score()-gated) stays in
-- place for every other column on this table.
--
-- RLS permissive policies are OR'd together and apply to the whole row, not individual columns, so
-- a second broad UPDATE policy here would let any coach change label/meet_id/start_at too — not
-- just status. A trigger enforces the column-level restriction that RLS alone can't express: a
-- coach without can_score() may only change status/updated_at.
create policy physical_heats_status_update on physical_heats for update
  using (is_coach())
  with check (is_coach());

create or replace function enforce_physical_heats_status_only_update()
returns trigger
language plpgsql
as $$
begin
  if can_score() then
    return new;
  end if;
  if new.meet_id is distinct from old.meet_id
     or new.label is distinct from old.label
     or new.start_at is distinct from old.start_at
     or new.created_by is distinct from old.created_by
  then
    raise exception 'Only a Scorer/head-coach may change this field on physical_heats';
  end if;
  return new;
end;
$$;

create trigger physical_heats_status_only_update
  before update on physical_heats
  for each row
  execute function enforce_physical_heats_status_only_update();
