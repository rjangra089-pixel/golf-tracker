// Offline tests for T/A/S/B/P error-tag normalisation (real source from index.html),
// checked against the DB constraint pattern read from the actual migration file.
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..', '..');
const src = fs.readFileSync(process.argv[2] || path.join(ROOT, 'index.html'), 'utf8');
const sec = src.slice(src.indexOf('//  T/A/S/B/P STROKE-COSTING ERROR TAGS'), src.indexOf('function toggleErrorTag'));
assert.ok(sec.length > 100, 'error-tag section not found');
const { normalizeErrorTags: N, parseErrorTags: P, ERROR_TAG_ORDER } = new Function(sec + 'return { normalizeErrorTags, parseErrorTags, ERROR_TAG_ORDER };')();

// The constraint exactly as the B migration defines it (Postgres `~` is case-sensitive, like JS).
const mig = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261009090000_allow_bunker_error_tag.sql'), 'utf8');
const pattern = mig.match(/error_tags ~ '([^']+)'/)[1];
assert.strictEqual(pattern, '^T?A?S?B?P?$');
const re = new RegExp(pattern);
const dbAccepts = v => v === null || (re.test(v) && v !== '');

let n = 0; const t = (name, fn) => { fn(); n++; console.log('PASS', name); };
t('canonical order is T, A, S, B, P', () => assert.deepStrictEqual(ERROR_TAG_ORDER, ['T', 'A', 'S', 'B', 'P']));
t('no tags → null (never empty string)', () => { for (const v of [[], '', null, undefined]) assert.strictEqual(N(v), null); });
t('single tags: T, B, P', () => { assert.strictEqual(N(['T']), 'T'); assert.strictEqual(N(['B']), 'B'); assert.strictEqual(N(['P']), 'P'); });
t('multiple incl. B: TB, SB, BP, TBP, TASBP', () => {
  assert.strictEqual(N(['B', 'T']), 'TB'); assert.strictEqual(N(['B', 'S']), 'SB'); assert.strictEqual(N(['P', 'B']), 'BP');
  assert.strictEqual(N(['P', 'B', 'T']), 'TBP'); assert.strictEqual(N(['P', 'B', 'S', 'A', 'T']), 'TASBP');
});
t('stable order regardless of tap order', () => { assert.strictEqual(N(['P', 'T']), 'TP'); assert.strictEqual(N(['S', 'A']), 'AS'); assert.strictEqual(N('PBS'), 'SBP'); });
t('duplicates removed (incl. duplicate B)', () => { assert.strictEqual(N(['T', 'T', 'P', 'P', 'T']), 'TP'); assert.strictEqual(N(['B', 'B']), 'B'); assert.strictEqual(N('BBP'), 'BP'); });
t('invalid values dropped: lowercase (b), other letters, words, numbers, objects', () => {
  assert.strictEqual(N(['t', 'b', 'X', 'TA', 'Tee', 1, null, {}, 'P']), 'P');
  assert.strictEqual(N(['x', 'Z', 'b']), null);
  assert.strictEqual(N('TXBP'), 'TBP');
});
t('historical T/A/S/P values parse and re-normalise unchanged', () => {
  for (const v of ['T', 'A', 'S', 'P', 'TA', 'TP', 'AS', 'TAP', 'TASP']) { assert.strictEqual(N(v), v); assert.deepStrictEqual(P(v), v.split('')); }
  assert.deepStrictEqual(P(null), []); assert.deepStrictEqual(P(undefined), []);
});
t('parse: B values → ordered array', () => {
  assert.deepStrictEqual(P('SB'), ['S', 'B']); assert.deepStrictEqual(P('TASBP'), ['T', 'A', 'S', 'B', 'P']);
  assert.deepStrictEqual(P(['P', 'B']), ['B', 'P']); assert.deepStrictEqual(P('BT'), ['T', 'B']);
});
t('DB constraint accepts T, B, P, TB, SB, BP, TASBP, NULL and all historical values', () => {
  for (const v of ['T', 'B', 'P', 'TB', 'SB', 'BP', 'TASBP', null, 'TA', 'TASP', 'AS']) assert.ok(dbAccepts(v), String(v));
});
t('DB constraint rejects "", BT (order), BB, lowercase, unknown letters', () => {
  for (const v of ['', 'BT', 'BB', 'b', 'tb', 'Tb', 'X', 'TX', 'PT', 'TT', 'AT']) assert.ok(!dbAccepts(v), JSON.stringify(v));
});
t('every app output satisfies the DB constraint (all 32 subsets + junk)', () => {
  const subsets = []; for (let m = 0; m < 32; m++) subsets.push(['T', 'A', 'S', 'B', 'P'].filter((_, i) => m & (1 << i)));
  for (const sub of [...subsets, ['Z'], ['t'], ['B', 'B'], 'PBSAT', 'XYZ']) assert.ok(dbAccepts(N(sub)), JSON.stringify(sub));
});
t('no inference: helpers only reflect what was passed in', () => {
  assert.ok(!/fairway|gir|putts|score|bunker_/.test(sec.replace(/\/\/.*$/gm, '')), 'tag helpers never read stats fields');
});
console.log(`\nAll ${n} error-tag tests passed.`);
