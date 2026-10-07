// Offline tests for T/A/S/P normalisation (real source from index.html).
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(process.argv[2] || require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const sec = src.slice(src.indexOf('//  T/A/S/P STROKE-COSTING ERROR TAGS'), src.indexOf('function toggleErrorTag'));
const { normalizeErrorTags: N, parseErrorTags: P } = new Function(sec + 'return { normalizeErrorTags, parseErrorTags };')();
// The migration's DB constraint, mirrored, to prove every app output is accepted by it.
const dbAccepts = v => v === null || (/^T?A?S?P?$/.test(v) && v !== '');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('PASS', name); };
t('no tags → null (never empty string)', () => { for (const v of [[], '', null, undefined]) assert.strictEqual(N(v), null); });
t('single tags: T only, P only', () => { assert.strictEqual(N(['T']), 'T'); assert.strictEqual(N(['P']), 'P'); });
t('multiple: T + A; all four', () => { assert.strictEqual(N(['T', 'A']), 'TA'); assert.strictEqual(N(['P', 'S', 'A', 'T']), 'TASP'); });
t('stable T-A-S-P order regardless of tap order', () => { assert.strictEqual(N(['P', 'T']), 'TP'); assert.strictEqual(N(['S', 'A']), 'AS'); });
t('duplicates removed', () => assert.strictEqual(N(['T', 'T', 'P', 'P', 'T']), 'TP'));
t('invalid values dropped: lowercase, other letters, words, numbers, objects', () => {
  assert.strictEqual(N(['t', 'X', 'TA', 'Tee', 1, null, {}, 'P']), 'P');
  assert.strictEqual(N(['x', 'Z']), null);
  assert.strictEqual(N('TXP'), 'TP');
});
t('parse: stored string / legacy null / array → ordered array', () => {
  assert.deepStrictEqual(P('TA'), ['T', 'A']); assert.deepStrictEqual(P(null), []); assert.deepStrictEqual(P(undefined), []);
  assert.deepStrictEqual(P(['P', 'T']), ['T', 'P']); assert.deepStrictEqual(P('AT'), ['T', 'A']);
});
t('every app output satisfies the DB check constraint (all 16 subsets + junk)', () => {
  const subsets = []; for (let m = 0; m < 16; m++) subsets.push(['T', 'A', 'S', 'P'].filter((_, i) => m & (1 << i)));
  for (const sub of [...subsets, ['Z'], ['t'], ['T', 'T'], 'SPAT', 'XYZ']) assert.ok(dbAccepts(N(sub)), JSON.stringify(sub));
  assert.ok(!dbAccepts('') && !dbAccepts('AT') && !dbAccepts('TT') && !dbAccepts('X'), 'constraint rejects bad values');
});
t('no inference: helpers only reflect what was passed in', () => {
  assert.ok(!/fairway|gir|putts|score/.test(sec.replace(/\/\/.*$/gm, '')), 'tag helpers never read stats fields');
});
console.log(`\nAll ${n} TASP tests passed.`);
