// Browser regression suite (B1 + safety + B2 Home + T/A/S/P + live score entry) in headless Chrome via CDP.
// ALL Supabase traffic and /api calls are intercepted and answered with fixtures —
// nothing reaches the production database. The supabase-js CDN bundle is replaced
// by a fake client with a fake session.
const assert = require('assert');
const PORT = Number(process.argv[2] || 9333);
const APP = process.env.APP || 'http://localhost:3000/';

// ── fixtures ─────────────────────────────────────────────────────
const PARS = [4,4,3,5,4,4,3,4,5, 4,4,3,5,4,4,3,4,5];
const PARS_B = [3,5,4,4,4,3,4,5,4, 4,3,5,4,4,4,3,5,4];
const holesFor = (cid) => (cid === 'cB' ? PARS_B : PARS).map((par, i) => ({ id: `${cid}-h${i+1}`, course_id: cid, hole_number: i+1, par, stroke_index: i+1, yardage: 350, is_danger_hole: false, verified_tip: null, ai_tip: null, tip_source: null }));
const COURSES = [
  { id: 'cA', name: 'Course A', slug: 'course-a', par: 72, slope_rating: 120, course_rating: 70, tee_options: {} },
  { id: 'cB', name: 'Course <img src=x onerror="window.__xss=1"> B', slug: 'course-b', par: 72, slope_rating: 118, course_rating: 69, tee_options: {} },
];
const shots18 = (rid, base = 5, opts = {}) => PARS.map((p, i) => ({ round_id: rid, hole_number: i+1, score: p + 1, putts: 2, fairway: p === 3 ? null : 'C', gir: false, ...opts }));
const mkRound = (id, date, status, nShots, extra = {}) => ({
  id, user_id: 'u-test', course_id: 'cA', date, created_at: date + 'T12:00:00Z', round_status: status,
  playing_handicap: 25, total_score: 90, total_putts: 36, gir_count: 0, stableford_points: 30, tee_color: 'yellow', current_hole: nShots,
  shots: shots18(id).slice(0, nShots), courses: { name: 'Course A', slug: 'course-a', holes: holesFor('cA') }, ...extra,
});
const state = { offline: false, inProgress: false, writes: [], debriefPrompt: null, hc: 25.0, target: 15, debriefCourseB: false, history: 'rich' };
const homeRounds = () => {
  const rs = [mkRound('r-full1', '2026-10-01', 'completed', 18), mkRound('r-full2', '2026-09-20', 'completed', 18)];
  if (state.inProgress) rs.unshift(mkRound('r-live', '2026-10-06', 'in_progress', 4, { playing_handicap: 30, current_hole: 4 }));
  return rs;
};
// Debrief fixture deliberately unordered and polluted with unsafe rounds:
const courseBRound = (id, date) => ({ ...mkRound(id, date, 'completed', 18), course_id: 'cB',
  shots: PARS_B.map((p, i) => ({ round_id: id, hole_number: i+1, score: p + 1, putts: 2, fairway: p === 3 ? null : 'C', gir: false })),
  courses: { name: 'Course <img src=x onerror="window.__xss=1"> B', slug: 'course-b', holes: holesFor('cB') } });
const debriefRounds = () => [
  ...(state.debriefCourseB ? [courseBRound('r-b-full', '2026-10-02')] : []),
  mkRound('r-full2', '2026-09-20', 'completed', 18),
  mkRound('r-partial', '2026-10-04', 'completed', 9),        // partial but "completed"
  mkRound('r-live', '2026-10-05', 'in_progress', 18),        // in progress
  mkRound('r-full1', '2026-10-01', 'completed', 18),         // ← must be reviewed
];

// Coaching-history fixtures (course A, playing handicap 25: SI 1-7 get 2 shots, SI 8-18 get 1).
const received = i => (i + 1 <= 7 ? 2 : 1);
function coachRound(id, date, { blow = 0, putts3 = 0, ob = 0, puttsGap = false, fwGap = false, partial = false } = {}) {
  const teeHoles = PARS.map((p, i) => (p >= 4 ? i : -1)).filter(i => i >= 0);
  const obHoles = new Set(teeHoles.slice(1, 1 + ob));
  const shots = PARS.map((p, i) => ({
    hole_number: i + 1,
    score: i < blow ? p + received(i) + 2 : p + 1,                   // blow-up = net double bogey or worse
    putts: puttsGap && i === 9 ? null : (i >= 18 - putts3 ? 3 : 2),
    fairway: p === 3 ? null : (fwGap && i === teeHoles[0] ? null : (obHoles.has(i) ? 'X' : 'C')),
  }));
  return { id, date, created_at: date + 'T12:00:00Z', round_status: 'completed', course_id: 'cA', playing_handicap: 25, tee_color: 'yellow',
           shots: partial ? shots.slice(0, 9) : shots, courses: { name: 'Course A', holes: holesFor('cA') } };
}
const day = n => `2026-09-${String(30 - n).padStart(2, '0')}`;       // n = 0 is newest
const HISTORIES = {
  rich: () => [
    coachRound('p0', '2026-10-01', { blow: 9, partial: true }),        // newest but partial → skipped
    ...[[4,3,1],[3,2,1],[3,2,0],[3,3,1],[3,2,1]].map(([b,p,o], i) => coachRound('L' + i, day(i), { blow: b, putts3: p, ob: o })),
    ...Array.from({ length: 7 }, (_, i) => coachRound('P' + i, day(5 + i), { blow: 6, putts3: 2, ob: 1 })),
  ],
  none:  () => [coachRound('x0', day(0), { partial: true })],
  two:   () => [coachRound('a', day(0), { blow: 1 }), coachRound('b', day(1), { blow: 2 }), coachRound('c', day(2), { partial: true })],
  four:  () => Array.from({ length: 4 }, (_, i) => coachRound('f' + i, day(i), { blow: 1, putts3: 1, puttsGap: i < 2, fwGap: true })),
  calm:  () => Array.from({ length: 6 }, (_, i) => coachRound('c' + i, day(i), { blow: 1, putts3: 1, ob: 0 })),
  heavyputt: () => [[4,4,1],[4,4,0],[3,4,0],[4,4,0],[3,4,0]].map(([b,p,o], i) => coachRound('h' + i, day(i), { blow: b, putts3: p, ob: o })),
  threeputt: () => Array.from({ length: 5 }, (_, i) => coachRound('t' + i, day(i), { blow: 1, putts3: [3,2,2,3,2][i] })),
  error: () => { throw new Error('history unavailable'); },
};
const grossOf = r => r.shots.reduce((a, s) => a + s.score, 0);
// Historical round for Coach Review: created before error tagging, legacy Y/N fairways,
// missing putts/GIR on a couple of holes, one stored note.
const reviewRoundFixture = () => ({
  id: 'r-full1', date: '2026-06-12', created_at: '2026-06-12T10:00:00Z', round_status: 'completed', tee_color: null,
  playing_handicap: 27, stableford_points: 28, courses: { name: 'Course A', holes: holesFor('cA') },
  shots: PARS.map((p, i) => ({ hole_number: i + 1, score: p + 1 + (i === 0 ? 3 : 0), putts: i === 2 ? null : 2,
    fairway: p === 3 ? null : (i % 2 ? 'Y' : 'N'), gir: i === 2 ? null : false, error_tags: null, notes: i === 4 ? 'Pulled approach into trees' : null })),
});

function restResponse(method, url) {
  const u = new URL(url); const path = u.pathname.replace('/rest/v1/', ''); const q = decodeURIComponent(u.search);
  if (method !== 'GET') {
    if (path === 'rounds' && method === 'POST') return [{ id: 'new-round' }];
    return [];
  }
  if (false) {
    return [];
  }
  if (path === 'profiles') return [{ id: 'u-test', name: 'Test Golfer', current_handicap: state.hc, target_handicap: state.target }];
  if (path === 'user_preferences') return [{ user_id: 'u-test', name: 'Test Golfer', current_handicap: state.hc, target_handicap: state.target, last_course_slug: null }];
  if (path === 'courses') {
    if (q.includes('slug=eq.')) return COURSES.filter(c => q.includes('slug=eq.' + c.slug));
    if (q.includes('id=eq.')) return COURSES.filter(c => q.includes('id=eq.' + c.id));
    return COURSES.map(({ id, name, slug, par }) => ({ id, name, slug, par }));
  }
  if (path === 'holes') { const m = q.match(/course_id=eq\.(\w+)/); return m ? holesFor(m[1]) : []; }
  if (path === 'shots' && state.resumeB) return shots18('r-live').slice(0, 4).map((x, i) => ({ ...x, error_tags: ['TB', 'B', null, 'SBP'][i] }));
  if (path === 'shots' && state.resumeZeroPutt) return shots18('r-live').slice(0, 4).map((x, i) => i === 1 ? { ...x, putts: 0 } : i === 2 ? { ...x, score: 13 } : x);
  if (path === 'shots') return shots18('r-live').slice(0, 4).map((x, i) =>
    i === 0 ? { ...x, error_tags: 'TA' } : i === 1 ? { ...x, error_tags: null } : i === 3 ? { ...x, error_tags: 'P' } : x);   // hole 3: legacy row, no field
  if (path === 'rounds') {
    if (/[?&]id=eq\./.test(q) && q.includes('courses(name,holes(')) return [reviewRoundFixture()];   // Coach Review (history); not user_id=eq.
    if (q.includes('or=(round_status.is.null,round_status.neq.in_progress)')) return HISTORIES[state.history]();   // Phase A home history
    if (q.includes('holes(hole_number,par,stroke_index)')) return debriefRounds();
    return homeRounds();
  }
  return [];
}

const FAKE_SUPABASE_JS = `
window.__session = { access_token: 'TEST_TOKEN', user: { id: 'u-test', user_metadata: { name: 'Test Golfer' } } };
window.supabase = { createClient: () => ({ auth: {
  getSession: async () => ({ data: { session: window.__session }, error: null }),
  signOut: async () => { window.__signedOut = true; window.__session = null; return { error: null }; },
  signInWithPassword: async () => ({ data: {}, error: { message: 'test' } }),
  signUp: async () => ({ data: {}, error: null }),
  resetPasswordForEmail: async () => ({ error: null }),
} }) };`;
const DEBRIEF_JSON = JSON.stringify({ headline: 'H', verdict: 'V', nines: { front: { comment: '' }, back: { comment: '' } }, putting: 'P', gir: 'G', holeSpotlights: [], momentum: 'M', focusTip: 'F', closing: 'C' });

