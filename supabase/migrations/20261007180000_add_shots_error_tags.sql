-- Per-hole T/A/S/P stroke-costing error tags, chosen explicitly by the player.
--   T = Tee · A = Approach · S = Short game · P = Putting
-- Stored as the selected letters in fixed order, e.g. 'P', 'TA', 'TASP'.
-- NULL = no error tagged (all existing rows stay NULL — no data is rewritten).
-- The check allows only T/A/S/P, at most once each, in T-A-S-P order, never ''.
-- Narrow change: one nullable column + one constraint on public.shots. No RLS,
-- grant or other table changes (existing table-level grants cover the column).

begin;

alter table public.shots
  add column if not exists error_tags text;

alter table public.shots
  drop constraint if exists shots_error_tags_valid;

alter table public.shots
  add constraint shots_error_tags_valid
  check (error_tags is null or (error_tags ~ '^T?A?S?P?$' and error_tags <> ''));

comment on column public.shots.error_tags is
  'Player-selected stroke-costing errors for this hole: subset of T,A,S,P in that order (e.g. ''TA''); NULL = none.';

commit;

-- Ask PostgREST to pick up the new column straight away.
notify pgrst, 'reload schema';

-- Verification (read-only):
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'shots' and column_name = 'error_tags';
--   select count(*) as rows, count(error_tags) as tagged from public.shots;   -- tagged = 0 right after applying
--
-- Rollback (only if needed; drops the tags captured since):
--   alter table public.shots drop constraint if exists shots_error_tags_valid;
--   alter table public.shots drop column if exists error_tags;
