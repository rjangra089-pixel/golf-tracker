# Portugal scorecards and nine-hole rounds

Verified against the publisher PDFs on 19 November 2026:
- Gramacho: https://pestanagolf.com/wp-content/uploads/2023/05/GRAMACHO-18.pdf
- Vila Sol: https://pestanagolf.com/wp-content/uploads/2026/02/Vila-sol_compressed.pdf

The publisher cards use metres. `lib/portugal-scorecards.mjs` retains original
metres and stores nearest whole yards (metres / 0.9144) for existing app fields.
Gramacho white is the 5,532m column, not the 6,107m championship column.
Yellow is 5,212m. Both men’s ratings come from that scorecard.

## Vila Sol course selection

All three selectable layouts are par 72. Each nine uses the existing White
and Yellow tee distances, with app holes numbered in playing order.

| Layout | App holes 1–9 | App holes 10–18 |
| --- | --- | --- |
| Vila Sol — Prestige / Prime | Prestige (club 19–27) | Prime (club 1–9) |
| Vila Sol — Prime / Challenge | Prime (club 1–9) | Challenge (club 10–18) |
| Vila Sol — Prestige / Challenge | Prestige (club 19–27) | Challenge (club 10–18) |

Prestige uses the published even SI column with Prime and the odd SI column
with Challenge. The combined cards use SI 1–18. The app retains physical
hole numbers and the applied printed SI in `holes.tee_options._layout`.
The existing loop records have no ratings to carry forward, so round setup
uses a manually entered Playing Handicap.

## Historical nine-hole rounds

The old Prime, Challenge and Prestige cards are hidden in the new-round
selector. Their database course and hole IDs, SI 1–9 and metadata remain
available for resuming and reviewing existing rounds.

No individual nine-hole Course/Slope Ratings are published on this card.
Leave them null. The player must enter a club-confirmed **nine-hole Playing HC**;
do not halve/guess ratings or reuse an 18-hole allowance. Stableford allocates
the entered allowance over nine SI ranks, including plus handicaps.
Nine-hole coaching uses 3 easier / 3 medium / 3 harder holes. Notes retain
siScale=9 so history never reads those ranks as 18-hole ranks.
The full 18-hole personal challenge is not rescaled or applied to nine holes.

Nine scores finish a nine-hole round; skipped holes stay unrecorded. Gross,
putts, penalties, error tags, observations, local storage, autosave, final save,
resume, saved-score editing and Coach Review retain their existing semantics.
Nine-hole records appear in Rounds; 18-hole Progress, course comparisons,
Home coaching and target-handicap planning continue excluding them.
No inferred Score Differential or official handicap submission is produced.

## Course setup
The signed-in course-admin account automatically calls POST /api/portugal-courses
on boot if any catalog slug is missing. Tee Off also offers an explicit retry.
The endpoint verifies the user against Supabase Auth and checks profiles.is_admin.
It uses the caller’s JWT and existing database permissions, never a service key.
Only INSERT-ignore-duplicate and SELECT operations on courses / holes are used.
Deterministic UUIDs make interrupted/concurrent imports retryable. Conflicting
existing cards are reported and left unchanged. It never accesses rounds/shots.
There are no schema changes or migrations. Existing round/hole identities are
not rewritten. The untracked RLS migration is not part of this release.

Run tests/run-unit.sh and tests/run-browser.sh. The Portugal tests exercise
published totals, physical hole mapping, unit conversion, 18-hole and historical
nine-hole stroke allocation, permission checks, retries, corruption guards, resume/save/edit and
375px light/dark layouts. All browser database traffic is mocked.
