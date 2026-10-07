// Offline unit test for sbFetch + offline queue auth behaviour.
// Pulls the real function source out of index.html and runs it against mocks:
// no network, no Supabase, no DB access.
const fs = require('fs');
const assert = require('assert');
const src = fs.readFileSync(process.argv[2] || require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');

const grab = (re) => { const m = src.match(re); if (!m) throw new Error('not found: ' + re); return m[0]; };
const code = [
  grab(/const SB_PUBLIC_READ_TABLES = [^\n]+/),
  grab(/async function sbFetch\(path, opts = \{\}\) \{[\s\S]*?\n\}/),
  grab(/const WRITE_QUEUE_KEY[^\n]+/),
  grab(/function queueWrite\(op\) \{[\s\S]*?\n\}/),
  grab(/async function flushWriteQueue\(\) \{[\s\S]*?\n\}/),
].join('\n');

const ANON = 'ANON_KEY';
let session = null;          // what sb.auth.getSession() returns
let calls = [];              // captured fetch calls
const store = {};
const ctx = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_KEY: ANON,
  sb: { auth: { getSession: async () => ({ data: { session }, error: null }) } },
  fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, text: async () => '[]' }; },
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  },
  showSyncToast: () => {},
  console: { warn: () => {}, log: () => {} },
};
const run = new Function(...Object.keys(ctx), code + '\nreturn { sbFetch, queueWrite, flushWriteQueue };');
const { sbFetch, queueWrite, flushWriteQueue } = run(...Object.values(ctx));
const auth = () => calls.at(-1).init.headers.Authorization;
const apikey = () => calls.at(-1).init.headers.apikey;

(async () => {
  // 1. Signed in: user data uses the user's token, apikey stays anon
  session = { access_token: 'USER_TOKEN_1' };
  await sbFetch('rounds?select=*&user_id=eq.u1');
  assert.strictEqual(auth(), 'Bearer USER_TOKEN_1'); assert.strictEqual(apikey(), ANON);
  await sbFetch('rounds', { method: 'POST', body: '{}' });
  assert.strictEqual(auth(), 'Bearer USER_TOKEN_1');
  console.log('PASS 1  signed-in reads/writes send user token; apikey = anon');

  // 2. Signed in: public course read also uses user token
  await sbFetch('courses?select=id');
  assert.strictEqual(auth(), 'Bearer USER_TOKEN_1');
  console.log('PASS 2  signed-in course read uses user token');

  // 3. Signed out: public course/hole GETs fall back to anon
  session = null; calls = [];
  await sbFetch('courses?select=id&order=name');
  assert.strictEqual(auth(), 'Bearer ' + ANON);
  await sbFetch('holes?select=id&course_id=eq.x');
  assert.strictEqual(auth(), 'Bearer ' + ANON);
  console.log('PASS 3  signed-out courses/holes GET use anon role');

  // 4. Signed out: every user-data request throws and never hits the network
  calls = [];
  const cases = [
    ['rounds?select=*', {}], ['shots?select=*', {}], ['profiles?select=*', {}],
    ['user_preferences?select=*', {}], ['events', { method: 'POST', body: '{}' }],
    ['rounds', { method: 'POST', body: '{}' }], ['shots?round_id=eq.1', { method: 'DELETE', prefer: '' }],
    ['rounds?id=eq.1', { method: 'PATCH', body: '{}' }],
    ['courses', { method: 'POST', body: '{}' }], ['holes?id=eq.1', { method: 'PATCH', body: '{}' }],
  ];
  for (const [p, o] of cases) await assert.rejects(sbFetch(p, o), /Not signed in/);
  assert.strictEqual(calls.length, 0);
  console.log(`PASS 4  signed-out user-data + course/hole WRITES (${cases.length} cases) throw, 0 network calls`);

  // 5. Offline queue: entries contain no token; replay uses the token current at replay time
  session = { access_token: 'OLD_TOKEN' };
  queueWrite({ path: 'shots', method: 'POST', body: '{"a":1}' });
  queueWrite({ path: 'rounds?id=eq.1', method: 'PATCH', body: '{"b":2}' });
  const raw = store[ 'gt_write_queue' ];
  assert.ok(!/TOKEN|Bearer|Authorization/.test(raw), 'queue must not contain tokens');
  session = { access_token: 'REFRESHED_TOKEN' }; calls = [];
  await flushWriteQueue();
  assert.strictEqual(calls.length, 2);
  assert.ok(calls.every(c => c.init.headers.Authorization === 'Bearer REFRESHED_TOKEN'));
  assert.ok(!('gt_write_queue' in store), 'queue cleared after successful flush');
  console.log('PASS 5  queue stores no token; replay uses refreshed token; queue cleared');

  // 6. Offline queue replay while signed out: nothing sent anonymously, ops kept for retry
  queueWrite({ path: 'shots', method: 'POST', body: '{}' });
  session = null; calls = [];
  await flushWriteQueue();
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(JSON.parse(store['gt_write_queue']).length, 1);
  console.log('PASS 6  signed-out replay sends nothing, op retained for later');

  console.log('\nAll sbFetch auth tests passed.');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
