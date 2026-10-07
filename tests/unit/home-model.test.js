// Offline tests for the HOME COACHING MODEL section of index.html.
// Extracts the real section source, runs it with no DOM, no network, no DB.
const fs = require('fs');
const assert = require('assert');
const src = fs.readFileSync(process.argv[2] || require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const start = src.indexOf('//  HOME COACHING MODEL');
const end = src.indexOf('//  PLAY SCREEN');
assert.ok(start > 0 && end > start, 'section not found');
const section = src.slice(start, end);
let fetched = [];
const sbFetch = async (path) => { fetched.push(path); return []; };   // never hits the network
const M = new Function('sbFetch', section + `
return { HOME_HISTORY_LIMIT, fetchHomeHistory, courseHoleMap, isCompleteRound, orderRounds,
         grossScore, shotsReceivedFor, holePoints, recentForm, leakRates, buildHomeModel };`)(sbFetch);

// ── fixtures ────────────────────────────────────────────────────
// Course A: par 72 (4 par 3s, 10 par 4s, 4 par 5s), SI 1..18 in hole order.
const PARS_A = [4,4,3,5,4,4,3,4,5, 4,4,3,5,4,4,3,4,5];
// Course B: same hole numbers, different par/SI (hole 1 is a par 3 SI 18 here).
const PARS_B = [3,5,4,4,4,3,4,5,4, 4,3,5,4,4,4,3,5,4];
const course = (name, pars, siOf = i => i + 1) =>
  ({ name, holes: pars.map((par, i) => ({ hole_number: i + 1, par, stroke_index: siOf(i) })) });
const COURSE_A = course('Course A', PARS_A);
const COURSE_B = course('Course B', PARS_B, i => 18 - i);

let seq = 0;
// scores: array of 18 numbers (or a function i -> score). extra: per-shot overrides.
function round({ date = '2026-09-01', created = null, status = 'completed', crs = COURSE_A, hc = 25,
                 scores = null, putts = 2, fairway = 'C', shots = null } = {}) {
  seq++;
  const pars = crs.holes.map(h => h.par);
  const sc = scores || pars.map(p => p + 1);
  return {
    id: 'r' + seq, date, created_at: created || `${date}T1${seq % 10}:00:00Z`, round_status: status,
    course_id: crs.name, playing_handicap: hc, tee_color: 'yellow', courses: crs,
    shots: shots || sc.map((score, i) => ({
      hole_number: i + 1, score,
      putts: typeof putts === 'function' ? putts(i) : putts,
      fairway: typeof fairway === 'function' ? fairway(i, pars[i]) : (pars[i] === 3 ? null : fairway),
    })),
  };
}
const gross = r => r.shots.reduce((s, x) => s + x.score, 0);
const withGross = (g, opts = {}) => {          // 18 holes summing to g (spread evenly)
  const base = Math.floor(g / 18), extra = g - base * 18;
  return round({ ...opts, scores: Array.from({ length: 18 }, (_, i) => base + (i < extra ? 1 : 0)) });
};

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('PASS', name); };

// ── completeness ────────────────────────────────────────────────
t('valid full round is complete', () => assert.ok(M.isCompleteRound(round())));
t('partial round marked completed is NOT complete', () => {
  const r = round(); r.shots = r.shots.slice(0, 12); assert.strictEqual(r.round_status, 'completed');
  assert.ok(!M.isCompleteRound(r));
});
t('duplicate hole number is NOT complete', () => {
  const r = round(); r.shots[5] = { ...r.shots[5], hole_number: 5 }; assert.ok(!M.isCompleteRound(r));
});
t('missing hole (17 rows) is NOT complete', () => {
  const r = round(); r.shots = r.shots.filter(s => s.hole_number !== 9); assert.ok(!M.isCompleteRound(r));
});
t('null / 0 / fractional / string score is NOT complete', () => {
  for (const bad of [null, 0, 4.5, '5', undefined, -1]) {
    const r = round(); r.shots[3] = { ...r.shots[3], score: bad }; assert.ok(!M.isCompleteRound(r), String(bad));
  }
});
t('in_progress is NOT complete even with 18 holes', () => assert.ok(!M.isCompleteRound(round({ status: 'in_progress' }))));
t('null status (legacy fallback save) with 18 holes IS complete', () => assert.ok(M.isCompleteRound(round({ status: null }))));
t('course with 17 holes / bad par / bad SI / duplicate hole is NOT complete', () => {
  const c17 = { ...COURSE_A, holes: COURSE_A.holes.slice(0, 17) };
  const cPar = { ...COURSE_A, holes: COURSE_A.holes.map((h, i) => i === 2 ? { ...h, par: null } : h) };
  const cSi = { ...COURSE_A, holes: COURSE_A.holes.map((h, i) => i === 2 ? { ...h, stroke_index: 19 } : h) };
  const cDup = { ...COURSE_A, holes: COURSE_A.holes.map((h, i) => i === 2 ? { ...h, hole_number: 2 } : h) };
  for (const c of [c17, cPar, cSi, cDup]) assert.ok(!M.isCompleteRound(round({ crs: c })));
  const noCourse = round(); noCourse.courses = null; assert.ok(!M.isCompleteRound(noCourse));
});

