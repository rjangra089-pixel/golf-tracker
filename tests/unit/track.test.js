// Offline test for track(): real source from index.html, mocked sb + fetch.
const fs = require('fs');
const assert = require('assert');
const src = fs.readFileSync(process.argv[2] || require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const grab = (re) => { const m = src.match(re); if (!m) throw new Error('not found: ' + re); return m[0]; };
const code = [
  grab(/const SB_PUBLIC_READ_TABLES = [^\n]+/),
  grab(/async function sbFetch\(path, opts = \{\}\) \{[\s\S]*?\n\}/),
  grab(/function track\(event, properties = \{\}\) \{[\s\S]*?\n\}/),
].join('\n');

let session = null, calls = [], currentUser = null;
const ctx = {
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_KEY: 'ANON_KEY',
  sb: { auth: { getSession: async () => ({ data: { session }, error: null }) } },
  // Mimic PostgREST: return=minimal → 201 with empty body
  fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, text: async () => '' }; },
};
const getUser = () => currentUser;
const run = new Function(...Object.keys(ctx), 'getUser',
  code.replace("typeof currentUser !== 'undefined' && currentUser", 'getUser()').replace('currentUser.id', 'getUser().id')
  + '\nreturn { track };');
const { track } = run(...Object.values(ctx), getUser);
const tick = () => new Promise(r => setTimeout(r, 0));

(async () => {
  session = { access_token: 'USER_TOKEN' }; currentUser = { id: 'u1' };
  track('signed_in');
  track('round_started', { course: 'hoebridge-golf-centre', handicap: 27, tee: 'yellow' });
  await tick(); await tick();
  assert.strictEqual(calls.length, 2);
  for (const c of calls) {
    assert.ok(c.url.endsWith('/rest/v1/events'));
    assert.strictEqual(c.init.method, 'POST');
    assert.strictEqual(c.init.headers.Prefer, 'return=minimal');
    assert.strictEqual(c.init.headers.Authorization, 'Bearer USER_TOKEN');
  }
  const b0 = JSON.parse(calls[0].init.body), b1 = JSON.parse(calls[1].init.body);
  assert.deepStrictEqual(b0, { user_id: 'u1', event: 'signed_in', properties: {} });
  assert.deepStrictEqual(b1.properties, { course: 'hoebridge-golf-centre', handicap: 27, tee: 'yellow' });
  console.log('PASS 1  POST /events with Prefer: return=minimal + user token');
  console.log('PASS 2  signed_in body = {user_id, event, properties:{}} — no email');
  console.log('PASS 3  other events keep their properties unchanged');

  // Signed out (e.g. signed_up while email verification pending): no request, no throw
  session = null; currentUser = null; calls = [];
  assert.doesNotThrow(() => track('signed_up'));
  await tick(); await tick();
  assert.strictEqual(calls.length, 0);
  console.log('PASS 4  signed-out track() sends nothing and never throws');

  // Empty 201 body handled (sbFetch returns [] for empty text) — no unhandled rejection
  console.log('\nAll track() tests passed.');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
