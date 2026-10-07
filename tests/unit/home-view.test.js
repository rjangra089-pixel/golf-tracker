// Offline tests for HOME COACHING VIEW (chooseFocus, nextRoundTarget, buildHomeView).
// Uses the real Phase A model + view source from index.html. No DOM, network or DB.
const fs = require('fs');
const assert = require('assert');
const src = fs.readFileSync(process.argv[2] || require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const section = src.slice(src.indexOf('//  HOME COACHING MODEL'), src.indexOf('//  PLAY SCREEN'));
assert.ok(section.includes('//  HOME COACHING VIEW'), 'view section not found');
const M = new Function('sbFetch', section + `
return { buildHomeModel, chooseFocus, nextRoundTarget, buildHomeView, leakRates, FOCUS_THRESHOLDS };`)(async () => []);

// ── helpers ───────────────────────────────────────────────────
// A model shaped exactly like buildHomeModel() output, with chosen (already 1-dp) rates.
const leak = (perRound, q = 5) => perRound === null ? { notEnoughData: true, qualifyingRounds: q, windowRounds: 5 }
  : { total: Math.round(perRound * q), qualifyingRounds: q, perRound };
const model = ({ complete = 5, blow = 0, putt = 0, ob = 0, form = null } = {}) => ({
  counts: { fetched: complete, complete, skipped: 0 },
  recentForm: form || { available: complete > 0, roundsCount: Math.min(5, complete), fullWindow: complete >= 5,
    rounds: Array.from({ length: Math.min(5, complete) }, (_, i) => ({ id: 'r' + i, date: '2026-09-0' + (i + 1), gross: 100 + i })),
    average: 102, previousAverage: complete >= 10 ? 104 : null, direction: complete >= 10 ? 'steady' : null, deltaShots: null },
  leaks: { windowRounds: Math.min(5, complete), blowUps: leak(blow), threePutts: leak(putt), teeShotsOB: leak(ob) },
});
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('PASS', name); };