// ── CDP plumbing ─────────────────────────────────────────────────
let ws, msgId = 0; const pending = new Map(); const errors = []; const warns = [];
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n  in: ' + expr);
  return r.result.value;
}
async function waitFor(expr, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch {} await sleep(100); }
  throw new Error('timeout waiting for: ' + expr);
}
const activeScreen = () => ev(`document.querySelector('.screen.active')?.id`);
const activeNavIn = (screen) => ev(`[...document.querySelectorAll('#${screen} .bnav-btn.active')].map(b=>b.dataset.nav).join(',')`);

async function onMessage(raw) {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
    (m.params.type === 'error' ? errors : warns).push(m.params.args.map(a => a.value ?? a.description).join(' '));
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params; const url = request.url;
    const fulfill = (status, body, type = 'application/json') => send('Fetch.fulfillRequest', { requestId, responseCode: status,
      responseHeaders: [{ name: 'Content-Type', value: type },
        { name: 'Access-Control-Allow-Origin', value: new URL(APP).origin },
        { name: 'Access-Control-Allow-Methods', value: 'GET, POST, PATCH, DELETE, OPTIONS' },
        { name: 'Access-Control-Allow-Headers', value: 'apikey, authorization, content-type, prefer, x-client-info' },
        { name: 'Vary', value: 'Origin' }],
      body: Buffer.from(body).toString('base64') }).catch(() => {});
    if (url.includes('cdn.jsdelivr.net/npm/@supabase/supabase-js')) return fulfill(200, FAKE_SUPABASE_JS, 'application/javascript');
    if (url.includes('.supabase.co/')) {
      if (request.method === 'OPTIONS') return fulfill(204, '');
      if (state.offline && request.method !== 'GET') { state.offlineBlocked = (state.offlineBlocked || 0) + 1;
        return send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' }).catch(() => {}); }
      if (request.method !== 'GET') {
        state.writes.push({ method: request.method, url: decodeURIComponent(url), body: request.postData || null, auth: request.headers.Authorization });
        if (request.method === 'PATCH' && /\/(profiles|user_preferences)\?/.test(url)) {   // mock persistence
          const b = JSON.parse(request.postData || '{}');
          if ('current_handicap' in b) state.hc = b.current_handicap;
          if ('target_handicap' in b) state.target = b.target_handicap;
        }
      }
      if (url.includes('/rest/v1/events')) return fulfill(201, '');
      let payload; try { payload = restResponse(request.method, url); } catch (e) { return fulfill(500, JSON.stringify({ message: e.message })); }
      return fulfill(200, JSON.stringify(payload));
    }
    if (url.includes('/api/ai-debrief')) { state.debriefPrompt = JSON.parse(request.postData).prompt; return fulfill(200, JSON.stringify({ content: [{ text: DEBRIEF_JSON }] })); }
    if (url.includes('/api/')) return fulfill(500, '{"error":"blocked in test"}');
    return send('Fetch.continueRequest', { requestId }).catch(() => {});
  }
}

let passed = 0; const failed = [];
const t = async (name, fn) => {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;   // smoke-test subset
  try { await fn(); passed++; console.log('PASS', name); }
  catch (e) { failed.push(name); console.log('FAIL', name, '—', e.message.split('\n')[0]); }
};

