// Offline tests for js/coach-review.js — model, truthfulness rules and the exact
// Copy Round Data text. Loads the real file; no DOM, network or database.
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..', '..');
const code = fs.readFileSync(path.join(ROOT, 'js', 'coach-review.js'), 'utf8');
const CR = new Function(code + `
return { CR_TAG_ORDER, crParseTags, crFairway, crFormatDate, crRoundShape, crBuildReview, crFormatRoundText, crTotalsRows };`)();

// Same order as the app's live tagging (index.html ERROR_TAG_ORDER).
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appOrder = JSON.parse(html.match(/const ERROR_TAG_ORDER = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const HOLES = PARS.map((par, i) => ({ hole_number: i + 1, par, stroke_index: i + 1 }));
// [score, putts, fairway, gir, tags, note]
const FULL = [
  [8, 2, 'R', false, 'T', 'Drive OB right, reload'], [5, 2, 'C', false, null], [4, 2, null, false, null],
  [6, 3, 'L', false, 'P'], [4, 2, 'C', true, null], [6, 2, 'X', false, 'SB'], [3, 0, null, false, null],
  [5, 2, 'C', false, null], [7, 2, 'R', false, 'A'],
  [5, 2, 'L', false, null], [12, 4, 'X', false, 'TASBP'], [3, 2, null, true, null], [6, 2, 'C', false, 'B'],
  [6, 3, 'R', false, 'P'], [4, 2, 'C', true, null], [5, 2, null, false, 'A'], [5, 2, 'C', false, null], [7, 2, 'L', false, null],
];
const shotsFrom = rows => rows.map(([score, putts, fairway, gir, tags, note], i) =>
  ({ hole_number: i + 1, score, putts, fairway, gir, error_tags: tags, notes: note ?? null }));
const full = (over = {}) => CR.crBuildReview({ status: 'completed', courseName: 'Hoebridge Golf Centre', tee: 'white', date: '2026-10-09',
  createdAt: '2026-10-09T08:00:00Z', playingHandicap: 25, stableford: 30, holes: HOLES, shots: shotsFrom(FULL), ...over });

// Historical front 9: before error tagging, legacy Y/N fairways, some putts / GIR missing.
const HIST9 = [
  [8, 2, 'N', false], [5, 2, 'Y', false], [4, null, null, null], [6, 3, 'Y', false], [4, 2, 'Y', true],
  [6, null, null, null], [3, 0, null, false], [5, 2, 'N', false], [7, 2, 'Y', false],
];
const hist9 = () => CR.crBuildReview({ status: 'completed', courseName: 'Hoebridge Golf Centre', tee: null, date: '2026-06-12',
  createdAt: '2026-06-12T10:00:00Z', playingHandicap: 27, stableford: 15, holes: HOLES, shots: shotsFrom(HIST9) });

let n = 0; const t = (name, fn) => { fn(); n++; console.log('PASS', name); };

t('tag order matches the live app (T, A, S, B, P)', () => assert.deepStrictEqual(CR.CR_TAG_ORDER, appOrder));
t('fairway mapping: C/Y ✓, L ←, R →, X OB, legacy N "miss", unrecorded —, par 3 N/A', () => {
  assert.deepStrictEqual(['C', 'Y', 'L', 'R', 'X', 'N', null, undefined].map(f => CR.crFairway(4, f)), ['✓', '✓', '←', '→', 'OB', 'miss', '—', '—']);
  assert.strictEqual(CR.crFairway(3, 'C'), 'N/A'); assert.strictEqual(CR.crFairway(3, null), 'N/A');
});
t('dates format without locale/timezone: 2026-10-09 → 9 Oct 2026', () => {
  assert.strictEqual(CR.crFormatDate('2026-10-09'), '9 Oct 2026'); assert.strictEqual(CR.crFormatDate('2026-01-31'), '31 Jan 2026');
  assert.strictEqual(CR.crFormatDate(null), null);
});

t('18-hole complete round: shape, gross, front/back, putts, FW, GIR, OB, dbl+, 3/4-putts, T/A/S/B/P', () => {
  const r = full(), x = r.totals;
  assert.strictEqual(r.reviewable, true); assert.strictEqual(r.shape, 'full'); assert.strictEqual(r.holeCount, 18);
  assert.deepStrictEqual([x.gross, x.front, x.back], [101, 48, 53]);
  assert.deepStrictEqual(x.putts, { total: 38, known: 18, of: 18 });
  assert.deepStrictEqual(x.fairways, { hit: 6, recorded: 14, of: 14 });
  assert.deepStrictEqual(x.gir, { hit: 3, known: 18, of: 18 });
  assert.strictEqual(x.teeOB.count, 2);
  assert.strictEqual(x.doubleBogeyPlus, 7);
  assert.strictEqual(x.threePutts.count, 2); assert.strictEqual(x.fourPlusPutts.count, 1);
  assert.deepStrictEqual(x.errors, { T: 2, A: 3, S: 2, B: 3, P: 3 });
});
t('Copy Round Data — exact text, 18-hole round (B tag, multiple tags, 0 putts, score 12, par 3 N/A, note)', () => {
  assert.strictEqual(CR.crFormatRoundText(full()), [
    'Round: Hoebridge Golf Centre – White tees',
    'Date: 9 Oct 2026',
    'Playing handicap: 25',
    'Score: 101',
    'Stableford: 30 pts',
    'Front: 48',
    'Back: 53',
    'Putts: 38',
    'Fairways: 6/14',
    'GIR: 3/18',
    'Tee shots OB: 2',
    'Penalties: not captured',
    'Errors: T 2 | A 3 | S 2 | B 3 | P 3',
    'Double bogey+: 7',
    '3-putts: 2',
    '4+ putts: 1',
    '',
    'Front 9',
    'H1 | Par 4 | Score 8 | FW → | GIR N | Putts 2 | Errors T | Note Drive OB right, reload',
    'H2 | Par 4 | Score 5 | FW ✓ | GIR N | Putts 2 | Errors -',
    'H3 | Par 3 | Score 4 | FW N/A | GIR N | Putts 2 | Errors -',
    'H4 | Par 5 | Score 6 | FW ← | GIR N | Putts 3 | Errors P',
    'H5 | Par 4 | Score 4 | FW ✓ | GIR Y | Putts 2 | Errors -',
    'H6 | Par 4 | Score 6 | FW OB | GIR N | Putts 2 | Errors S,B',
    'H7 | Par 3 | Score 3 | FW N/A | GIR N | Putts 0 | Errors -',
    'H8 | Par 4 | Score 5 | FW ✓ | GIR N | Putts 2 | Errors -',
    'H9 | Par 5 | Score 7 | FW → | GIR N | Putts 2 | Errors A',
    '',
    'Back 9',
    'H10 | Par 4 | Score 5 | FW ← | GIR N | Putts 2 | Errors -',
    'H11 | Par 4 | Score 12 | FW OB | GIR N | Putts 4 | Errors T,A,S,B,P',
    'H12 | Par 3 | Score 3 | FW N/A | GIR Y | Putts 2 | Errors -',
    'H13 | Par 5 | Score 6 | FW ✓ | GIR N | Putts 2 | Errors B',
    'H14 | Par 4 | Score 6 | FW → | GIR N | Putts 3 | Errors P',
    'H15 | Par 4 | Score 4 | FW ✓ | GIR Y | Putts 2 | Errors -',
    'H16 | Par 3 | Score 5 | FW N/A | GIR N | Putts 2 | Errors A',
    'H17 | Par 4 | Score 5 | FW ✓ | GIR N | Putts 2 | Errors -',
    'H18 | Par 5 | Score 7 | FW ← | GIR N | Putts 2 | Errors -',
  ].join('\n'));
});
t('output is deterministic (same input → identical text)', () => assert.strictEqual(CR.crFormatRoundText(full()), CR.crFormatRoundText(full())));

t('9-hole historical round — exact text: front only, no Back, unknown ≠ zero, legacy FW, errors not captured', () => {
  const r = hist9();
  assert.strictEqual(r.shape, 'front'); assert.strictEqual(r.totals.back, null);
  assert.strictEqual(CR.crFormatRoundText(r), [
    'Round: Hoebridge Golf Centre',
    'Date: 12 Jun 2026',
    'Playing handicap: 27',
    'Score: 48 (front 9 only)',
    'Stableford: 15 pts',
    'Front: 48',
    'Putts: 13 (7/9 holes recorded)',
    'Fairways: 4/6 recorded (of 7)',
    'GIR: 1/7 recorded (of 9)',
    'Tee shots OB: not recorded',   // legacy Y/N fairways had no OB option — not a known zero
    'Penalties: not captured',
    'Errors: not captured',
    'Double bogey+: 3',
    '3-putts: 1 (7/9 holes recorded)',
    '4+ putts: 0 (7/9 holes recorded)',
    '',
    'Front 9',
    'H1 | Par 4 | Score 8 | FW miss | GIR N | Putts 2',
    'H2 | Par 4 | Score 5 | FW ✓ | GIR N | Putts 2',
    'H3 | Par 3 | Score 4 | FW N/A | GIR — | Putts —',
    'H4 | Par 5 | Score 6 | FW ✓ | GIR N | Putts 3',
    'H5 | Par 4 | Score 4 | FW ✓ | GIR Y | Putts 2',
    'H6 | Par 4 | Score 6 | FW — | GIR — | Putts —',
    'H7 | Par 3 | Score 3 | FW N/A | GIR N | Putts 0',
    'H8 | Par 4 | Score 5 | FW miss | GIR N | Putts 2',
    'H9 | Par 5 | Score 7 | FW ✓ | GIR N | Putts 2',
  ].join('\n'));
});
t('back-9-only round: Back total, no Front', () => {
  const r = CR.crBuildReview({ status: 'completed', holes: HOLES, createdAt: '2026-10-09',
    shots: shotsFrom(FULL).filter(s => s.hole_number >= 10) });
  assert.strictEqual(r.shape, 'back'); assert.strictEqual(r.totals.front, null); assert.strictEqual(r.totals.back, 53);
  const text = CR.crFormatRoundText(r);
  assert.ok(text.includes('Score: 53 (back 9 only)') && text.includes('Back: 53') && !/^Front/m.test(text));
  assert.ok(text.startsWith('Round: Unknown course\n'), 'missing course stays honest');
});
t('no putts / GIR / fairway at all → "not recorded", never 0', () => {
  const r = CR.crBuildReview({ status: 'completed', holes: HOLES, createdAt: '2026-01-01',
    shots: HOLES.map(h => ({ hole_number: h.hole_number, score: h.par + 1, putts: null, fairway: null, gir: null })) });
  const rows = Object.fromEntries(CR.crTotalsRows(r).map(x => [x.label, x.value]));
  for (const k of ['Putts', 'Fairways', 'GIR', 'Tee shots OB', '3-putts', '4+ putts']) assert.strictEqual(rows[k], 'not recorded', k);
  assert.strictEqual(rows.Errors, 'not captured'); assert.strictEqual(rows.Penalties, 'not captured');
});
t('round tagged before B existed: B "not captured", others counted', () => {
  const shots = shotsFrom(FULL).map(s => ({ ...s, error_tags: s.error_tags ? s.error_tags.replace('B', '') || null : null }));
  const r = CR.crBuildReview({ status: 'completed', holes: HOLES, shots, createdAt: '2026-10-08T12:00:00Z' });
  assert.deepStrictEqual(r.totals.errors, { T: 2, A: 3, S: 2, B: null, P: 3 });
  assert.ok(CR.crFormatRoundText(r).includes('Errors: T 2 | A 3 | S 2 | B not captured | P 3'));
});
t('round created after tagging launched but with no tags → known zeros ("-")', () => {
  const shots = shotsFrom(FULL).map(s => ({ ...s, error_tags: null }));
  const r = CR.crBuildReview({ status: 'completed', holes: HOLES, shots, createdAt: '2026-10-09T09:00:00Z' });
  assert.deepStrictEqual(r.totals.errors, { T: 0, A: 0, S: 0, B: 0, P: 0 });
  assert.ok(CR.crFormatRoundText(r).includes('H1 | Par 4 | Score 8 | FW → | GIR N | Putts 2 | Errors -'));
});
t('only manually stored tags are shown — nothing inferred from FW miss, GIR miss, OB, 3/4-putts, double bogey, bunker', () => {
  const shots = HOLES.map(h => ({ hole_number: h.hole_number, score: h.par + 3, putts: 4, fairway: h.par >= 4 ? 'X' : null, gir: false, error_tags: null }));
  const r = CR.crBuildReview({ status: 'completed', holes: HOLES, shots, createdAt: '2026-10-09T09:00:00Z' });
  assert.ok(r.holes.every(h => h.tags.length === 0));
  assert.deepStrictEqual(r.totals.errors, { T: 0, A: 0, S: 0, B: 0, P: 0 });
});
t('tee OB counted only on C/L/R/X holes; legacy Y/N holes are not a known zero', () => {
  const mixed = shotsFrom(FULL).map((s, i) => i < 4 && s.fairway ? { ...s, fairway: 'Y' } : s);
  const r = full({ shots: mixed });
  assert.deepStrictEqual(r.totals.teeOB, { count: 2, recorded: 11, of: 14 });
  assert.ok(CR.crFormatRoundText(r).includes('Tee shots OB: 2 (11/14 holes recorded)'));
});
t('no fake bunker statistics: B is only an error count, no bunker-shot field anywhere', () => {
  const r = full();
  // `bunkerCaptured` only says whether the B tag existed for this round; there must be no
  // bunker shot / attempt / sand-save style field derived from anything.
  const keys = JSON.stringify(r).match(/"[A-Za-z]+":/g).map(k => k.slice(1, -2));
  assert.deepStrictEqual(keys.filter(k => /bunker|sand/i.test(k)), ['bunkerCaptured']);
  assert.ok(!/bunker/i.test(CR.crFormatRoundText(r)), 'copied text has no bunker-shot line');
});
t('review unavailable: in-progress round, 17 holes, 10 holes, duplicate hole, missing course par', () => {
  assert.deepStrictEqual(full({ status: 'in_progress' }), { reviewable: false, reason: 'in progress' });
  assert.strictEqual(full({ status: 'in_progress', allowInProgress: true }).reviewable, true, 'just-finished round on device');
  assert.strictEqual(full({ shots: shotsFrom(FULL).slice(0, 17) }).reviewable, false);
  assert.strictEqual(full({ shots: shotsFrom(FULL).slice(0, 10) }).reviewable, false);
  assert.strictEqual(full({ shots: [...shotsFrom(FULL), { hole_number: 3, score: 4 }] }).reviewable, false);
  assert.strictEqual(full({ holes: HOLES.slice(0, 17) }).reviewable, false);
  assert.strictEqual(CR.crFormatRoundText({ reviewable: false }), '');
});
t('unscored placeholder rows are ignored, not counted', () => {
  const shots = [...shotsFrom(FULL), { hole_number: 5, score: null, putts: null }];
  assert.strictEqual(full({ shots }).reviewable, true);
});
t('notes: whitespace collapsed; absent notes omitted', () => {
  const shots = shotsFrom(FULL).map((s, i) => i === 1 ? { ...s, notes: '  Lip-out\n  for par ' } : s);
  const text = CR.crFormatRoundText(full({ shots }));
  assert.ok(text.includes('H2 | Par 4 | Score 5 | FW ✓ | GIR N | Putts 2 | Errors - | Note Lip-out for par'));
  assert.ok(text.includes('H3 | Par 3 | Score 4 | FW N/A | GIR N | Putts 2 | Errors -\n'));
});

console.log(`\nAll ${n} coach-review tests passed.`);