// ── chooseFocus ───────────────────────────────────────────────
t('chooseFocus: fewer than 3 complete rounds → null (0, 1, 2)', () => {
  for (const c of [0, 1, 2]) assert.strictEqual(M.chooseFocus(model({ complete: c, blow: 9 })), null);
  assert.strictEqual(M.chooseFocus(null), null);
  assert.ok(M.chooseFocus(model({ complete: 3 })));
});
t('chooseFocus: blow-ups 1.9 → not blow-up; 2.0 → blow-up', () => {
  assert.strictEqual(M.chooseFocus(model({ blow: 1.9 })).kind, 'consistency');
  assert.deepStrictEqual(M.chooseFocus(model({ blow: 2.0 })), { kind: 'blowUps', rate: 2.0 });
});
t('chooseFocus: heavy 3-putting (3.0) overrides qualifying blow-ups', () => {
  assert.deepStrictEqual(M.chooseFocus(model({ blow: 2.5, putt: 3.0 })), { kind: 'threePutts', rate: 3.0 });
  assert.deepStrictEqual(M.chooseFocus(model({ blow: 5.0, putt: 3.1, ob: 2 })), { kind: 'threePutts', rate: 3.1 });
});
t('chooseFocus: 3-putts 2.9 do NOT override qualifying blow-ups (2.0)', () => {
  assert.deepStrictEqual(M.chooseFocus(model({ blow: 2.0, putt: 2.9 })), { kind: 'blowUps', rate: 2.0 });
});
t('chooseFocus: blow-ups beat OB of any size; heavy-putt rule needs enough putting data', () => {
  assert.strictEqual(M.chooseFocus(model({ blow: 2.0, putt: 1.0, ob: 3.0 })).kind, 'blowUps');
  assert.strictEqual(M.chooseFocus(model({ blow: 2.0, putt: null, ob: 3.0 })).kind, 'blowUps');
});
t('chooseFocus: main account (blow-ups 3.6, 3-putts 4.0, OB 0.3) → three-putt focus', () => {
  assert.deepStrictEqual(M.chooseFocus(model({ blow: 3.6, putt: 4.0, ob: 0.3 })), { kind: 'threePutts', rate: 4.0 });
});
t('chooseFocus: 3-putts 1.9 → not; 2.0 → three-putt focus (when blow-ups < 2.0)', () => {
  assert.strictEqual(M.chooseFocus(model({ blow: 1.9, putt: 1.9 })).kind, 'consistency');
  assert.deepStrictEqual(M.chooseFocus(model({ blow: 1.9, putt: 2.0 })), { kind: 'threePutts', rate: 2.0 });
});
t('chooseFocus: OB 0.4 → not; 0.5 → tee OB focus', () => {
  assert.strictEqual(M.chooseFocus(model({ blow: 1, putt: 1, ob: 0.4 })).kind, 'consistency');
  assert.deepStrictEqual(M.chooseFocus(model({ blow: 1, putt: 1, ob: 0.5 })), { kind: 'teeShotsOB', rate: 0.5 });
});
t('chooseFocus: missing putting data skips 3-putts (falls through to OB)', () => {
  assert.strictEqual(M.chooseFocus(model({ blow: 1, putt: null, ob: 0.8 })).kind, 'teeShotsOB');
});
t('chooseFocus: missing OB data skips OB (→ consistency)', () => {
  assert.strictEqual(M.chooseFocus(model({ blow: 1, putt: 1, ob: null })).kind, 'consistency');
  assert.strictEqual(M.chooseFocus(model({ blow: 1, putt: null, ob: null })).kind, 'consistency');
});
t('chooseFocus: consistency when every available leak is under threshold', () => {
  assert.deepStrictEqual(M.chooseFocus(model({ blow: 0.2, putt: 0.6, ob: 0 })), { kind: 'consistency', rate: null });
});
t('chooseFocus: thresholds use the model-rounded 1-dp value (1.96 raw → 2.0 → qualifies; 1.94 → 1.9 → not)', () => {
  // Real Phase A leakRates: 49 blow-ups over 25 rounds = 1.96 raw → perRound 2.0; 97/50 = 1.94 → 1.9.
  const r = (total, rounds) => ({ total, qualifyingRounds: rounds, perRound: Math.round(total / rounds * 10) / 10 });
  const withLeaks = (complete, blowUps) => ({ ...model({ complete }), leaks: { windowRounds: 5, blowUps,
    threePutts: { notEnoughData: true, qualifyingRounds: 0, windowRounds: 5 }, teeShotsOB: { notEnoughData: true, qualifyingRounds: 0, windowRounds: 5 } } });
  const m196 = withLeaks(25, r(49, 25)), m194 = withLeaks(50, r(97, 50));
  assert.deepStrictEqual(M.chooseFocus(m196), { kind: 'blowUps', rate: 2.0 });
  assert.strictEqual(M.chooseFocus(m194).kind, 'consistency');
  // And a model built by the real Phase A code: rate shown == rate compared.
  const view = M.buildHomeView(m196, { hi: 25, target: 15 });
  assert.strictEqual(view.focus.evidence, "You're averaging 2.0 zero-point holes per round.");
});

// ── nextRoundTarget ───────────────────────────────────────────
const target = (kind, rate) => M.nextRoundTarget({ kind, rate }, null);
t('nextRoundTarget: blow-ups 3.2 → Maximum 2 blow-up holes', () => assert.deepStrictEqual(target('blowUps', 3.2), { kind: 'blowUps', max: 2, text: 'Maximum 2 blow-up holes' }));
t('nextRoundTarget: blow-ups 2.0 → Maximum 1 blow-up hole (singular)', () => assert.strictEqual(target('blowUps', 2.0).text, 'Maximum 1 blow-up hole'));
t('nextRoundTarget: 3-putts fixed targets — 2.0 / 2.4 / 2.9 → Maximum 1 three-putt', () => {
  for (const r of [2.0, 2.4, 2.9]) assert.deepStrictEqual(target('threePutts', r), { kind: 'threePutts', max: 1, text: 'Maximum 1 three-putt' });
});
t('nextRoundTarget: 3-putts 3.0 / 3.5 / 4.0 / 6.3 → Maximum 2 three-putts (not floor − 1)', () => {
  for (const r of [3.0, 3.5, 4.0, 6.3]) assert.deepStrictEqual(target('threePutts', r), { kind: 'threePutts', max: 2, text: 'Maximum 2 three-putts' });
});
t('nextRoundTarget: OB 0.8 → No tee shots OB; 0.5 → No; 2.1 → Maximum 1 tee shot OB', () => {
  assert.deepStrictEqual(target('teeShotsOB', 0.8), { kind: 'teeShotsOB', max: 0, text: 'No tee shots OB' });
  assert.strictEqual(target('teeShotsOB', 0.5).text, 'No tee shots OB');
  assert.strictEqual(target('teeShotsOB', 2.1).text, 'Maximum 1 tee shot OB');
});
t('nextRoundTarget: consistency / null focus → none', () => {
  assert.strictEqual(M.nextRoundTarget({ kind: 'consistency', rate: null }, null), null);
  assert.strictEqual(M.nextRoundTarget(null, null), null);
});

