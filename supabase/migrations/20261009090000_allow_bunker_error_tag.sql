-- Allow the B (bunker) stroke-costing error tag on shots.error_tags.
--   T = Tee · A = Approach · S = Short game · B = Bunker · P = Putting
-- Canonical stored order is now T-A-S-B-P (e.g. 'B', 'SB', 'TBP', 'TASBP').
-- Narrow change: replaces ONLY the shots_error_tags_valid check constraint.
-- Every existing value ('T', 'TA', 'TASP', …, or NULL) already satisfies the new
-- pattern, so no data is rewritten and the constraint validates instantly.
-- Still enforced: NULL allowed, '' rejected, only these five uppercase letters,
-- each at most once, in canonical order.
--
-- Apply BEFORE deploying app code that can save a B tag; otherwise those saves
-- are rejected by the old constraint.

begin;

alter table public.shots
  drop constraint if exists shots_error_tags_valid;

alter table public.shots
  add constraint shots_error_tags_valid
  check (error_tags is null or (error_tags ~ '^T?A?S?B?P?$' and error_tags <> ''));

comment on column public.shots.error_tags is
  'Player-selected stroke-costing errors for this hole: subset of T,A,S,B,P in that order (e.g. ''TBP''); NULL = none.';

commit;

-- Verification (read-only):
--   select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'shots_error_tags_valid';
--   select count(*) filter (where error_tags is not null) as tagged,
--          count(*) filter (where error_tags !~ '^T?A?S?B?P?$') as invalid   -- expect 0
--   from public.shots;
--
-- Rollback (only if no B tags have been saved yet):
--   alter table public.shots drop constraint if exists shots_error_tags_valid;
--   alter table public.shots add constraint shots_error_tags_valid
--     check (error_tags is null or (error_tags ~ '^T?A?S?P?$' and error_tags <> ''));