// ── ordering ────────────────────────────────────────────────────
t('two rounds on the same date: created_at decides (newest first)', () => {
  const early = round({ date: '2026-09-20', created: '2026-09-20T08:00:00Z' });
  const late = round({ date: '2026-09-20', created: '2026-09-20T15:00:00Z' });
  const older = round({ date: '2026-09-19', created: '2026-09-25T09:00:00Z' }); // later created, earlier date
  const o = M.orderRounds([early, older, late]);
  assert.deepStrictEqual(o.map(r => r.id), [late.id, early.id, older.id]);
});

// ── gross ───────────────────────────────────────────────────────
t('gross = sum of hole scores', () => {
  const r = round({ scores: Array.from({ length: 18 }, (_, i) => 3 + (i % 4)) });
  assert.strictEqual(M.grossScore(r), gross(r));
});

// ── Stableford parity with the app's existing calcPoints() ─────
t('shotsReceivedFor / holePoints match existing getShotsReceived / calcPoints', () => {
  const calc = new Function(`let playingHC, HOLES; ${src.match(/function getShotsReceived[\s\S]*?\n\}/)[0]}
    ${src.match(/function calcPoints[\s\S]*?\n\}/)[0]}
    return (hc, holes, idx, score) => { playingHC = hc; HOLES = holes; return calcPoints(idx, score); };`)();
  const holes = PARS_A.map((par, i) => ({ par, si: i + 1 }));
  for (const hc of [0, 7, 18, 25, 28, 36, 40, 54]) for (let i = 0; i < 18; i++) for (let s = 1; s <= 12; s++)
    assert.strictEqual(M.holePoints(holes[i].par, holes[i].si, hc, s), calc(hc, holes, i, s));
});

// ── blow-up boundary + handicap above 18 ────────────────────────
t('blow-up boundary: net double = 0 pts (blow-up), net bogey = 1 pt', () => {
  // hc 25: SI 1..7 get 2 shots, SI 8..18 get 1.  Par 4 SI 1: net double = 4+2+2 = 8.
  assert.strictEqual(M.holePoints(4, 1, 25, 8), 0);
  assert.strictEqual(M.holePoints(4, 1, 25, 7), 1);
  // Par 4 SI 8 (1 shot): net double = 7.
  assert.strictEqual(M.holePoints(4, 8, 25, 7), 0);
  assert.strictEqual(M.holePoints(4, 8, 25, 6), 1);
});
t('playing handicap above 18: SI <= hc-18 receives 2 shots; 36 gives 2 everywhere; 40 gives 3 on SI 1-4', () => {
  assert.strictEqual(M.shotsReceivedFor(7, 25), 2);
  assert.strictEqual(M.shotsReceivedFor(8, 25), 1);
  assert.strictEqual(M.shotsReceivedFor(18, 36), 2);
  assert.strictEqual(M.shotsReceivedFor(4, 40), 3);
  assert.strictEqual(M.shotsReceivedFor(5, 40), 2);
});

// ── own course for historic rounds ──────────────────────────────
t('two courses: each round evaluated with ITS OWN course (by hole_number)', () => {
  // Hole 1: course A par 4 SI 1; course B par 3 SI 18.  hc 18 → A gets 1, B gets 1.
  // Score 7 on hole 1: A → net 6 on par 4 = 0 pts (blow-up). B → net 6 on par 3 = 0 pts too.
  // Score 6 on hole 1: A → net 5, par 4 → 1 pt.  B → net 5, par 3 → 0 pts (blow-up).
  const base = i => (i === 0 ? 6 : null);
  const a = round({ crs: COURSE_A, hc: 18, scores: PARS_A.map((p, i) => base(i) ?? p) });
  const b = round({ crs: COURSE_B, hc: 18, scores: PARS_B.map((p, i) => base(i) ?? p) });
  assert.strictEqual(M.leakRates([a]).blowUps.total, 0, 'course A: hole 1 score 6 is not a blow-up');
  assert.strictEqual(M.leakRates([b]).blowUps.total, 1, 'course B: hole 1 score 6 IS a blow-up');
  // The model has no access to any global course data at all:
  assert.ok(!/\bHOLES\b|\bselectedCourseSlug\b|\bcourseId\b|\bplayingHC\b/.test(section.replace(/\/\/.*$/gm, '')),
    'section must not reference global course/handicap state');
});
t('hole rows matched by hole_number, not position or id (shuffled holes still work)', () => {
  const shuffled = { ...COURSE_A, holes: [...COURSE_A.holes].reverse().map(h => ({ ...h, id: 'new-' + h.hole_number })) };
  const r = round({ crs: shuffled, hc: 0, scores: PARS_A.map((p, i) => (i === 2 ? p + 2 : p)) }); // hole 3 par 3 → 5 = 0 pts
  assert.strictEqual(M.leakRates([r]).blowUps.total, 1);
});