// ── buildHomeView ─────────────────────────────────────────────
const P = { hi: 25, target: 15 };
t('buildHomeView: Road to 15 copy (25.0 → 15.0, 10.0 to go · target Dec 2026)', () => {
  const v = M.buildHomeView(model(), P);
  assert.deepStrictEqual(v.road, { title: 'Road to 15', hi: '25.0', target: '15.0', gap: '10.0 to go · target Dec 2026' });
});
t('buildHomeView: decimal handicaps (24.3 → 14.5; 18.66 rounds to 18.7)', () => {
  const v = M.buildHomeView(null, { hi: 24.3, target: 14.5 });
  assert.deepStrictEqual(v.road, { title: 'Road to 14.5', hi: '24.3', target: '14.5', gap: '9.8 to go · target Dec 2026' });
  assert.strictEqual(M.buildHomeView(null, { hi: 18.66, target: 15 }).road.hi, '18.7');
});
t('buildHomeView: target reached (equal and below) — never a negative gap', () => {
  assert.strictEqual(M.buildHomeView(null, { hi: 15, target: 15 }).road.gap, 'Target reached');
  assert.strictEqual(M.buildHomeView(null, { hi: 14.2, target: 15 }).road.gap, 'Target reached');
  assert.strictEqual(M.buildHomeView(null, { hi: 15.04, target: 15 }).road.gap, 'Target reached');   // shows 15.0 = 15.0
});
t('buildHomeView: missing HI / target → prompts, no NaN', () => {
  const v = M.buildHomeView(null, { hi: null, target: 15 });
  assert.strictEqual(v.road.hi, '—'); assert.strictEqual(v.road.gap, 'Set your Handicap Index in Profile');
  assert.strictEqual(M.buildHomeView(null, { hi: 25, target: null }).road.title, 'Road to target');
  assert.ok(!JSON.stringify(M.buildHomeView(null, { hi: NaN, target: undefined })).includes('NaN'));
});
t('buildHomeView: model not loaded → only Road; load error shown only without a model', () => {
  const v = M.buildHomeView(null, { ...P, loadError: false });
  assert.ok(!v.form.show && !v.leaks.show && !v.focus.show && !v.empty.show && !v.loadError.show);
  assert.strictEqual(M.buildHomeView(null, { ...P, loadError: true }).loadError.show, true);
  assert.strictEqual(M.buildHomeView(model(), { ...P, loadError: true }).loadError.show, false);
});
t('buildHomeView: 0 complete rounds → empty message only', () => {
  const v = M.buildHomeView(model({ complete: 0 }), P);
  assert.deepStrictEqual(v.empty, { show: true, text: 'Play 3 full rounds and your coaching starts here.' });
  assert.ok(!v.form.show && !v.unlock.show && !v.leaks.show && !v.focus.show);
});
t('buildHomeView: 1–2 complete rounds → form + unlock message (singular/plural), no leaks/focus', () => {
  const v1 = M.buildHomeView(model({ complete: 1, blow: 5 }), P);
  assert.ok(v1.form.show && !v1.leaks.show && !v1.focus.show);
  assert.strictEqual(v1.unlock.text, 'Play 2 more full rounds to see your scoring leaks.');
  assert.strictEqual(v1.form.meta, '· last 1 round');
  const v2 = M.buildHomeView(model({ complete: 2 }), P);
  assert.strictEqual(v2.unlock.text, 'Play 1 more full round to see your scoring leaks.');
  assert.strictEqual(v2.form.scores, '100 · 101');
});
t('buildHomeView: 3–4 complete rounds → leaks over "last n" + focus, no direction', () => {
  const v = M.buildHomeView(model({ complete: 4, blow: 2.5 }), P);
  assert.ok(v.form.show && v.leaks.show && v.focus.show && !v.unlock.show);
  assert.strictEqual(v.leaks.sub, 'Per round · last 4'); assert.strictEqual(v.form.direction, null);
  assert.strictEqual(v.focus.kind, 'blowUps');
});
t('buildHomeView: 5–9 complete rounds → full window, no direction', () => {
  const v = M.buildHomeView(model({ complete: 7 }), P);
  assert.strictEqual(v.form.meta, '· last 5 rounds'); assert.strictEqual(v.form.direction, null);
  assert.strictEqual(v.leaks.sub, 'Per round · last 5');
});
t('buildHomeView: 10+ complete rounds → direction shown', () => {
  assert.strictEqual(M.buildHomeView(model({ complete: 12 }), P).form.direction, 'steady');
});
t('buildHomeView: blow-up focus copy (3.2), principle, one tracked target', () => {
  const v = M.buildHomeView(model({ blow: 3.2, putt: 2.4, ob: 0.8 }), P);
  assert.deepStrictEqual(v.focus, { show: true, kind: 'blowUps', headline: 'Stop the blow-up hole.',
    evidence: "You're averaging 3.2 zero-point holes per round.", principle: "One mistake doesn't get a friend.", target: 'Maximum 2 blow-up holes' });
  assert.deepStrictEqual(v.leaks.rows.map(r => [r.label, r.value, r.muted]),
    [['Blow-up holes', '3.2', false], ['3-putts', '2.4', false], ['Tee shots OB', '0.8', false]]);
});
t('buildHomeView: main account case → exact three-putt focus copy and target', () => {
  const v = M.buildHomeView(model({ blow: 3.6, putt: 4.0, ob: 0.3 }), P);
  assert.deepStrictEqual(v.focus, { show: true, kind: 'threePutts', headline: 'Cut the three-putts.',
    evidence: "You're averaging 4.0 three-putts per round.", principle: null, target: 'Maximum 2 three-putts' });
  assert.ok(!/3\.0|heavy|hierarch|priority/i.test(JSON.stringify(v)), 'rule never exposed in copy');
});
t('buildHomeView: 3-putt focus has no principle line', () => {
  const v = M.buildHomeView(model({ blow: 1.0, putt: 2.4 }), P);
  assert.strictEqual(v.focus.headline, 'Cut the three-putts.'); assert.strictEqual(v.focus.principle, null);
  assert.strictEqual(v.focus.evidence, "You're averaging 2.4 three-putts per round."); assert.strictEqual(v.focus.target, 'Maximum 1 three-putt');
});
t('buildHomeView: tee OB focus copy + principle + "No tee shots OB"', () => {
  const v = M.buildHomeView(model({ blow: 1.0, putt: 1.0, ob: 0.8 }), P);
  assert.strictEqual(v.focus.headline, 'Keep the tee shot in play.');
  assert.strictEqual(v.focus.evidence, "You're averaging 0.8 tee shots OB per round.");
  assert.strictEqual(v.focus.principle, "One mistake doesn't get a friend."); assert.strictEqual(v.focus.target, 'No tee shots OB');
});
t('buildHomeView: consistency focus — copy, no target, no principle', () => {
  const v = M.buildHomeView(model({ blow: 0.4, putt: 0.6, ob: 0 }), P);
  assert.deepStrictEqual(v.focus, { show: true, kind: 'consistency', headline: 'Keep building consistency.',
    evidence: 'No single scoring leak is dominating your recent rounds.', principle: null, target: null });
});
t('buildHomeView: missing leak data → muted "Not enough data" rows with a reason (not hidden)', () => {
  const v = M.buildHomeView(model({ blow: 1.2, putt: null, ob: null }), P);
  assert.deepStrictEqual(v.leaks.rows.map(r => [r.label, r.value, r.muted]),
    [['Blow-up holes', '1.2', false], ['3-putts', 'Not enough data', true], ['Tee shots OB', 'Not enough data', true]]);
  assert.strictEqual(v.leaks.rows[1].note, 'Putts recorded on all 18 holes in 5 of 5 rounds');
  assert.strictEqual(v.leaks.rows[2].note, 'Tee shots recorded on every par 4 and 5 in 5 of 5 rounds');
  assert.strictEqual(v.leaks.rows[0].note, '');
});
t('buildHomeView: every number shown equals fmt of the model value (one canonical rate)', () => {
  const v = M.buildHomeView(model({ blow: 2.0, putt: 2.0, ob: 0.5 }), P);
  assert.deepStrictEqual(v.leaks.rows.map(r => r.value), ['2.0', '2.0', '0.5']);
  assert.ok(v.focus.evidence.includes('2.0'));
});
t('buildHomeView: no hidden HTML handling — strings are plain text', () => {
  const v = M.buildHomeView(model({ blow: 3 }), P);
  assert.ok(!/[<>]/.test(JSON.stringify(v)));
});

console.log(`\nAll ${passed} home-view tests passed.`);
