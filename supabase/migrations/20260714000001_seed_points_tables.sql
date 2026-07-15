-- Points tables. CLAUDE.md: "Points come from the points table, never a hardcoded 7/5/4/3/2/1
-- literal in logic." Fixed well-known ids so app code / seed scripts can reference them directly.

-- Individual events: 1st=7, 2nd=5, 3rd=4, 4th=3, 5th=2, 6th=1 (skips 6).
insert into points_tables (id, name) values
  ('00000000-0000-0000-0000-000000000001', 'individual-default');

insert into points_rows (points_table_id, place, points) values
  ('00000000-0000-0000-0000-000000000001', 1, 7),
  ('00000000-0000-0000-0000-000000000001', 2, 5),
  ('00000000-0000-0000-0000-000000000001', 3, 4),
  ('00000000-0000-0000-0000-000000000001', 4, 3),
  ('00000000-0000-0000-0000-000000000001', 5, 2),
  ('00000000-0000-0000-0000-000000000001', 6, 1);

-- Relay events: exactly double the individual scale — 1st=14, 2nd=10, 3rd=8, 4th=6, 5th=4, 6th=2.
insert into points_tables (id, name) values
  ('00000000-0000-0000-0000-000000000002', 'relay-default');

insert into points_rows (points_table_id, place, points) values
  ('00000000-0000-0000-0000-000000000002', 1, 14),
  ('00000000-0000-0000-0000-000000000002', 2, 10),
  ('00000000-0000-0000-0000-000000000002', 3, 8),
  ('00000000-0000-0000-0000-000000000002', 4, 6),
  ('00000000-0000-0000-0000-000000000002', 5, 4),
  ('00000000-0000-0000-0000-000000000002', 6, 2);