// ── recent form windows ─────────────────────────────────────────
const nRounds = (grosses) => grosses.map((g, i) =>
  withGross(g, { date: `2026-08-${String(30 - i).padStart(2, '0')}` }));       // index 0 = newest
t('0 complete rounds → not available', () => {
  const m = M.buildHomeModel([]); assert.deepStrictEqual(m.recentForm, { available: false, roundsCount: 0 });
});
t('1 complete round → average, no direction', () => {
  const f = M.buildHomeModel(nRounds([100])).recentForm;
  assert.strictEqual(f.roundsCount, 1); assert.strictEqual(f.average, 100);
  assert.strictEqual(f.fullWindow, false); assert.strictEqual(f.direction, null);
});
t('4 complete rounds → average of 4, no direction', () => {
  const f = M.buildHomeModel(nRounds([100, 102, 104, 106])).recentForm;
  assert.strictEqual(f.roundsCount, 4); assert.strictEqual(f.average, 103); assert.strictEqual(f.direction, null);
});
t('5 complete rounds → full window, no direction', () => {
  const f = M.buildHomeModel(nRounds([102, 105, 98, 100, 114])).recentForm;
  assert.strictEqual(f.fullWindow, true); assert.strictEqual(f.average, 103.8); assert.strictEqual(f.direction, null);
  assert.deepStrictEqual(f.rounds.map(r => r.gross), [102, 105, 98, 100, 114]);
});
t('9 complete rounds → still no direction', () => {
  const f = M.buildHomeModel(nRounds([100, 100, 100, 100, 100, 120, 120, 120, 120])).recentForm;
  assert.strictEqual(f.direction, null); assert.strictEqual(f.previousAverage, null);
});
t('10 complete rounds → direction available', () => {
  const f = M.buildHomeModel(nRounds([100, 100, 100, 100, 100, 110, 110, 110, 110, 110])).recentForm;
  assert.strictEqual(f.direction, 'improving'); assert.strictEqual(f.previousAverage, 110); assert.strictEqual(f.deltaShots, 10);
});
t('form-direction boundaries: exactly 2.0 better/worse, 1.8 either side', () => {
  const dir = (last, prev) => M.buildHomeModel(nRounds([...last, ...prev])).recentForm.direction;
  assert.strictEqual(dir([100, 100, 100, 100, 100], [102, 102, 102, 102, 102]), 'improving');   // +2.0
  assert.strictEqual(dir([100, 100, 100, 100, 100], [98, 98, 98, 98, 98]), 'slipping');         // −2.0
  assert.strictEqual(dir([100, 100, 100, 100, 100], [102, 102, 102, 102, 101]), 'steady');      // +1.8
  assert.strictEqual(dir([100, 100, 100, 100, 100], [98, 98, 98, 98, 99]), 'steady');          // −1.8
  assert.strictEqual(dir([103, 104, 98, 101, 113], [106, 105, 107, 104, 107.0]), 'improving');  // 519 vs 529: +2.0
});
t('partial rounds are skipped entirely (do not occupy window slots)', () => {
  const rs = nRounds([100, 100, 100, 100, 100, 110, 110, 110, 110, 110]);
  const partial = withGross(150, { date: '2026-08-31' }); partial.shots = partial.shots.slice(0, 9);
  const inprog = withGross(150, { date: '2026-09-01', status: 'in_progress' });
  const m = M.buildHomeModel([partial, inprog, ...rs]);
  assert.strictEqual(m.counts.complete, 10); assert.strictEqual(m.counts.skipped, 2);
  assert.strictEqual(m.recentForm.average, 100); assert.strictEqual(m.recentForm.direction, 'improving');
});

// ── 3-putts ─────────────────────────────────────────────────────
t('3-putts: rounds with putts on all 18 qualify; putts = 0 counts as recorded', () => {
  const r1 = round({ putts: i => (i === 0 ? 0 : i < 3 ? 3 : 2) });   // hole1 chip-in(0), holes 2-3 three-putts
  const r2 = round({ putts: i => (i < 1 ? 4 : 2) });                   // one 4-putt
  const r3 = round({ putts: 2 });
  const lr = M.leakRates([r1, r2, r3]).threePutts;
  assert.deepStrictEqual(lr, { total: 3, qualifyingRounds: 3, perRound: 1 });
});
t('3-putts: round with any null putts excluded; < 3 qualifying → notEnoughData', () => {
  const ok1 = round({ putts: 3 }), ok2 = round({ putts: 2 });
  const gap = round({ putts: i => (i === 10 ? null : 2) });
  const none = round({ putts: null });
  const lr = M.leakRates([ok1, ok2, gap, none, round({ putts: i => (i === 0 ? undefined : 2) })]).threePutts;
  assert.deepStrictEqual(lr, { notEnoughData: true, qualifyingRounds: 2, windowRounds: 5 });
});

