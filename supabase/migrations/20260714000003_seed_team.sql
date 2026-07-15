-- Single fixed "my team" row (see CLAUDE.md interview: "Team assignment" decision). Every coach
-- signup auto-assigns to this team_id — no team picker in the UI. Opposing teams only ever get
-- created from meet data (PDF import / manual seed), never via signup.

insert into teams (id, name, is_my_team) values
  ('00000000-0000-0000-0000-0000000000a1', 'Aces', true);
