// ════════════════════════════════════════════════════════════════
//  COACH REVIEW — dense, factual post-round view + "Copy Round Data"
//
//  Classic script (no build step), loaded before the app's inline script.
//  Pure part (crBuildReview, crFormatRoundText and helpers): no DOM, no app
//  globals — unit-tested directly from tests/unit/coach-review.test.js.
//  DOM part (crRenderReview, crCopyRoundData): textContent only.
//
//  Truthfulness rules:
//  - Only data the app actually stores is shown. Unknown ≠ zero: a value the
//    app never captured shows "—" / "not captured", never 0.
//  - T/A/S/B/P are only the golfer's own manual tags. Nothing is inferred from
//    fairway, GIR, putts, OB, score or a bunker visit. B is an error category,
//    not a count of bunker shots (bunker shots are not captured).
//  - Penalties are not captured. Tee-shot OB (fairway 'X') is shown under its
//    own name and never presented as a penalty total.
// ════════════════════════════════════════════════════════════════

const CR_TAG_ORDER = ['T', 'A', 'S', 'B', 'P'];
// Capability cutovers — exact UTC instants, compared with rounds.created_at
// (set when the round is started). A round started before a cutover could not
// have recorded that data, so it shows "not captured", never 0.
//  - T/A/S/P: live in production when Vercel deployment golf-tracker-pnuof3j1f
//    (commit 8eb7b9e) became Ready — created 2026-10-07 12:25:39 UTC + 9 s build.
//  - B: the LATER of (a) the B migration being applied — verified in the SQL
//    Editor at 2026-10-09T16:20:02.204Z — and (b) the production deployment
//    that ships the B button becoming Ready. B needs both the UI and the DB.
const CR_ERROR_TAGS_SINCE = '2026-10-07T12:25:48Z';
const CR_BUNKER_TAG_SINCE = '2026-10-09T16:20:02.204Z';
const CR_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const crIsWhole = (v, min) => Number.isInteger(v) && v >= min;

// Supabase returns created_at without a zone ('2026-10-09T08:34:53.085647'); it
// is UTC. Browsers would read a zone-less timestamp as LOCAL time, so mark it UTC.
function crUtcMs(v) {
    if (typeof v !== 'string' || !v) return NaN;
    const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(v);
    return Date.parse(hasZone ? v : v + 'Z');
}

// true only when the round was provably started at/after the cutover instant.
// Unknown cutover (null) or unreadable timestamp → false ("not captured").
function crCapturedSince(createdAt, since) {
    if (!since) return false;
    const t = crUtcMs(createdAt), c = Date.parse(since);
    return Number.isFinite(t) && Number.isFinite(c) && t >= c;
}

// Stored tags ('TA', ['B','T'], null) → ordered array of valid letters.
function crParseTags(value) {
    const raw = Array.isArray(value) ? value : (typeof value === 'string' ? value.split('') : []);
    return CR_TAG_ORDER.filter(t => raw.includes(t));
}

// Fairway result for display. Stored values: C/Y hit, L miss left, R miss right,
// X out of bounds, N missed (legacy, no direction). Par 3: not applicable.
function crFairway(par, fairway) {
    if (par === 3) return 'N/A';
    switch (fairway) {
        case 'C': case 'Y': return '✓';
        case 'L': return '←';
        case 'R': return '→';
        case 'X': return 'OB';
        case 'N': return 'miss';
        default:  return '—';
    }
}