(async () => {
  const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(tgt.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => onMessage(e.data));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*supabase*' }, { urlPattern: '*/api/*' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  // Fresh state for every run: clear this test profile's storage for the app origin.
  await send('Storage.clearDataForOrigin', { origin: new URL(APP).origin, storageTypes: 'local_storage,session_storage,cache_storage' });
  await send('Page.navigate', { url: APP });
  await waitFor(`document.querySelector('.screen.active')?.id === 'screen-home' && document.getElementById('home-hi').textContent !== '—'`);
  const wrapStats = () => ev(`(() => { if (window.__statsWrapped) return; const orig = loadStats; window.__statsBusy = 0;
      loadStats = async (...a) => { window.__statsBusy++; try { return await orig(...a); } finally { window.__statsBusy--; } }; window.__statsWrapped = true; })()`);
  const statsIdle = () => waitFor(`window.__statsBusy === 0`);
  await wrapStats();

  await t('Home loads (signed in via fake session), shows Official HI 25.0 and target 15 read-only', async () => {
    assert.strictEqual(await ev(`document.getElementById('home-hi').textContent`), '25.0');
    assert.strictEqual(await ev(`document.getElementById('home-target').textContent`), '15.0');
    assert.strictEqual(await ev(`!!document.querySelector('#screen-home input, #screen-home .signout-btn, #screen-home #btn-review-round')`), false);
    assert.strictEqual(await activeNavIn('screen-home'), 'screen-home');
  });

  await t('Bottom nav is Home · Stats · Play · Profile on every screen that has one', async () => {
    const labels = await ev(`[...document.querySelectorAll('.bottom-nav')].map(n=>[...n.querySelectorAll('.bnav-btn')].map(b=>b.textContent.trim()).join(' · '))`);
    assert.deepStrictEqual(labels, ['Home · Stats · Play · Profile', 'Home · Stats · Play · Profile', 'Home · Stats · Play · Profile']);
  });

  await t('Profile opens from navigation and is highlighted; fields prefilled from officialHI', async () => {
    await ev(`document.querySelector('#screen-home .bnav-btn[data-nav="screen-profile"]').click()`);
    assert.strictEqual(await activeScreen(), 'screen-profile');
    assert.strictEqual(await activeNavIn('screen-profile'), 'screen-profile');
    assert.strictEqual(await ev(`document.getElementById('profile-name').textContent`), 'Test Golfer');
    assert.strictEqual(await ev(`document.getElementById('profile-hc').value`), '25.0');
    assert.strictEqual(await ev(`document.getElementById('profile-target-hc').value`), '15');
    if (process.env.SHOTS) {
      const fs = require('fs'); const shot = async (f) => fs.writeFileSync(f, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      await sleep(500); await shot(process.env.SHOTS + '/profile-light.png');
      await ev(`setTheme('dark')`); await sleep(400); await shot(process.env.SHOTS + '/profile-dark.png');
      await ev(`setTheme('light'); showScreen('screen-home')`); await sleep(400); await shot(process.env.SHOTS + '/home-b1.png');
      await ev(`showScreen('screen-profile')`);
    }
  });

  await t('Home / Stats / Play / Profile navigation + highlighting; Stats still loads', async () => {
    const click = (screen, to) => ev(`document.querySelector('#${screen} .bnav-btn[data-nav="${to}"]').click()`);
    await click('screen-profile', 'screen-stats');
    assert.strictEqual(await activeScreen(), 'screen-stats'); assert.strictEqual(await activeNavIn('screen-stats'), 'screen-stats');
    await statsIdle(); assert.strictEqual(await ev(`!!document.querySelector('#stats-scroll .loading-overlay')`), false);
    await click('screen-stats', 'screen-setup');
    assert.strictEqual(await activeScreen(), 'screen-setup');
    await ev(`document.querySelector('.btn-back-setup').click()`);              // setup has no bottom nav (unchanged)
    assert.strictEqual(await activeScreen(), 'screen-home'); assert.strictEqual(await activeNavIn('screen-home'), 'screen-home');
    await click('screen-home', 'screen-stats');
    assert.strictEqual(await activeScreen(), 'screen-stats'); await statsIdle();
    await click('screen-stats', 'screen-home');
    assert.strictEqual(await activeScreen(), 'screen-home');
    await click('screen-home', 'screen-profile');
    assert.strictEqual(await activeScreen(), 'screen-profile'); assert.strictEqual(await activeNavIn('screen-profile'), 'screen-profile');
  });

  await t('Current HC save → PATCH user_preferences + profiles (user token), setup-hc + Home update', async () => {
    state.writes.length = 0;
    await ev(`document.getElementById('profile-hc').value='24.3'; saveCurrentHC()`);
    await waitFor(`document.getElementById('profile-hc-status').textContent === 'Saved'`);
    const w = state.writes.map(x => `${x.method} ${x.url.split('/rest/v1/')[1]} ${x.body}`);
    assert.deepStrictEqual(w, ['PATCH user_preferences?user_id=eq.u-test {"current_handicap":24.3}', 'PATCH profiles?id=eq.u-test {"current_handicap":24.3}']);
    assert.ok(state.writes.every(x => x.auth === 'Bearer TEST_TOKEN'));
    assert.strictEqual(await ev(`document.getElementById('setup-hc').value`), '24.3');
    assert.strictEqual(await ev(`document.getElementById('home-hi').textContent`), '24.3');
    assert.strictEqual(await ev(`officialHI`), 24.3);
  });

  await t('Invalid handicap (60, empty) rejected with message, nothing written', async () => {
    state.writes.length = 0;
    await ev(`document.getElementById('profile-hc').value='60'; saveCurrentHC()`);
    assert.match(await ev(`document.getElementById('profile-hc-status').textContent`), /between 0 and 54/);
    await ev(`document.getElementById('profile-hc').value=''; saveCurrentHC()`);
    assert.strictEqual(state.writes.length, 0); assert.strictEqual(await ev(`officialHI`), 24.3);
  });

  await t('Target save → PATCH both tables, Home target updates', async () => {
    state.writes.length = 0;
    await ev(`document.getElementById('profile-target-hc').value='14'; saveTargetHC()`);
    await waitFor(`document.getElementById('profile-target-status').textContent === 'Saved'`);
    assert.deepStrictEqual(state.writes.map(x => x.body), ['{"target_handicap":14}', '{"target_handicap":14}']);
    assert.strictEqual(await ev(`document.getElementById('home-target').textContent`), '14.0');
  });

  await t('Theme: Dark/Light toggle, aria-pressed, persists across reload', async () => {
    await ev(`setTheme('dark')`);
    assert.strictEqual(await ev(`document.body.classList.contains('dark-mode') && localStorage.getItem('theme')`), 'dark');
    assert.strictEqual(await ev(`document.getElementById('profile-theme-dark').getAttribute('aria-pressed')`), 'true');
    await send('Page.reload'); await waitFor(`document.querySelector('.screen.active')?.id === 'screen-home' && document.getElementById('home-hi').textContent !== '—'`);
    await wrapStats();
    assert.strictEqual(await ev(`officialHI`), 24.3, 'saved HI persisted across reload');
    assert.strictEqual(await ev(`document.getElementById('home-target').textContent`), '14.0');
    assert.strictEqual(await ev(`document.body.classList.contains('dark-mode')`), true);
    assert.strictEqual(await ev(`document.getElementById('profile-theme-dark').getAttribute('aria-pressed')`), 'true');
    await ev(`setTheme('light')`);
    assert.strictEqual(await ev(`document.body.classList.contains('dark-mode') || localStorage.getItem('theme')`), 'light');
    assert.strictEqual(await ev(`document.getElementById('profile-theme-light').getAttribute('aria-pressed')`), 'true');
  });

  await t('Course switching: setup tag + Home course updated via textContent, no cache fallback, no XSS', async () => {
    const before = warns.length;
    await ev(`document.getElementById('setup-course-select').value='course-b'; onCourseChange()`);
    await waitFor(`document.getElementById('setup-course-tag').textContent.includes('Course <img')`);
    assert.strictEqual(await ev(`document.getElementById('home-start-course').textContent`), 'Course <img src=x onerror="window.__xss=1"> B');
    assert.strictEqual(await ev(`!!document.querySelector('#home-start-course img')`), false);
    assert.strictEqual(await ev(`!!document.querySelector('#setup-course-tag img')`), false);
    await sleep(300);
    assert.strictEqual(await ev(`window.__xss === 1`), false, 'no markup executed anywhere');
    assert.ok(!warns.slice(before).some(w => /Switch course|Restored course from cache/.test(w)), 'no switchCourse failure');
    await ev(`document.getElementById('setup-course-select').value='course-a'; onCourseChange()`);
    await waitFor(`document.getElementById('setup-course-tag').textContent === 'Course A'`);
  });

  await t('Starting a round (setup HC 27) does not change Profile/Home HI; mid-round Profile save keeps playingHC', async () => {
    await ev(`showScreen('screen-setup'); document.getElementById('setup-hc').value='27'`);
    await ev(`startRound()`);
    await waitFor(`activeRoundId === 'new-round'`); await statsIdle();
    assert.strictEqual(await activeScreen(), 'screen-play');
    assert.strictEqual(await ev(`playingHC`), 27);
    assert.strictEqual(await ev(`officialHI`), 24.3);
    assert.strictEqual(await ev(`document.getElementById('home-hi').textContent`), '24.3');
    await ev(`showScreen('screen-profile')`);
    assert.strictEqual(await ev(`document.getElementById('profile-hc').value`), '24.3');
    await ev(`document.getElementById('profile-hc').value='24.0'; saveCurrentHC()`);
    await waitFor(`document.getElementById('profile-hc-status').textContent === 'Saved'`);
    assert.strictEqual(await ev(`playingHC`), 27, 'in-round handicap untouched');
    assert.strictEqual(await ev(`officialHI`), 24);
    // play screen still works: score a hole, points + total shots render
    await ev(`showScreen('screen-play'); renderHole(0); selectScore(5)`);
    assert.strictEqual(await ev(`document.getElementById('tb-shots').textContent`), '5');
    await ev(`cancelRound()`); await waitFor(`activeRoundId === null && document.querySelector('.screen.active').id === 'screen-home'`);
  });

  await t('Resuming an in-progress round (round HC 30) does not change Profile/Home HI', async () => {
    state.inProgress = true;
    await ev(`loadHomeData()`);
    await waitFor(`!!window._inProgressRound`);
    await ev(`resumeRound()`);
    await waitFor(`document.querySelector('.screen.active').id === 'screen-play'`);
    assert.strictEqual(await ev(`playingHC`), 30);
    assert.strictEqual(await ev(`officialHI`), 24);
    await ev(`showScreen('screen-profile')`);
    assert.strictEqual(await ev(`document.getElementById('profile-hc').value`), '24.0');
    assert.strictEqual(await ev(`document.getElementById('home-hi').textContent`), '24.0');
    state.inProgress = false;
    await ev(`cancelRound()`); await waitFor(`document.querySelector('.screen.active').id === 'screen-home'`);
  });

  await t('Debrief from Stats reviews newest COMPLETE round (skips in-progress + partial), back returns to Stats', async () => {
    await ev(`showScreen('screen-stats')`); await statsIdle();
    assert.strictEqual(await ev(`!!document.querySelector('#screen-stats #btn-review-round')`), true);
    state.debriefPrompt = null;
    await ev(`document.getElementById('btn-review-round').click()`);
    await waitFor(`document.querySelector('#assess-scroll .assess-hero')`);
    assert.match(state.debriefPrompt, /- Date: 2026-10-01\n/);
    assert.ok(!/2026-10-05|2026-10-04/.test(state.debriefPrompt.split('HOLE-BY-HOLE')[0]), 'unsafe rounds not reviewed');
    await ev(`document.querySelector('.assess-topbar-back').click()`);
    assert.strictEqual(await activeScreen(), 'screen-stats'); await statsIdle();
  });

  await t('Course dropdown: HTML-looking / special-character names render as literal text', async () => {
    const opts = await ev(`[...document.getElementById('setup-course-select').options].map(o => [o.value, o.textContent, o.children.length])`);
    assert.deepStrictEqual(opts, [['course-a', 'Course A · Par 72', 0], ['course-b', 'Course <img src=x onerror="window.__xss=1"> B · Par 72', 0]]);
    assert.strictEqual(await ev(`document.querySelectorAll('#setup-course-select img').length`), 0);
    assert.strictEqual(await ev(`document.getElementById('setup-course-select').value`), 'course-a', 'selected course preserved');
    assert.strictEqual(await ev(`window.__xss === 1`), false);
  });

  await t('Normal course switching still works after the dropdown change (A → B → A, cache written)', async () => {
    await ev(`document.getElementById('setup-course-select').value='course-b'; onCourseChange()`);
    await waitFor(`courseId === 'cB' && HOLES.length === 18 && HOLES[0].par === 3`);
    assert.strictEqual(await ev(`selectedCourseSlug`), 'course-b');
    assert.strictEqual(await ev(`localStorage.getItem('lastCourseSlug')`), 'course-b');
    assert.strictEqual(await ev(`!!JSON.parse(localStorage.getItem('gt_course_cache'))['course-b']`), true);
    await ev(`document.getElementById('setup-course-select').value='course-a'; onCourseChange()`);
    await waitFor(`courseId === 'cA' && HOLES[0].par === 4`);
    assert.strictEqual(await ev(`document.getElementById('setup-course-tag').textContent`), 'Course A');
  });

  await t('Historical debrief (Course B) cannot mutate an ACTIVE round at Course A', async () => {
    const snap = () => ev(`JSON.stringify({ selectedCourseSlug, courseId, HOLES, holeIds, selectedTee, currentHole, activeRoundId,
        playingHC, holeData, stored: localStorage.getItem('gt_active_round_state') && JSON.parse(localStorage.getItem('gt_active_round_state')) })`);
    // 1. active round at Course A, two holes played
    await ev(`showScreen('screen-setup'); document.getElementById('setup-course-select').value='course-a'; document.getElementById('setup-hc').value='25'`);
    await ev(`startRound()`); await waitFor(`activeRoundId === 'new-round'`); await statsIdle();
    await ev(`selectScore(5); nextHole()`); await ev(`selectScore(4)`);
    await sleep(800);   // let nextHole()'s fire-and-forget autoSaveHole finish (it re-saves local state)
    const before = await snap();
    const b = JSON.parse(before);
    assert.strictEqual(b.selectedCourseSlug, 'course-a'); assert.strictEqual(b.courseId, 'cA'); assert.strictEqual(b.HOLES[0].par, 4);
    // 2. open a debrief whose newest complete round is at Course B
    state.debriefCourseB = true; state.debriefPrompt = null;
    await ev(`showScreen('screen-stats')`); await statsIdle();
    await ev(`document.getElementById('btn-review-round').click()`);
    await waitFor(`document.querySelector('#assess-scroll .assess-hero')`);
    assert.match(state.debriefPrompt, /- Date: 2026-10-02\n/);
    assert.match(state.debriefPrompt, /Hole 1 \(Par 3 SI 1\)/, 'debrief used Course B hole data');
    assert.match(state.debriefPrompt, /They just played Course <img/, 'debrief named Course B');
    // 3. close the debrief
    await ev(`document.querySelector('.assess-topbar-back').click()`);
    assert.strictEqual(await activeScreen(), 'screen-stats'); await statsIdle();
    // 4. every active-round course/hole/global value unchanged
    const after = await snap();
    if (after !== before) {
      const A = JSON.parse(before), B = JSON.parse(after);
      const diff = (a, b, path = '') => (typeof a === 'object' && a && b && typeof b === 'object')
        ? [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(k => diff(a[k], b[k], path + '.' + k))
        : (JSON.stringify(a) === JSON.stringify(b) ? [] : [`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`]);
      console.log('      DIFF:', diff(A, B));
    }
    assert.strictEqual(after, before, 'active-round state unchanged by debrief');
    // 5. scoring still uses Course A
    await ev(`showScreen('screen-play'); renderHole(currentHole); selectScore(6)`);
    assert.strictEqual(await ev(`document.getElementById('tb-par').textContent`), '4', 'hole 2 is Course A par 4');
    // Course A hole 2: par 4, SI 2; hc 25 receives 2 shots → gross 6 = net 4 = 2 pts.
    // (Course B hole 2 is a par 5, which would give 3 pts.)
    assert.strictEqual(await ev(`calcPoints(1, 6)`), 2, 'scoring uses Course A');
    await ev(`cancelRound()`); await waitFor(`activeRoundId === null && document.querySelector('.screen.active').id === 'screen-home'`);
    state.debriefCourseB = false;
  });

  // ═════════════════════════ B2: coaching Home ═════════════════════════
  const T = id => ev(`document.getElementById('${id}').textContent`);
  const shown = id => ev(`(() => { const e = document.getElementById('${id}'); return !!e && !e.hidden && e.offsetParent !== null; })()`);
  const reloadHome = async (history, hc = 25, target = 15) => {
    state.history = history; state.hc = hc; state.target = target;
    await ev(`showScreen('screen-home'); loadHomeData()`); await sleep(400);
  };

  await t('B2 Home: header (Golf Tracker + Profile button), no greeting / sign out / progress bar / stats strip / round list', async () => {
    await reloadHome('rich');
    assert.strictEqual(await ev(`document.querySelector('#screen-home .home-title').textContent`), 'Golf Tracker');
    assert.strictEqual(await ev(`document.querySelector('#screen-home .home-profile-btn').getAttribute('aria-label')`), 'Profile');
    const text = await ev(`document.querySelector('#screen-home .home-scroll').innerText`);
    for (const gone of ['Welcome back', 'Sign out', 'shots to go', 'Avg Pts', 'Best Pts', 'Recent Rounds', 'rounds logged', 'Play a Round'])
      assert.ok(!text.includes(gone), 'old Home text still present: ' + gone);
    assert.strictEqual(await ev(`!!document.querySelector('#screen-home .hc-bar-fill, #screen-home .stats-strip, #screen-home .rounds-list, #screen-home input')`), false);
    await ev(`document.querySelector('#screen-home .home-profile-btn').click()`);
    assert.strictEqual(await activeScreen(), 'screen-profile');
    await ev(`showScreen('screen-home')`);
  });

  await t('B2 Road to 15: officialHI/targetHC copy, no playingHC', async () => {
    assert.strictEqual(await T('home-road-title'), 'Road to 15');
    assert.strictEqual(await T('home-hi'), '25.0'); assert.strictEqual(await T('home-target'), '15.0');
    assert.strictEqual(await T('home-gap'), '10.0 to go · target Dec 2026');
    assert.strictEqual(await T('home-hi-note'), 'Official Handicap Index');
    await ev(`playingHC = 31; renderHome()`);
    assert.strictEqual(await T('home-hi'), '25.0', 'playingHC never shown');
  });

  await t('B2 Recent form (rich: 12 complete + newest partial skipped): newest-first gross, average, direction', async () => {
    const hist = HISTORIES.rich().slice(1);                 // drop the partial
    const last5 = hist.slice(0, 5).map(grossOf), prev5 = hist.slice(5, 10).map(grossOf);
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    assert.strictEqual(await T('home-form-scores'), last5.join(' · '));
    assert.strictEqual(await T('home-form-avg'), avg(last5).toFixed(1));
    assert.strictEqual(await T('home-form-meta'), '· last 5 rounds');
    assert.ok(await shown('home-form-direction'));
    const expected = avg(prev5) - avg(last5) >= 2 ? 'improving' : avg(prev5) - avg(last5) <= -2 ? 'slipping' : 'steady';
    assert.strictEqual(await T('home-form-direction-val'), expected);
    assert.match(await T('home-form-direction'), /^Form vs previous 5 rounds: (improving|steady|slipping)$/);
  });

  await t('B2 Scoring leaks (rich): 3.2 / 2.4 / 0.8, sub, footnote', async () => {
    assert.strictEqual(await T('home-leaks-sub'), 'Per round · last 5');
    assert.deepStrictEqual([await T('leak-blowUps-val'), await T('leak-threePutts-val'), await T('leak-teeShotsOB-val')], ['3.2', '2.4', '0.8']);
    assert.strictEqual(await ev(`document.querySelectorAll('#home-leaks .leak-row.is-muted').length`), 0);
    assert.match(await ev(`document.getElementById('home-leaks').innerText`), /From your scorecards\. A leak is not always a mistake\./);
  });

  await t('B2 Focus (rich → blow-ups 3.2): headline, evidence, principle, ONE target, commitment, routine', async () => {
    assert.strictEqual(await T('home-focus-headline'), 'Stop the blow-up hole.');
    assert.strictEqual(await T('home-focus-evidence'), "You're averaging 3.2 zero-point holes per round.");
    assert.ok(await shown('home-focus-principle')); assert.strictEqual(await T('home-focus-principle'), "One mistake doesn't get a friend.");
    assert.strictEqual(await T('home-next-target-text'), 'Maximum 2 blow-up holes');
    assert.strictEqual(await ev(`document.querySelectorAll('#home-focus .home-target').length`), 1);
    assert.strictEqual(await ev(`document.querySelector('#home-focus .home-commitment-title').textContent`), 'No hero recovery shots');
    assert.strictEqual(await ev(`document.querySelector('#home-focus .home-commitment-sub').textContent`), 'Your call on the course. Not scored.');
    assert.strictEqual(await ev(`document.querySelector('#home-focus .home-routine').textContent`), 'PICK → SEE → GO');
    assert.ok(!(await shown('home-empty')) && !(await shown('home-unlock')) && !(await shown('home-load-error')));
  });

  await t('B2 heavy 3-putting (3.6 blow-ups, 4.0 three-putts): three-putt focus, "Maximum 2 three-putts"', async () => {
    await reloadHome('heavyputt');
    assert.deepStrictEqual([await T('leak-blowUps-val'), await T('leak-threePutts-val')], ['3.6', '4.0']);
    assert.strictEqual(await T('home-focus-headline'), 'Cut the three-putts.');
    assert.strictEqual(await T('home-focus-evidence'), "You're averaging 4.0 three-putts per round.");
    assert.strictEqual(await shown('home-focus-principle'), false);
    assert.strictEqual(await T('home-next-target-text'), 'Maximum 2 three-putts');
    assert.strictEqual(await ev(`document.querySelector('#home-focus .home-commitment-title').textContent`), 'No hero recovery shots');
    assert.strictEqual(await ev(`document.querySelector('#home-focus .home-routine').textContent`), 'PICK → SEE → GO');
    assert.ok(!/3\.0|hierarch|priority|weight/i.test(await ev(`document.getElementById('home-focus').innerText`)), 'rule not exposed');
  });

  await t('B2 3-putt focus: copy, no principle, "Maximum 1 three-putt"', async () => {
    await reloadHome('threeputt');
    assert.strictEqual(await T('home-focus-headline'), 'Cut the three-putts.');
    assert.strictEqual(await T('home-focus-evidence'), "You're averaging 2.4 three-putts per round.");
    assert.strictEqual(await shown('home-focus-principle'), false);
    assert.strictEqual(await T('home-next-target-text'), 'Maximum 1 three-putt');
  });

  await t('B2 consistency focus: copy, no tracked target, commitment still shown', async () => {
    await reloadHome('calm');
    assert.strictEqual(await T('home-focus-headline'), 'Keep building consistency.');
    assert.strictEqual(await T('home-focus-evidence'), 'No single scoring leak is dominating your recent rounds.');
    assert.strictEqual(await shown('home-next-target'), false);
    assert.ok(await ev(`!!document.querySelector('#home-focus .home-commitment').offsetParent`));
  });

  await t('B2 3–4 rounds + missing data: "last 4", muted Not enough data rows with reasons, no direction', async () => {
    await reloadHome('four');
    assert.strictEqual(await T('home-leaks-sub'), 'Per round · last 4');
    assert.strictEqual(await T('home-form-meta'), '· last 4 rounds');
    assert.strictEqual(await shown('home-form-direction'), false);
    assert.strictEqual(await T('leak-blowUps-val'), '1.0');
    assert.strictEqual(await T('leak-threePutts-val'), 'Not enough data');
    assert.strictEqual(await T('leak-threePutts-note'), 'Putts recorded on all 18 holes in 2 of 4 rounds');
    assert.strictEqual(await T('leak-teeShotsOB-val'), 'Not enough data');
    assert.strictEqual(await T('leak-teeShotsOB-note'), 'Tee shots recorded on every par 4 and 5 in 0 of 4 rounds');
    assert.strictEqual(await ev(`document.querySelectorAll('#home-leaks .leak-row.is-muted').length`), 2);
    assert.strictEqual(await T('home-focus-headline'), 'Keep building consistency.');
  });

  await t('B2 1–2 rounds: form + unlock message, leaks/focus hidden', async () => {
    await reloadHome('two');
    assert.ok(await shown('home-form'));
    assert.strictEqual(await T('home-form-scores'), HISTORIES.two().slice(0, 2).map(grossOf).join(' · '));
    assert.strictEqual(await T('home-unlock-text'), 'Play 1 more full round to see your scoring leaks.');
    assert.strictEqual(await shown('home-leaks'), false); assert.strictEqual(await shown('home-focus'), false);
  });

  await t('B2 0 complete rounds: Road + new-user message + Start Round only', async () => {
    await reloadHome('none');
    assert.strictEqual(await T('home-empty-text'), 'Play 3 full rounds and your coaching starts here.');
    for (const id of ['home-form', 'home-unlock', 'home-leaks', 'home-focus']) assert.strictEqual(await shown(id), false, id);
    assert.ok(await shown('home-road'));
    assert.ok(await ev(`!!document.querySelector('#screen-home .home-start-btn').offsetParent`));
  });

  await t('B2 target reached (HI 14.8 vs 15) — no negative gap', async () => {
    await reloadHome('rich', 14.8, 15);
    assert.strictEqual(await T('home-gap'), 'Target reached');
    await reloadHome('rich', 25, 15);
  });

  await t('B2 history fetch failure: keeps last good model; with no model shows quiet error, Road still works', async () => {
    await reloadHome('error');
    assert.strictEqual(await T('home-focus-headline'), 'Stop the blow-up hole.', 'last good model kept');
    assert.strictEqual(await shown('home-load-error'), false);
    await ev(`homeModel = null`); await reloadHome('error');
    assert.ok(await shown('home-load-error')); assert.strictEqual(await T('home-gap'), '10.0 to go · target Dec 2026');
    errors.splice(0, errors.length, ...errors.filter(e => !/history unavailable/.test(e)));   // expected warn path only
    await reloadHome('rich');
  });

  await t('B2 Start Round: button + Change open setup; course/tee line follows selections', async () => {
    assert.strictEqual(await T('home-start-course'), 'Course A'); assert.strictEqual(await T('home-start-tee'), 'Yellow tees');
    await ev(`document.querySelector('#screen-home .home-start-btn').click()`); assert.strictEqual(await activeScreen(), 'screen-setup');
    await ev(`selectTee('white'); document.querySelector('.btn-back-setup').click()`);
    assert.strictEqual(await T('home-start-tee'), 'White tees');
    await ev(`document.querySelector('#screen-home .home-link-btn').click()`); assert.strictEqual(await activeScreen(), 'screen-setup');
    await ev(`selectTee('yellow'); showScreen('screen-home')`);
    assert.strictEqual(await T('home-start-tee'), 'Yellow tees');
  });

  await t('B2 play screen intact: pace badge after 3 holes, halfway banner at hole 10, autosave writes shots', async () => {
    state.writes.length = 0;
    await ev(`showScreen('screen-setup'); document.getElementById('setup-hc').value='25'`);
    await ev(`startRound()`); await waitFor(`activeRoundId === 'new-round'`); await statsIdle();
    // Measure settled layout: finish the screen's entry fade/slide (headless Chrome advances it irregularly).
    const cardTop = () => ev(`(document.getAnimations().forEach(a => a.finish()), document.querySelector('#screen-play .scoring-card').getBoundingClientRect().top)`);
    const tops = [], statuses = [];
    for (let h = 0; h < 9; h++) { await ev(`selectScore(5); nextHole()`); tops.push(await cardTop()); statuses.push(await ev(`document.getElementById('play-status').className + '|' + document.getElementById('play-status').textContent`)); }
    await sleep(500);
    assert.strictEqual(await ev(`currentHole`), 9);
    assert.match(statuses[2], /(pace-(ahead|on|behind)\|. (On pace|Avg pace|Pace))|(momentum-\w+\|\S)/, 'pace (or momentum replacing it) after 3 holes: ' + statuses[2]);
    assert.ok(statuses.slice(2, 8).every(x => /\|\S/.test(x)), 'status line populated from hole 4: ' + statuses);
    assert.match(statuses[8], /^play-status halfway\|Halfway · Front 9: \d+ pts/, 'halfway replaces status: ' + statuses[8]);
    assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(statuses.join(' ')), 'no emoji in status');
    assert.strictEqual(new Set(tops).size, 1, 'status/momentum/halfway never move the entry area: ' + tops);
    assert.strictEqual(await ev(`!!document.querySelector('#screen-play .momentum-badge, #screen-play .milestone-banner, #screen-play #hole-feedback')`), false);
    assert.ok(state.writes.filter(w => w.method === 'POST' && /\/rest\/v1\/shots$/.test(w.url)).length >= 9, 'autosave posted shots');
    await ev(`cancelRound()`); await waitFor(`activeRoundId === null && document.querySelector('.screen.active').id === 'screen-home'`);
  });

  await t('B2 phone widths 375 / 390 / 414 / 430: no horizontal scroll, nothing past the right edge (light + dark)', async () => {
    await reloadHome('rich');
    for (const theme of ['light', 'dark']) {
      await ev(`setTheme('${theme}')`);
      for (const width of [375, 390, 414, 430]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(250);
        const r = await ev(`(() => { const sc = document.querySelector('#screen-home .home-scroll');
          const over = [...document.querySelectorAll('#screen-home *')].filter(el => el.offsetParent !== null && el.getBoundingClientRect().right > innerWidth + 0.5).map(el => el.id || el.className);
          return { doc: document.documentElement.scrollWidth <= innerWidth, inner: sc.scrollWidth <= sc.clientWidth, over }; })()`);
        assert.ok(r.doc && r.inner && r.over.length === 0, `${theme} ${width}px overflow: ${JSON.stringify(r)}`);
      }
    }
    if (process.env.SHOTS) {
      const fs = require('fs');
      for (const theme of ['light', 'dark']) {
        await ev(`setTheme('${theme}')`);
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1900, deviceScaleFactor: 2, mobile: true }); await sleep(600);
        fs.writeFileSync(`${process.env.SHOTS}/home-b2-${theme}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      }
      await reloadHome('none');
      await ev(`setTheme('light')`); await sleep(500);
      fs.writeFileSync(`${process.env.SHOTS}/home-b2-new-user.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 390, height: 844, scale: 1 } })).data, 'base64'));
      await reloadHome('four'); await sleep(400);
      fs.writeFileSync(`${process.env.SHOTS}/home-b2-four.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    await ev(`setTheme('light')`);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await reloadHome('rich');
  });

  // ═════════════════════════ T/A/S/P error tags ═════════════════════════
  const pressed = () => ev(`[...document.querySelectorAll('.tasp-btn')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.tag).join('')`);
  const tap = tag => ev(`document.querySelector('.tasp-btn[data-tag="${tag}"]').click()`);
  const shotPosts = () => state.writes.filter(w => w.method === 'POST' && /\/rest\/v1\/shots$/.test(w.url)).map(w => JSON.parse(w.body));
  const lastShotFor = hole => shotPosts().flat().filter(b => b.hole_number === hole).at(-1);

  await t('TASP: row shows "Stroke-costing error?" + T A S P, none selected by default', async () => {
    await reloadHome('rich');
    state.writes.length = 0;
    await ev(`showScreen('screen-setup'); document.getElementById('setup-course-select').value='course-a'; onCourseChange(); document.getElementById('setup-hc').value='25'`);
    await waitFor(`courseId === 'cA'`);
    await ev(`startRound()`); await waitFor(`activeRoundId === 'new-round'`); await statsIdle();
    assert.strictEqual(await ev(`document.getElementById('tasp-label').textContent`), 'Stroke-costing error?');
    assert.strictEqual(await ev(`[...document.querySelectorAll('.tasp-btn')].map(b => b.textContent).join(' ')`), 'T A S B P');
    assert.strictEqual(await ev(`document.querySelector('#fairway-group .section-label').textContent`), 'Fairway');
    assert.strictEqual(await ev(`[...document.querySelectorAll('#fairway-group .toggle-btn')].map(b => b.textContent).join(' ')`), '✓ Left Right OB');
    assert.strictEqual(await pressed(), '');
    assert.ok(await ev(`[...document.querySelectorAll('.tasp-btn')].every(b => b.getBoundingClientRect().height >= 44)`), 'tap targets ≥ 44px');
  });

  await t('TASP: never inferred — fairway OB, GIR miss, 3-putt, big score → no tags, saves null', async () => {
    await ev(`selectScore(8); selectFairway('X'); selectGIR(false); selectPutts(3)`);
    assert.strictEqual(await pressed(), '');
    assert.deepStrictEqual(await ev(`holeData[0].tags`), []);
    await ev(`nextHole()`); await sleep(400);
    assert.strictEqual(lastShotFor(1).error_tags, null);
    assert.strictEqual(lastShotFor(1).fairway, 'X'); assert.strictEqual(lastShotFor(1).putts, 3); assert.strictEqual(lastShotFor(1).gir, false);
  });

  await t('TASP: T only / P only / T+A / all four / toggled off — autosaved per hole in T-A-S-P order', async () => {
    const plan = [['T'], ['P'], ['A', 'T'], ['P', 'S', 'A', 'T'], ['S', 'S']];   // hole 2..6 (last: on then off)
    for (const taps of plan) { await ev(`selectScore(5)`); for (const x of taps) await tap(x); await ev(`nextHole()`); await sleep(300); }
    assert.deepStrictEqual([2, 3, 4, 5, 6].map(h => lastShotFor(h).error_tags), ['T', 'P', 'TA', 'TASP', null]);
    assert.deepStrictEqual(await ev(`holeData.slice(1, 6).map(h => h.tags.join(''))`), ['T', 'P', 'TA', 'TASP', '']);
  });

  await t('TASP: next then previous hole preserves tags on screen', async () => {
    assert.strictEqual(await ev(`currentHole`), 6);
    await ev(`prevHole()`); assert.strictEqual(await pressed(), '');          // hole 6: toggled off
    await ev(`prevHole()`); assert.strictEqual(await pressed(), 'TASP');      // hole 5
    if (process.env.SHOTS) { await ev(`document.getElementById('screen-play').scrollTo(0, 99999)`); await sleep(400);
      require('fs').writeFileSync(process.env.SHOTS + '/play-tasp.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      await ev(`document.getElementById('screen-play').scrollTo(0, 0)`); }
    await ev(`prevHole()`); assert.strictEqual(await pressed(), 'TA');        // hole 4
    await ev(`nextHole()`); await ev(`nextHole()`); await ev(`nextHole()`); await sleep(300);
    assert.strictEqual(await ev(`currentHole`), 6); assert.strictEqual(await pressed(), '');
  });

  await t('TASP: invalid tags cannot be persisted (toggle ignores bad tags; stored value sanitised)', async () => {
    await ev(`toggleErrorTag('X'); toggleErrorTag('t'); toggleErrorTag('TA')`);
    assert.deepStrictEqual(await ev(`holeData[6].tags`), []);
    await ev(`holeData[6].tags = ['Z', 'P', 'T', 'T', 'p']; selectScore(6); nextHole()`); await sleep(400);
    assert.strictEqual(lastShotFor(7).error_tags, 'TP');
  });

  await t('TASP: offline queue stores tags (no token) and replays them on reconnect', async () => {
    state.offline = true; state.offlineBlocked = 0;
    await ev(`selectScore(5)`); await tap('S'); await ev(`nextHole()`);
    await waitFor(`(JSON.parse(localStorage.getItem('gt_write_queue') || '[]')).length >= 3`);
    const q = await ev(`localStorage.getItem('gt_write_queue')`);
    assert.ok(state.offlineBlocked >= 1, 'write was blocked as offline');
    const queuedShots = JSON.parse(q).filter(op => op.method === 'POST' && op.path === 'shots').map(op => JSON.parse(op.body));
    assert.ok(queuedShots.some(b => b.hole_number === 8 && b.error_tags === 'S'), 'queued body carries the tag: ' + JSON.stringify(queuedShots));
    assert.ok(!/TEST_TOKEN|Bearer|Authorization|access_token/.test(q), 'no auth token in the queue');
    state.offline = false; const before = shotPosts().length;
    await ev(`window.dispatchEvent(new Event('online'))`);
    await waitFor(`!localStorage.getItem('gt_write_queue')`);
    const replayed = state.writes.filter(w => w.method === 'POST' && /\/rest\/v1\/shots$/.test(w.url)).slice(before);
    assert.ok(replayed.some(w => JSON.parse(w.body).hole_number === 8 && JSON.parse(w.body).error_tags === 'S'), 'replayed with tag');
    assert.ok(replayed.every(w => w.auth === 'Bearer TEST_TOKEN'), 'replay uses the current token');
  });

  await t('TASP: page reload (phone lock / app kill) restores the round with its tags', async () => {
    await ev(`selectScore(4)`); await tap('A'); await tap('P');                  // hole 9, not yet autosaved
    await send('Page.reload');
    await waitFor(`document.querySelector('.screen.active')?.id === 'screen-play' && activeRoundId === 'new-round'`);
    await wrapStats(); await statsIdle();
    console.log('      after reload: currentHole', await ev(`currentHole`), 'pressed', await pressed(), 'tags', await ev(`JSON.stringify(holeData.slice(0, 10).map(h => (h.tags || []).join('')))`));
    assert.strictEqual(await ev(`currentHole`), 8);
    assert.strictEqual(await pressed(), 'AP');
    assert.deepStrictEqual(await ev(`holeData.slice(0, 9).map(h => parseErrorTags(h.tags).join(''))`), ['', 'T', 'P', 'TA', 'TASP', '', 'TP', 'S', 'AP']);
    await ev(`renderHole(6)`); assert.strictEqual(await pressed(), 'TP', 'injected junk never shown'); await ev(`renderHole(8)`);
  });

  await t('TASP: final save + summary — per-hole tags only where present, totals, saved array keeps tags', async () => {
    await ev(`nextHole()`); await sleep(300);
    for (let h = 9; h < 17; h++) { await ev(`selectScore(5); nextHole()`); await sleep(120); }
    await ev(`selectScore(5)`); await tap('T'); await ev(`nextHole()`);           // hole 18 → summary
    await waitFor(`document.querySelector('.screen.active').id === 'screen-summary'`);
    const rows = await ev(`[...document.querySelectorAll('#hole-summary-list .hole-summary-row')].map(r => [r.querySelector('.hs-num').textContent, r.querySelector('.hs-tags')?.textContent || ''])`);
    const tagged = Object.fromEntries(rows.filter(r => r[1]));
    assert.deepStrictEqual(tagged, { 2: '· T', 3: '· P', 4: '· T · A', 5: '· T · A · S · P', 7: '· T · P', 8: '· S', 9: '· A · P', 18: '· T' });
    assert.strictEqual(rows.filter(r => !r[1]).length, 10, 'untagged holes have no tag element');
    assert.strictEqual(await ev(`document.getElementById('sum-tasp').hidden`), false);
    assert.strictEqual(await ev(`[...document.querySelectorAll('#sum-tasp span')].map(s => s.textContent).join(' ')`), 'T5 A3 S2 B0 P4');
    state.writes.length = 0;
    await ev(`saveRound()`); await waitFor(`document.getElementById('btn-save').textContent === 'SAVED ✓'`);
    const saved = shotPosts().flat();
    assert.strictEqual(saved.length, 18);
    assert.deepStrictEqual(saved.filter(b => b.error_tags).map(b => [b.hole_number, b.error_tags]),
      [[2, 'T'], [3, 'P'], [4, 'TA'], [5, 'TASP'], [7, 'TP'], [8, 'S'], [9, 'AP'], [18, 'T']]);
    assert.ok(saved.every(b => b.error_tags === null || /^T?A?S?P?$/.test(b.error_tags) && b.error_tags !== ''), 'all values pass the DB constraint');
    await ev(`goHome()`);
  });

  await t('TASP: summary with no tags hides the totals line', async () => {
    await ev(`holeData = holeData.map(h => ({ ...h, tags: [] })); showSummary()`);
    assert.strictEqual(await ev(`document.getElementById('sum-tasp').hidden`), true);
    assert.strictEqual(await ev(`document.querySelectorAll('#hole-summary-list .hs-tags').length`), 0);
    await ev(`activeRoundId = null; clearRoundStateFromStorage(); goHome()`);
  });

  await t('TASP: resume from database — stored tags restored; null and legacy rows (no field) load with none', async () => {
    state.inProgress = true;
    await ev(`loadHomeData()`); await waitFor(`!!window._inProgressRound`);
    await ev(`resumeRound()`); await waitFor(`document.querySelector('.screen.active').id === 'screen-play'`);
    assert.deepStrictEqual(await ev(`holeData.slice(0, 4).map(h => h.tags.join(''))`), ['TA', '', '', 'P']);
    await ev(`renderHole(0)`); assert.strictEqual(await pressed(), 'TA');
    await ev(`renderHole(2)`); assert.strictEqual(await pressed(), '');
    state.inProgress = false;
    await ev(`cancelRound()`); await waitFor(`document.querySelector('.screen.active').id === 'screen-home'`);
  });

  // ═════════════════════════ Live score entry redesign ═════════════════════════
  const scoreSel = () => ev(`[...document.querySelectorAll('#score-grid .score-cell.selected')].map(b => b.textContent).join(',')`);
  const puttSel = () => ev(`[...document.querySelectorAll('.putt-btn.selected')].map(b => b.textContent).join(',')`);
  const vis = id => ev(`(() => { const e = document.getElementById('${id}'); return !!e && !e.hidden && e.offsetParent !== null; })()`);
  const startTestRound = async () => {
    await ev(`showScreen('screen-setup'); document.getElementById('setup-course-select').value='course-a'; onCourseChange(); document.getElementById('setup-hc').value='25'`);
    await waitFor(`courseId === 'cA'`);
    await ev(`startRound()`); await waitFor(`activeRoundId === 'new-round'`); await statsIdle();
  };

  await t('LIVE: compact header "H1 · Par 4 · 350y · SI 1 · +2", tally line, Cancel, no hole card / points box / recap', async () => {
    await reloadHome('rich'); state.writes.length = 0;
    await startTestRound();
    assert.strictEqual(await ev(`document.querySelector('.play-hole-line').textContent.replace(/\\s+/g, ' ').trim()`), 'H1 · Par 4 · 350y · SI 1 · +2');
    assert.strictEqual(await ev(`document.querySelector('.play-tally').textContent`), '0 shots · 0 pts');
    assert.strictEqual(await ev(`document.querySelector('.play-cancel').textContent`), 'Cancel');
    assert.strictEqual(await ev(`!!document.querySelector('#hole-info-card, #points-result, #hole-feedback, #tb-hole-pts')`), false);
  });

  await t('LIVE: score grid is fixed 1–9 + 10+ on every hole, par marked (dashed), labels not on buttons', async () => {
    const grid = () => ev(`[...document.querySelectorAll('#score-grid .score-cell')].map(b => b.textContent).join(' ')`);
    const par = () => ev(`[...document.querySelectorAll('#score-grid .is-par')].map(b => b.textContent).join(',')`);
    assert.strictEqual(await grid(), '1 2 3 4 5 6 7 8 9 10+'); assert.strictEqual(await par(), '4');
    await ev(`renderHole(2)`); assert.strictEqual(await grid(), '1 2 3 4 5 6 7 8 9 10+'); assert.strictEqual(await par(), '3');   // par 3
    await ev(`renderHole(3)`); assert.strictEqual(await par(), '5');                                                            // par 5
    await ev(`renderHole(0)`);
  });

  await t('LIVE: scores 1–9 select, inline result "6 · Double · 0 pts" uses existing Stableford', async () => {
    for (let n = 1; n <= 9; n++) { await ev(`document.querySelector('#score-grid [data-score="${n}"]').click()`); assert.strictEqual(await scoreSel(), String(n)); assert.strictEqual(await ev(`holeData[0].score`), n); }
    // hole 1: par 4, SI 1, hc 25 → 2 shots: 6 = net 4 = 2 pts; 8 = net 6 = 0 pts
    await ev(`selectScore(6)`); assert.strictEqual(await ev(`document.getElementById('score-result').textContent`), '6 · Double · 2 pts');
    await ev(`selectScore(8)`); assert.strictEqual(await ev(`document.getElementById('score-result').textContent`), '8 · +4 · 0 pts');
    assert.strictEqual(await ev(`calcPoints(0, 8)`), 0);
    assert.strictEqual(await vis('score-stepper'), false);
  });

  await t('LIVE: 10+ selects 10, reveals stepper; 11, 15, 20 (capped); back 10 → 9 returns to grid', async () => {
    await ev(`document.getElementById('score-10plus').click()`);
    assert.strictEqual(await ev(`holeData[0].score`), 10); assert.ok(await vis('score-stepper'));
    assert.strictEqual(await ev(`document.getElementById('score-10plus').textContent`), '10'); assert.strictEqual(await scoreSel(), '10');
    await ev(`stepScore(1)`); assert.strictEqual(await ev(`holeData[0].score`), 11);
    for (let i = 0; i < 4; i++) await ev(`stepScore(1)`);
    assert.strictEqual(await ev(`holeData[0].score`), 15); assert.strictEqual(await ev(`document.getElementById('score-stepper-val').textContent`), '15');
    assert.strictEqual(await ev(`document.getElementById('score-result').textContent`), '15 · +11 · 0 pts');
    for (let i = 0; i < 9; i++) await ev(`stepScore(1)`);
    assert.strictEqual(await ev(`holeData[0].score`), 20, 'max 20'); assert.strictEqual(await ev(`document.getElementById('score-stepper-plus').disabled`), true);
    await ev(`selectScore(10); stepScore(-1)`);
    assert.strictEqual(await ev(`holeData[0].score`), 9); assert.strictEqual(await vis('score-stepper'), false);
    assert.strictEqual(await scoreSel(), '9'); assert.strictEqual(await ev(`document.getElementById('score-10plus').textContent`), '10+');
    assert.strictEqual(await ev(`document.querySelector('.play-tally').textContent`), '9 shots · 0 pts');
  });

  await t('LIVE: putts 0 1 2 3 + 4+ stepper (4, 5, 6, 9; min 4, max 9), exact values kept', async () => {
    assert.strictEqual(await ev(`[...document.querySelectorAll('.putt-btn')].map(b => b.textContent).join(' ')`), '0 1 2 3 4+');
    for (const n of [0, 1, 2, 3]) { await ev(`document.querySelector('.putt-btn[data-putts="${n}"]').click()`); assert.strictEqual(await ev(`holeData[0].putts`), n); assert.strictEqual(await puttSel(), String(n)); }
    await ev(`document.getElementById('putts-4plus').click()`);
    assert.strictEqual(await ev(`holeData[0].putts`), 4); assert.ok(await vis('putts-stepper')); assert.strictEqual(await ev(`document.getElementById('putts-stepper-minus').disabled`), true);
    await ev(`stepPutts(1)`); assert.strictEqual(await ev(`holeData[0].putts`), 5);
    await ev(`stepPutts(1)`); assert.strictEqual(await ev(`holeData[0].putts`), 6); assert.strictEqual(await puttSel(), '6');
    for (let i = 0; i < 6; i++) await ev(`stepPutts(1)`);
    assert.strictEqual(await ev(`holeData[0].putts`), 9, 'max 9'); assert.strictEqual(await ev(`document.getElementById('putts-stepper-plus').disabled`), true);
    for (let i = 0; i < 9; i++) await ev(`stepPutts(-1)`);
    assert.strictEqual(await ev(`holeData[0].putts`), 4, 'min 4 (never collapses below)');
    await ev(`selectPutts(0)`); assert.strictEqual(await vis('putts-stepper'), false); assert.strictEqual(await puttSel(), '0');
  });

  await t('LIVE: exact gross 15 + putts 6 autosaved; 0 putts autosaved as 0 (not null)', async () => {
    state.writes.length = 0;
    await ev(`selectScore(15); selectPutts(6); nextHole()`); await sleep(400);
    assert.deepStrictEqual([lastShotFor(1).score, lastShotFor(1).putts], [15, 6]);
    await ev(`selectScore(4); selectPutts(0); nextHole()`); await sleep(400);
    assert.deepStrictEqual([lastShotFor(2).score, lastShotFor(2).putts], [4, 0]);
    assert.strictEqual(await ev(`currentHole`), 2);
  });

  await t('LIVE: par 3 hides Tee completely; GIR full width and still records', async () => {
    assert.strictEqual(await ev(`HOLES[currentHole].par`), 3);
    assert.strictEqual(await vis('fairway-group'), false);
    assert.ok(await ev(`document.getElementById('tee-gir-row').classList.contains('is-par3')`));
    // GIR must fill the row's whole content box (row width minus its own horizontal padding)
    const w = await ev(`(() => { const row = document.getElementById('tee-gir-row'), cs = getComputedStyle(row);
      return [document.getElementById('gir-group').getBoundingClientRect().width, row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)]; })()`);
    assert.ok(Math.abs(w[0] - w[1]) <= 1, 'GIR spans the row content width: ' + w);
    await ev(`document.querySelectorAll('#gir-group .toggle-btn')[1].click()`);
    assert.strictEqual(await ev(`holeData[2].gir`), false);
    await ev(`renderHole(1)`); assert.strictEqual(await vis('fairway-group'), true); await ev(`renderHole(2)`);
  });

  await t('LIVE: Caddie briefing collapsed on every new hole; opening shows existing content; resets on next hole', async () => {
    assert.ok(await ev(`document.getElementById('caddie-briefing').classList.contains('collapsed')`));
    assert.strictEqual(await ev(`document.getElementById('cb-toggle').getAttribute('aria-expanded')`), 'false');
    assert.strictEqual(await vis('cb-strategy'), false);
    await ev(`document.getElementById('cb-toggle').click()`);
    assert.strictEqual(await ev(`document.getElementById('cb-toggle').getAttribute('aria-expanded')`), 'true');
    assert.ok(await vis('cb-strategy')); assert.ok(await vis('cb-avg')); assert.ok(await vis('cb-target')); assert.ok(await vis('cb-putts'));
    await ev(`selectScore(3); nextHole()`); await sleep(300);
    assert.ok(await ev(`document.getElementById('caddie-briefing').classList.contains('collapsed')`), 'collapsed again on the next hole');
    await ev(`prevHole()`); assert.ok(await ev(`document.getElementById('caddie-briefing').classList.contains('collapsed')`));
    await ev(`nextHole()`); await sleep(300);
  });

  await t('LIVE: no last-hole recap after Next; momentum/halfway stay in the one-line status', async () => {
    assert.strictEqual(await ev(`typeof showHoleFeedback`), 'undefined');
    assert.strictEqual(await ev(`!!document.getElementById('hole-feedback')`), false);
    assert.ok(await ev(`document.getElementById('play-status').getBoundingClientRect().height <= 20`));
  });

  await t('LIVE: entry controls fit WITHOUT scrolling (briefing collapsed): 390×844 and 375×667, light + dark', async () => {
    const res = {};
    for (const [w, h] of [[390, 844], [375, 667]]) for (const theme of ['light', 'dark']) {
      await ev(`setTheme('${theme}')`);
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true }); await sleep(300);
      for (const holeIdx of [3, 2]) {                 // par 5 (Tee shown) and par 3
        await ev(`renderHole(${holeIdx})`); await sleep(150);
        const r = await ev(`(() => {
          const sc = document.getElementById('screen-play'); sc.scrollTo(0, 0);
          const navTop = document.querySelector('#screen-play .nav-bar').getBoundingClientRect().top;
          const ids = ['score-grid', 'putts-4plus', 'gir-group', 'fairway-group', 'tasp-label'];
          const els = [...document.querySelectorAll('#score-grid .score-cell, .putt-btn, #gir-group .toggle-btn, #fairway-group .toggle-btn, .tasp-btn')].filter(e => e.offsetParent !== null);
          const lowest = Math.max(...els.map(e => e.getBoundingClientRect().bottom));
          const navBottom = document.querySelector('#screen-play .nav-bar').getBoundingClientRect().bottom;
          return { lowest: Math.round(lowest), navTop: Math.round(navTop), navPinned: Math.abs(navBottom - innerHeight) <= 1, spare: Math.round(navTop - lowest),
                   fits: lowest <= navTop + 0.5 && Math.abs(navBottom - innerHeight) <= 1,
                   hscroll: document.documentElement.scrollWidth > innerWidth || sc.scrollWidth > sc.clientWidth,
                   minTap: Math.min(...els.map(e => e.getBoundingClientRect().height)) };
        })()`);
        res[`${w}x${h} ${theme} par${holeIdx === 3 ? 5 : 3}`] = r;
        assert.ok(r.fits, `${w}x${h} ${theme}: lowest control ${r.lowest} vs nav top ${r.navTop}`);
        assert.ok(!r.hscroll, `${w}x${h} horizontal scroll`);
        assert.ok(r.minTap >= 44, `tap target ${r.minTap}`);
      }
      if (process.env.SHOTS && theme === 'light') {
        await ev(`renderHole(3); selectScore(6); selectPutts(2); selectFairway('L'); selectGIR(false); toggleErrorTag('T')`); await sleep(300);
        require('fs').writeFileSync(`${process.env.SHOTS}/play-${w}x${h}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        await ev(`toggleErrorTag('T')`);
      }
      if (process.env.SHOTS && theme === 'dark' && w === 390) {
        await ev(`renderHole(3)`); await sleep(300);
        require('fs').writeFileSync(`${process.env.SHOTS}/play-390x844-dark.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      }
    }
    if (process.env.SHOTS) {   // state screenshots: steppers, multiple T/A/S/P, par 3 + briefing open (light + dark)
      for (const theme of ['light', 'dark']) {
        await ev(`setTheme('${theme}')`);
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await ev(`renderHole(3); selectScore(12); selectPutts(5); holeData[3].tags = []; toggleErrorTag('T'); toggleErrorTag('A'); toggleErrorTag('P')`); await sleep(400);
        require('fs').writeFileSync(`${process.env.SHOTS}/play-steppers-tasp-${theme}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        await ev(`renderHole(2); toggleBriefing()`); await sleep(500);
        require('fs').writeFileSync(`${process.env.SHOTS}/play-par3-briefing-${theme}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        await ev(`holeData[3].tags = []; selectScore(5); renderHole(3)`);
      }
    }
    console.log('      layout:', JSON.stringify(res));
    await ev(`setTheme('light')`);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  });

  await t('LIVE: reload restores exact gross 15 / putts 6 / putts 0; final save + summary show them ("0 putts")', async () => {
    await ev(`renderHole(4); selectScore(12); selectPutts(0); toggleErrorTag('S')`);   // unsaved, local only
    await send('Page.reload');
    await waitFor(`document.querySelector('.screen.active')?.id === 'screen-play' && activeRoundId === 'new-round'`);
    await wrapStats(); await statsIdle();
    assert.deepStrictEqual(await ev(`[holeData[0].score, holeData[0].putts, holeData[1].score, holeData[1].putts, holeData[4].score, holeData[4].putts, holeData[4].tags.join('')]`), [15, 6, 4, 0, 12, 0, 'S']);
    await ev(`renderHole(4)`); assert.strictEqual(await ev(`document.getElementById('score-10plus').textContent`), '12'); assert.strictEqual(await puttSel(), '0');
    for (let i = 5; i < 18; i++) { await ev(`renderHole(${i}); selectScore(5); selectPutts(2)`); }
    await ev(`renderHole(16)`); assert.strictEqual(await ev(`document.getElementById('btn-next').textContent`), 'Next hole');
    await ev(`renderHole(17)`); assert.strictEqual(await ev(`document.getElementById('btn-next').textContent`), 'Finish round');
    await ev(`nextHole()`); await waitFor(`document.querySelector('.screen.active').id === 'screen-summary'`);
    const rows = await ev(`[...document.querySelectorAll('#hole-summary-list .hole-summary-row')].map(r => r.querySelector('.hs-num').textContent + '|' + r.children[2].textContent + '|' + r.querySelector('.hs-score').textContent)`);
    assert.strictEqual(rows[0], '1|6 putts|15'); assert.strictEqual(rows[1], '2|0 putts|4'); assert.strictEqual(rows[4], '5|0 putts|12');
    state.writes.length = 0;
    await ev(`saveRound()`); await waitFor(`document.getElementById('btn-save').textContent === 'SAVED ✓'`);
    const saved = shotPosts().flat();
    assert.deepStrictEqual(saved.filter(b => [1, 2, 5].includes(b.hole_number)).map(b => [b.hole_number, b.score, b.putts, b.error_tags]), [[1, 15, 6, null], [2, 4, 0, null], [5, 12, 0, 'S']]);
    await ev(`activeRoundId = null; clearRoundStateFromStorage(); goHome()`);
  });

  await t('LIVE: resume from DB keeps 0 putts (?? null fix) and exact gross above 9', async () => {
    state.inProgress = true; state.resumeZeroPutt = true;
    await ev(`loadHomeData()`); await waitFor(`!!window._inProgressRound`);
    await ev(`resumeRound()`); await waitFor(`document.querySelector('.screen.active').id === 'screen-play'`);
    assert.deepStrictEqual(await ev(`[holeData[1].putts, holeData[2].score]`), [0, 13]);
    await ev(`renderHole(1)`); assert.strictEqual(await puttSel(), '0');
    await ev(`renderHole(2)`); assert.strictEqual(await ev(`document.getElementById('score-10plus').textContent`), '13');
    state.inProgress = false; state.resumeZeroPutt = false;
    await ev(`cancelRound()`); await waitFor(`document.querySelector('.screen.active').id === 'screen-home'`);
  });

  // ═════════════════════════ T/A/S/B/P + Coach Review ═════════════════════════
  await t('TASBP: B selectable alone/with others, autosaved in T-A-S-B-P order; offline queue + replay keep B', async () => {
    await reloadHome('rich'); state.writes.length = 0;
    await startTestRound();
    await ev(`selectScore(5)`); await tap('B'); assert.strictEqual(await pressed(), 'B'); await ev(`nextHole()`); await sleep(300);
    await ev(`selectScore(6)`); await tap('B'); await tap('S'); assert.strictEqual(await pressed(), 'SB'); await ev(`nextHole()`); await sleep(300);
    await ev(`selectScore(4)`); await tap('P'); await tap('B'); await tap('T'); await tap('B'); await tap('B');   // B on, off, on
    assert.strictEqual(await pressed(), 'TBP');
    state.offline = true; await ev(`nextHole()`);
    await waitFor(`(JSON.parse(localStorage.getItem('gt_write_queue') || '[]')).length >= 3`);
    const q = JSON.parse(await ev(`localStorage.getItem('gt_write_queue')`)).filter(op => op.method === 'POST' && op.path === 'shots').map(op => JSON.parse(op.body));
    assert.ok(q.some(b => b.hole_number === 3 && b.error_tags === 'TBP'), 'queued with B');
    state.offline = false; await ev(`window.dispatchEvent(new Event('online'))`); await waitFor(`!localStorage.getItem('gt_write_queue')`);
    assert.deepStrictEqual([1, 2, 3].map(h => lastShotFor(h).error_tags), ['B', 'SB', 'TBP']);
  });

  await t('TASBP: reload restores B; final save + summary show B and the B total', async () => {
    await ev(`selectScore(5)`); await tap('A'); await tap('B');               // hole 4, unsaved
    await send('Page.reload');
    await waitFor(`document.querySelector('.screen.active')?.id === 'screen-play' && activeRoundId === 'new-round'`); await wrapStats(); await statsIdle();
    assert.strictEqual(await pressed(), 'AB');
    assert.deepStrictEqual(await ev(`holeData.slice(0, 4).map(h => parseErrorTags(h.tags).join(''))`), ['B', 'SB', 'TBP', 'AB']);
    for (let i = 4; i < 18; i++) await ev(`renderHole(${i}); selectScore(${i === 10 ? 11 : 5}); selectPutts(${i === 6 ? 0 : 2})`);
    await ev(`renderHole(17); nextHole()`); await waitFor(`document.querySelector('.screen.active').id === 'screen-summary'`);
    const rows = await ev(`Object.fromEntries([...document.querySelectorAll('#hole-summary-list .hole-summary-row')].map(r => [r.querySelector('.hs-num').textContent, r.querySelector('.hs-tags')?.textContent || '']).filter(x => x[1]))`);
    assert.deepStrictEqual(rows, { 1: '· B', 2: '· S · B', 3: '· T · B · P', 4: '· A · B' });
    assert.strictEqual(await ev(`[...document.querySelectorAll('#sum-tasp span')].map(s => s.textContent).join(' ')`), 'T1 A1 S1 B4 P1');
    state.writes.length = 0;
    await ev(`saveRound()`); await waitFor(`document.getElementById('btn-save').textContent === 'SAVED ✓'`);
    assert.deepStrictEqual(shotPosts().flat().filter(b => b.error_tags).map(b => [b.hole_number, b.error_tags]), [[1, 'B'], [2, 'SB'], [3, 'TBP'], [4, 'AB']]);
  });

  await t('COACH REVIEW: summary toggle — review of the round just played (B totals, 11, 0 putts), back to summary unchanged', async () => {
    assert.strictEqual(await ev(`document.getElementById('sum-view-summary').getAttribute('aria-pressed')`), 'true');
    assert.strictEqual(await shown('summary-main'), true); assert.strictEqual(await shown('summary-review'), false);
    await ev(`document.getElementById('sum-view-review').click()`);
    assert.strictEqual(await shown('summary-review'), true); assert.strictEqual(await shown('summary-main'), false);
    const totals = await ev(`Object.fromEntries([...document.querySelectorAll('#summary-review .cr-total')].map(r => [r.querySelector('dt').textContent, r.querySelector('dd').textContent]))`);
    assert.strictEqual(totals.Errors, 'T 1 | A 1 | S 1 | B 4 | P 1');
    assert.strictEqual(totals.Penalties, 'not captured');
    assert.ok(/^\d+$/.test(totals.Score) && totals.Front && totals.Back, JSON.stringify(totals));
    const nines = await ev(`[...document.querySelectorAll('#summary-review .cr-nine-title')].map(e => e.textContent.split(' · ')[0])`);
    assert.deepStrictEqual(nines, ['Front 9', 'Back 9']);
    assert.strictEqual(await ev(`document.querySelectorAll('#summary-review .cr-table tbody tr').length`), 18);
    assert.strictEqual(await ev(`[...document.querySelectorAll('#summary-review .cr-table tbody tr')][2].children[3].textContent`), 'N/A', 'par-3 fairway N/A');
    assert.strictEqual(await ev(`[...document.querySelectorAll('#summary-review .cr-table tbody tr')][0].children[3].textContent`), '—', 'unrecorded fairway shown as unknown');
    const h11 = await ev(`[...document.querySelectorAll('#summary-review .cr-table tbody tr')][10].querySelector('.cr-score').textContent`);
    assert.strictEqual(h11, '11');
    await ev(`document.getElementById('sum-view-summary').click()`);
    assert.strictEqual(await shown('summary-main'), true); assert.strictEqual(await shown('summary-review'), false);
  });

  await t('COACH REVIEW: Copy Round Data — success copies the exact formatted text; failure shows a selectable fallback', async () => {
    await ev(`document.getElementById('sum-view-review').click()`);
    await ev(`window.__copied = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__copied = t; return Promise.resolve(); } } })`);
    await ev(`document.querySelector('#summary-review .cr-copy-btn').click()`); await sleep(200);
    assert.strictEqual(await ev(`document.querySelector('#summary-review .cr-copy-status').textContent`), 'Round data copied');
    assert.strictEqual(await ev(`window.__copied === crFormatRoundText(liveRoundReview())`), true);
    assert.ok((await ev(`window.__copied`)).startsWith('Round: Course A – Yellow tees\nDate: '));
    assert.ok((await ev(`window.__copied`)).includes('H1 | Par 4 | Score 5 | FW — | GIR — | Putts — | Errors B'), 'only what was entered');
    await ev(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } })`);
    await ev(`document.querySelector('#summary-review .cr-copy-btn').click()`); await sleep(200);
    assert.match(await ev(`document.querySelector('#summary-review .cr-copy-status').textContent`), /Couldn't copy/);
    assert.strictEqual(await ev(`(() => { const f = document.querySelector('#summary-review .cr-copy-fallback'); return !f.hidden && f.value === crFormatRoundText(liveRoundReview()); })()`), true);
  });

  await t('COACH REVIEW: readable at 390×844 and 375×667, light + dark — no horizontal scroll, nothing clipped', async () => {
    for (const theme of ['light', 'dark']) {
      await ev(`setTheme('${theme}')`);
      for (const [w, h] of [[390, 844], [375, 667]]) {
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true }); await sleep(250);
        const r = await ev(`(() => { const sc = document.querySelector('#screen-summary .summary-scroll');
          const over = [...document.querySelectorAll('#summary-review *')].filter(e => e.offsetParent !== null && e.getBoundingClientRect().right > innerWidth + 0.5).map(e => e.className || e.tagName);
          const clipped = [...document.querySelectorAll('#summary-review td, #summary-review dd')].filter(e => e.scrollWidth > e.clientWidth + 1 && !e.classList.contains('cr-tags')).length;
          return { hs: document.documentElement.scrollWidth > innerWidth || sc.scrollWidth > sc.clientWidth, over, clipped,
                   minFont: Math.min(...[...document.querySelectorAll('#summary-review td, #summary-review dt, #summary-review dd')].map(e => parseFloat(getComputedStyle(e).fontSize))) }; })()`);
        assert.ok(!r.hs && r.over.length === 0 && r.clipped === 0, `${theme} ${w}x${h}: ${JSON.stringify(r)}`);
        assert.ok(r.minFont >= 13, 'table text ≥ 13px');
        if (process.env.SHOTS) {
          await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1900, deviceScaleFactor: 2, mobile: true }); await sleep(400);
          require('fs').writeFileSync(`${process.env.SHOTS}/coach-review-${w}-${theme}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        }
      }
    }
    await ev(`setTheme('light')`);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await ev(`activeRoundId = null; clearRoundStateFromStorage(); goHome()`);
  });

  await t('COACH REVIEW: Stats history — Review only on finished rounds; historical round shows unknowns honestly', async () => {
    state.inProgress = true; await reloadHome('rich');
    await ev(`showScreen('screen-stats')`); await statsIdle();
    const btns = await ev(`[...document.querySelectorAll('#stats-scroll .round-history-item')].map(i => [i.querySelector('.rhi-date').textContent, !!i.querySelector('.rhi-review')])`);
    assert.deepStrictEqual(btns.map(b => b[1]), [false, true, true], 'no Review on the in-progress round: ' + JSON.stringify(btns));
    state.inProgress = false;
    await ev(`document.querySelector('#stats-scroll .rhi-review').click()`);
    await waitFor(`document.querySelector('.screen.active').id === 'screen-review' && !!document.querySelector('#review-body .cr-table')`);
    const totals = await ev(`Object.fromEntries([...document.querySelectorAll('#review-body .cr-total')].map(r => [r.querySelector('dt').textContent, r.querySelector('dd').textContent]))`);
    assert.strictEqual(totals.Errors, 'not captured'); assert.strictEqual(totals.Penalties, 'not captured');
    assert.strictEqual(totals.Putts, '34 (17/18 holes recorded)'); assert.strictEqual(totals.Fairways, '7/14');
    assert.strictEqual(totals.GIR, '0/17 recorded (of 18)');
    assert.match(await ev(`document.querySelector('#review-body .cr-sub').textContent`), /^Tees not recorded · 12 Jun 2026 · HC 27$/);
    assert.strictEqual(await ev(`document.querySelector('#review-body .cr-note').textContent`), 'Pulled approach into trees');
    assert.strictEqual(await ev(`document.querySelectorAll('#review-body .cr-tags.is-unknown').length`), 18, 'no per-hole error claims');
    assert.ok(await ev(`[...document.querySelectorAll('#review-body td')].some(td => td.textContent === 'miss')`), 'legacy N fairway shown as "miss"');
    if (process.env.SHOTS) {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1900, deviceScaleFactor: 2, mobile: true }); await sleep(400);
      require('fs').writeFileSync(`${process.env.SHOTS}/coach-review-history.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    }
    await ev(`document.querySelector('#screen-review .cr-back').click()`); await statsIdle();
    assert.strictEqual(await activeScreen(), 'screen-stats');
  });

  await t('TASBP: resume from DB restores B tags (TB, B, none, SBP)', async () => {
    state.inProgress = true; state.resumeB = true;
    await ev(`loadHomeData()`); await waitFor(`!!window._inProgressRound`);
    await ev(`resumeRound()`); await waitFor(`document.querySelector('.screen.active').id === 'screen-play'`);
    assert.deepStrictEqual(await ev(`holeData.slice(0, 4).map(h => h.tags.join(''))`), ['TB', 'B', '', 'SBP']);
    await ev(`renderHole(0)`); assert.strictEqual(await pressed(), 'TB');
    state.inProgress = false; state.resumeB = false;
    await ev(`cancelRound()`); await waitFor(`document.querySelector('.screen.active').id === 'screen-home'`);
  });

  await t('Sign out from Profile → auth screen, session cleared, officialHI reset', async () => {
    await ev(`showScreen('screen-profile'); document.querySelector('.profile-signout').click()`);
    await waitFor(`document.querySelector('.screen.active').id === 'screen-auth'`);
    assert.strictEqual(await ev(`window.__signedOut === true && officialHI === null && currentUser === null`), true);
  });

  await t('No uncaught exceptions or console errors during the run', async () => {
    assert.deepStrictEqual(errors, []);
  });

  const realWrites = state.writes.filter(w => !w.url.includes('fnnxleatonxijyfghpts'));
  if (failed.length) { console.log(`\n${passed} passed, ${failed.length} FAILED`); ws.close(); process.exit(1); }
  console.log(`\nAll ${passed} browser regression tests passed. Supabase writes intercepted: ${state.writes.length} (all fulfilled by the mock, none reached the network).`);
  ws.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); console.error('errors:', errors); console.error('warns:', warns.slice(-5)); try { ws.close(); } catch {} process.exit(1); });