// ── tee shots OB ────────────────────────────────────────────────
t('OB: only par 4/5 count; X on a par 3 is ignored; par-3 fairway may be null', () => {
  const fw = (i, par) => (par === 3 ? (i === 2 ? 'X' : null) : (i === 0 || i === 3 ? 'X' : 'C'));
  const rs = [round({ fairway: fw }), round({ fairway: fw }), round({ fairway: fw })];
  const lr = M.leakRates(rs).teeShotsOB;
  assert.deepStrictEqual(lr, { total: 6, qualifyingRounds: 3, perRound: 2 });
});
t('OB: round missing any par-4/5 fairway value is excluded → notEnoughData', () => {
  const full = () => round({ fairway: (i, par) => (par === 3 ? null : 'L') });
  const gap = round({ fairway: (i, par) => (par === 3 ? null : i === 4 ? null : 'C') });
  const empty = round({ fairway: (i, par) => (par === 3 ? null : i === 4 ? '' : 'R') });
  const lr = M.leakRates([full(), full(), gap, empty]).teeShotsOB;
  assert.deepStrictEqual(lr, { notEnoughData: true, qualifyingRounds: 2, windowRounds: 4 });
});

// ── blow-ups available for every complete round ─────────────────
t('blow-ups: total + per round over the last-5 window', () => {
  // hc 0 → blow-up whenever score >= par + 2.  r1: 3 blow-ups, r2: 1, r3: 0.
  const mk = n => round({ hc: 0, scores: PARS_A.map((p, i) => (i < n ? p + 2 : p)) });
  const lr = M.leakRates([mk(3), mk(1), mk(0)]).blowUps;
  assert.deepStrictEqual(lr, { total: 4, qualifyingRounds: 3, perRound: 1.3 });
});
t('leaks use only the last 5 complete rounds', () => {
  const mk = (n, d) => round({ hc: 0, date: d, scores: PARS_A.map((p, i) => (i < n ? p + 2 : p)) });
  const rs = [mk(1, '2026-09-10'), mk(1, '2026-09-09'), mk(1, '2026-09-08'), mk(1, '2026-09-07'), mk(1, '2026-09-06'),
              mk(9, '2026-09-05')];   // 6th round, outside the window
  const m = M.buildHomeModel(rs);
  assert.strictEqual(m.leaks.windowRounds, 5); assert.deepStrictEqual(m.leaks.blowUps, { total: 5, qualifyingRounds: 5, perRound: 1 });
});

// ── fetch builds the agreed query, read-only, never runs without a user ──
(async () => {
  fetched = [];
  await M.fetchHomeHistory('11111111-2222-3333-4444-555555555555');
  const q = fetched[0];
  assert.ok(q.startsWith('rounds?select=id,date,created_at,round_status,course_id,playing_handicap,tee_color,'));
  assert.ok(q.includes('shots(hole_number,score,putts,fairway)'));
  assert.ok(q.includes('courses(name,holes(hole_number,par,stroke_index))'));
  assert.ok(q.includes('&user_id=eq.11111111-2222-3333-4444-555555555555'));
  assert.ok(q.includes('&or=(round_status.is.null,round_status.neq.in_progress)'));
  assert.ok(q.includes('&order=date.desc,created_at.desc') && q.endsWith('&limit=40'));
  await assert.rejects(M.fetchHomeHistory(null), /no user/);
  console.log('PASS fetchHomeHistory query shape (mocked, no network)');
  passed++;

  // ── sample model from the illustrative data ──
  const sample = [102, 105, 98, 100, 114, 106, 104, 109, 101, 107].map((g, i) => {
    const r = withGross(g, { date: `2026-09-${String(28 - i * 2).padStart(2, '0')}`, hc: 25 });
    return r;
  });
  // make the leaks interesting: add 3-putts and an OB on the newest rounds
  sample[0].shots[0].putts = 3; sample[0].shots[5].putts = 3; sample[1].shots[2].putts = 3;
  sample[0].shots[0].fairway = 'X';
  const partial = withGross(60, { date: '2026-09-29' }); partial.shots = partial.shots.slice(0, 9);
  const model = M.buildHomeModel([partial, ...sample]);
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(model, null, 2));   // optional sample output
  console.log(`\nAll ${passed} home-model tests passed.`);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