// 'YYYY-MM-DD' → '9 Oct 2026' (no locale / timezone dependence).
function crFormatDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${Number(m[3])} ${CR_MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

// Which holes form a reviewable round: exactly 1–18, 1–9 or 10–18, each scored once.
function crRoundShape(shots) {
    const nums = new Set();
    for (const s of shots || []) {
        if (!crIsWhole(s?.score, 1)) continue;
        if (!crIsWhole(s.hole_number, 1) || s.hole_number > 18 || nums.has(s.hole_number)) return null;
        nums.add(s.hole_number);
    }
    const has = (a, b) => { for (let i = a; i <= b; i++) if (!nums.has(i)) return false; return true; };
    if (nums.size === 18 && has(1, 18)) return 'full';
    if (nums.size === 9 && has(1, 9)) return 'front';
    if (nums.size === 9 && has(10, 18)) return 'back';
    return null;
}

// input: { status, courseName, tee, date, createdAt, playingHandicap, stableford,
//          holes: [{hole_number, par, stroke_index}], shots: [{hole_number, score, putts,
//          fairway, gir, error_tags, notes}], allowInProgress,
//          playedOnThisVersion }   ← true only for the round just played in this app
// opts: { errorTagsSince, bunkerTagSince } — cutover overrides (tests); default the constants.
function crBuildReview(input, opts = {}) {
    const shotsIn = (input.shots || []).filter(s => crIsWhole(s?.score, 1));
    if (input.status === 'in_progress' && !input.allowInProgress) return { reviewable: false, reason: 'in progress' };
    const shape = crRoundShape(shotsIn);
    if (!shape) return { reviewable: false, reason: 'incomplete' };
    const pars = new Map((input.holes || []).map(h => [h.hole_number, h]));
    for (const s of shotsIn) if (!crIsWhole(pars.get(s.hole_number)?.par, 1)) return { reviewable: false, reason: 'course data' };

    const errorsSince = 'errorTagsSince' in opts ? opts.errorTagsSince : CR_ERROR_TAGS_SINCE;
    const bunkerSince = 'bunkerTagSince' in opts ? opts.bunkerTagSince : CR_BUNKER_TAG_SINCE;
    const live = input.playedOnThisVersion === true;          // this app version has all five buttons
    const anyTags = shotsIn.some(s => crParseTags(s.error_tags).length);
    const anyB = shotsIn.some(s => crParseTags(s.error_tags).includes('B'));
    // Evidence (a stored tag) always proves capability; otherwise require the exact cutover.
    const errorsCaptured = anyTags || live || crCapturedSince(input.createdAt, errorsSince);
    const bunkerCaptured = anyB || live || crCapturedSince(input.createdAt, bunkerSince);

    const holes = shotsIn.slice().sort((a, b) => a.hole_number - b.hole_number).map(s => {
        const par = pars.get(s.hole_number).par;
        const putts = crIsWhole(s.putts, 0) ? s.putts : null;
        const gir = s.gir === true ? 'Y' : s.gir === false ? 'N' : null;
        const note = typeof s.notes === 'string' && s.notes.trim() ? s.notes.replace(/\s+/g, ' ').trim() : null;
        return { num: s.hole_number, par, score: s.score, fw: crFairway(par, s.fairway), fairway: s.fairway ?? null,
                 gir, putts, tags: errorsCaptured ? crParseTags(s.error_tags) : null, note };
    });

    const sum = arr => arr.reduce((a, b) => a + b, 0);
    const nine = (a, b) => holes.filter(h => h.num >= a && h.num <= b);
    const front = nine(1, 9), back = nine(10, 18);
    const fwHoles = holes.filter(h => h.par >= 4);
    const fwRecorded = fwHoles.filter(h => h.fairway !== null && h.fairway !== '');
    // Tee OB is only knowable where the current C/L/R/X scheme was used; the legacy
    // Y/N scheme had no OB option, so those holes are "not recorded", never 0.
    const obRecorded = fwRecorded.filter(h => ['C', 'L', 'R', 'X'].includes(h.fairway));
    const puttsKnown = holes.filter(h => h.putts !== null);
    const girKnown = holes.filter(h => h.gir !== null);
    const errors = {};
    for (const t of CR_TAG_ORDER) {
        errors[t] = !errorsCaptured || (t === 'B' && !bunkerCaptured) ? null : sum(holes.map(h => h.tags.includes(t) ? 1 : 0));
    }

    return {
        reviewable: true,
        shape,
        holeCount: holes.length,
        meta: {
            course: input.courseName || null,
            tee: input.tee ? input.tee.charAt(0).toUpperCase() + input.tee.slice(1) : null,
            date: crFormatDate(input.date),
            playingHandicap: Number.isFinite(input.playingHandicap) ? input.playingHandicap : null,
            stableford: Number.isFinite(input.stableford) ? input.stableford : null,
        },
        totals: {
            gross: sum(holes.map(h => h.score)),
            front: front.length === 9 ? sum(front.map(h => h.score)) : null,
            back: back.length === 9 ? sum(back.map(h => h.score)) : null,
            putts: { total: sum(puttsKnown.map(h => h.putts)), known: puttsKnown.length, of: holes.length },
            fairways: { hit: fwRecorded.filter(h => h.fairway === 'C' || h.fairway === 'Y').length, recorded: fwRecorded.length, of: fwHoles.length },
            gir: { hit: girKnown.filter(h => h.gir === 'Y').length, known: girKnown.length, of: holes.length },
            teeOB: { count: obRecorded.filter(h => h.fairway === 'X').length, recorded: obRecorded.length, of: fwHoles.length },
            doubleBogeyPlus: holes.filter(h => h.score >= h.par + 2).length,
            threePutts: { count: puttsKnown.filter(h => h.putts === 3).length, known: puttsKnown.length, of: holes.length },
            fourPlusPutts: { count: puttsKnown.filter(h => h.putts >= 4).length, known: puttsKnown.length, of: holes.length },
            errorsCaptured,
            bunkerCaptured,
            errors,
        },
        holes,
    };
}

// "39" when every hole is known; "34 (16/18 holes recorded)" when partial; null when none.
function crCountText(value, known, of) {
    if (!known) return null;
    return known === of ? String(value) : `${value} (${known}/${of} holes recorded)`;
}
function crRatioText(hit, known, of) {
    if (!of) return null;
    if (!known) return null;
    return known === of ? `${hit}/${of}` : `${hit}/${known} recorded (of ${of})`;
}

// Display-ready totals rows shared by the page and the copied text.
function crTotalsRows(review) {
    const t = review.totals, rows = [];
    const add = (label, value) => rows.push({ label, value: value === null || value === undefined ? 'not recorded' : String(value) });
    rows.push({ label: 'Score', value: review.shape === 'full' ? String(t.gross) : `${t.gross} (${review.shape} 9 only)` });
    if (review.meta.stableford !== null) rows.push({ label: 'Stableford', value: `${review.meta.stableford} pts` });
    if (t.front !== null) rows.push({ label: 'Front', value: String(t.front) });
    if (t.back !== null) rows.push({ label: 'Back', value: String(t.back) });
    add('Putts', crCountText(t.putts.total, t.putts.known, t.putts.of));
    if (t.fairways.of) add('Fairways', crRatioText(t.fairways.hit, t.fairways.recorded, t.fairways.of));
    add('GIR', crRatioText(t.gir.hit, t.gir.known, t.gir.of));
    if (t.teeOB.of) add('Tee shots OB', t.teeOB.recorded ? crCountText(t.teeOB.count, t.teeOB.recorded, t.teeOB.of) : null);
    rows.push({ label: 'Penalties', value: 'not captured' });
    rows.push({ label: 'Errors', value: t.errorsCaptured
        ? CR_TAG_ORDER.map(k => `${k} ${t.errors[k] === null ? 'not captured' : t.errors[k]}`).join(' | ')
        : 'not captured' });
    rows.push({ label: 'Double bogey+', value: String(t.doubleBogeyPlus) });
    add('3-putts', crCountText(t.threePutts.count, t.threePutts.known, t.threePutts.of));
    add('4+ putts', crCountText(t.fourPlusPutts.count, t.fourPlusPutts.known, t.fourPlusPutts.of));
    return rows;
}

function crHoleLine(h, errorsCaptured) {
    const parts = [`H${h.num}`, `Par ${h.par}`, `Score ${h.score}`, `FW ${h.fw}`,
                   `GIR ${h.gir ?? '—'}`, `Putts ${h.putts ?? '—'}`];
    if (errorsCaptured) parts.push(`Errors ${h.tags.length ? h.tags.join(',') : '-'}`);
    if (h.note) parts.push(`Note ${h.note}`);
    return parts.join(' | ');
}

// Deterministic plain text for pasting into a coach / ChatGPT.
function crFormatRoundText(review) {
    if (!review || !review.reviewable) return '';
    const m = review.meta, lines = [];
    lines.push(`Round: ${m.course || 'Unknown course'}${m.tee ? ` – ${m.tee} tees` : ''}`);
    if (m.date) lines.push(`Date: ${m.date}`);
    if (m.playingHandicap !== null) lines.push(`Playing handicap: ${m.playingHandicap}`);
    for (const r of crTotalsRows(review)) lines.push(`${r.label}: ${r.value}`);
    const groups = [['Front 9', 1, 9], ['Back 9', 10, 18]];
    for (const [title, a, b] of groups) {
        const hs = review.holes.filter(h => h.num >= a && h.num <= b);
        if (!hs.length) continue;
        lines.push('', title);
        for (const h of hs) lines.push(crHoleLine(h, review.totals.errorsCaptured));
    }
    return lines.join('\n');
}

// ── DOM ────────────────────────────────────────────────────────────
function crEl(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
}

// Renders the review into `container` (replaces its content).
function crRenderReview(container, review) {
    container.replaceChildren();
    if (!review || !review.reviewable) {
        container.appendChild(crEl('p', 'cr-unavailable',
            review && review.reason === 'in progress' ? 'Coach review is available once the round is finished.'
                                                      : 'Coach review needs every hole of a 9- or 18-hole round scored.'));
        return;
    }
    const m = review.meta;
    const head = crEl('div', 'cr-head');
    head.appendChild(crEl('div', 'cr-title', m.course || 'Unknown course'));
    head.appendChild(crEl('div', 'cr-sub', [m.tee ? `${m.tee} tees` : 'Tees not recorded', m.date, m.playingHandicap !== null ? `HC ${m.playingHandicap}` : null].filter(Boolean).join(' · ')));
    container.appendChild(head);

    const totals = crEl('dl', 'cr-totals');
    for (const r of crTotalsRows(review)) {
        const row = crEl('div', 'cr-total' + (/not (captured|recorded)/.test(r.value) ? ' is-unknown' : ''));
        row.appendChild(crEl('dt', null, r.label));
        row.appendChild(crEl('dd', null, r.value));
        totals.appendChild(row);
    }
    container.appendChild(totals);

    const copyRow = crEl('div', 'cr-copy-row');
    const btn = crEl('button', 'cr-copy-btn', 'Copy Round Data');
    btn.type = 'button';
    const status = crEl('span', 'cr-copy-status');
    status.setAttribute('role', 'status');
    const fallback = crEl('textarea', 'cr-copy-fallback');
    fallback.readOnly = true; fallback.hidden = true; fallback.setAttribute('aria-label', 'Round data');
    btn.addEventListener('click', () => crCopyRoundData(review, status, fallback));
    copyRow.append(btn, status);
    container.append(copyRow, fallback);

    for (const [title, a, b] of [['Front 9', 1, 9], ['Back 9', 10, 18]]) {
        const hs = review.holes.filter(h => h.num >= a && h.num <= b);
        if (!hs.length) continue;
        const sec = crEl('section', 'cr-nine');
        sec.appendChild(crEl('h3', 'cr-nine-title', `${title} · ${hs.reduce((s, h) => s + h.score, 0)}`));
        const table = crEl('table', 'cr-table');
        const thead = crEl('thead'); const hr = crEl('tr');
        for (const c of ['H', 'Par', 'Score', 'FW', 'GIR', 'Putts', 'Errors']) hr.appendChild(crEl('th', null, c));
        thead.appendChild(hr); table.appendChild(thead);
        const tbody = crEl('tbody');
        for (const h of hs) {
            const tr = crEl('tr', h.score >= h.par + 2 ? 'is-dbl' : null);
            tr.appendChild(crEl('td', 'cr-h', String(h.num)));
            tr.appendChild(crEl('td', null, String(h.par)));
            tr.appendChild(crEl('td', 'cr-score', String(h.score)));
            tr.appendChild(crEl('td', h.fw === '—' ? 'is-unknown' : null, h.fw));
            tr.appendChild(crEl('td', h.gir === null ? 'is-unknown' : null, h.gir ?? '—'));
            tr.appendChild(crEl('td', h.putts === null ? 'is-unknown' : null, h.putts === null ? '—' : String(h.putts)));
            tr.appendChild(crEl('td', 'cr-tags' + (h.tags === null ? ' is-unknown' : ''), h.tags === null ? '—' : (h.tags.join(' ') || '·')));
            tbody.appendChild(tr);
            if (h.note) {
                const nr = crEl('tr', 'cr-note-row'); const td = crEl('td', 'cr-note', h.note); td.colSpan = 7;
                nr.appendChild(td); tbody.appendChild(nr);
            }
        }
        table.appendChild(tbody); sec.appendChild(table); container.appendChild(sec);
    }
    container.appendChild(crEl('p', 'cr-footnote',
        'FW: ✓ fairway · ← / → missed left / right · miss (direction not recorded) · OB · N/A on par 3s. Underlined score = double bogey or worse. Errors: only the T/A/S/B/P you tagged — nothing is inferred; · none tagged, — not captured. Penalties and bunker shots are not captured.'));
}

async function crCopyRoundData(review, statusEl, fallbackEl) {
    const text = crFormatRoundText(review);
    const ok = msg => { statusEl.textContent = msg; statusEl.classList.remove('is-error'); if (fallbackEl) fallbackEl.hidden = true; };
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            ok('Round data copied');
            return true;
        }
        throw new Error('Clipboard API unavailable');
    } catch (e) {
        statusEl.textContent = "Couldn't copy automatically — select the text below and copy it.";
        statusEl.classList.add('is-error');
        if (fallbackEl) { fallbackEl.value = text; fallbackEl.hidden = false; fallbackEl.focus(); fallbackEl.select(); }
        return false;
    }
}
