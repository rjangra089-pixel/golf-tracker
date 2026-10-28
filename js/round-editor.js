// Saved-round corrections are isolated from live-round globals and offline queues.
let roundEdit = null;

async function roundEditRefresh(uid) {
    // Refresh coaching/history without loading preferences into an active round.
    if (currentUser?.id !== uid) return;
    const [history, rounds] = await Promise.all([
        fetchHomeHistory(uid),
        sbFetch('rounds?select=*&order=date.desc&limit=20&user_id=eq.' + encodeURIComponent(uid))
    ]);
    if (currentUser?.id !== uid) return;
    homeModel = buildHomeModel(history || []); homeLoadError = false;
    recentRounds = rounds || []; holeStats = [];
    renderHome();
    await loadStats();
}


function roundEditValidate(round) {
    if (!round || round.round_status === 'in_progress') throw new Error('Only saved rounds can be edited.');
    const holes = round.courses?.holes || [];
    const map = new Map(holes.map(h => [h.hole_number, h]));
    if (map.size !== 18 || holes.length !== 18 || Array.from({length:18}, (_,i) => i+1).some(n => {
        const h = map.get(n);
        return !h || !Number.isInteger(h.par) || h.par < 1 || !Number.isInteger(h.stroke_index) || h.stroke_index < 1 || h.stroke_index > 18;
    })) throw new Error('The course hole data is unavailable. Please try again later.');
    if (!Number.isFinite(round.playing_handicap) || round.playing_handicap < 0) throw new Error('The saved playing handicap is missing.');
    const shots = round.shots || [];
    if (!shots.length || new Set(shots.map(s => s.hole_number)).size !== shots.length || shots.some(s => !s.id || !map.has(s.hole_number))) {
        throw new Error('This round has missing or duplicate hole records and cannot be edited safely.');
    }
    return map;
}

function roundEditNumber(raw, optional, label) {
    const text = String(raw ?? '').trim();
    if (!text && optional) return null;
    const n = text ? Number(text) : NaN;
    if (!Number.isSafeInteger(n) || n < (optional ? 0 : 1)) throw new Error(label + ' must be a whole number ' + (optional ? 'of 0 or more.' : 'of 1 or more.'));
    return n;
}

function roundEditTotals(round) {
    const holes = roundEditValidate(round);
    return round.shots.reduce((totals, s) => {
        const h = holes.get(s.hole_number);
        totals.total_score += s.score || 0;
        totals.total_putts += s.putts ?? 0;
        totals.gir_count += s.gir === true ? 1 : 0;
        if (s.score) totals.stableford_points += Math.max(0, h.par - s.score + Math.floor(round.playing_handicap / 18) + (h.stroke_index <= round.playing_handicap % 18 ? 1 : 0) + 2);
        return totals;
    }, {total_score:0, total_putts:0, gir_count:0, stableford_points:0});
}

async function roundEditFetch(id, uid) {
    const rows = await sbFetch('rounds?select=*,shots(*),courses(name,holes(hole_number,par,stroke_index))&id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(uid));
    if (rows?.length !== 1 || rows[0].user_id !== uid) throw new Error('This round is no longer available for your account.');
    roundEditValidate(rows[0]);
    return rows[0];
}

// Compare all shot fields and metadata so another device's changes aren't silently replaced.
function roundEditFingerprint(round) {
    return JSON.stringify([round.course_id, round.playing_handicap, round.round_status,
        [...round.shots].sort((a,b) => a.hole_number-b.hole_number), round.courses]);
}

async function roundEditPersist(session, changes) {
    if (!currentUser?.id || currentUser.id !== session.uid) throw new Error('Please sign in to the same account again.');
    const live = await roundEditFetch(session.round.id, session.uid);
    if (roundEditFingerprint(live) !== roundEditFingerprint(session.round)) throw new Error('This round changed elsewhere. Close and reopen Edit to load the latest scores.');
    for (const change of changes) {
        const original = session.round.shots.find(s => s.id === change.id);
        if (!original) throw new Error('Unknown hole record.');
        const score = roundEditNumber(change.score, false, 'Score');
        const putts = roundEditNumber(change.putts, true, 'Putts');
        if (putts !== null && putts > score) throw new Error('Putts cannot be more than the score.');
    }
    for (const change of changes) {
        const original = session.round.shots.find(s => s.id === change.id);
        const score = roundEditNumber(change.score, false, 'Score');
        const putts = roundEditNumber(change.putts, true, 'Putts');
        if (score === original.score && putts === (original.putts ?? null)) continue;
        const eq = v => v === null || v === undefined ? 'is.null' : 'eq.' + encodeURIComponent(v);
        if (currentUser?.id !== session.uid) throw new Error('Your account changed. Please sign in again.');
        const rows = await sbFetch('shots?id=eq.' + encodeURIComponent(original.id) + '&round_id=eq.' + encodeURIComponent(session.round.id)
            + '&score=' + eq(original.score) + '&putts=' + eq(original.putts), {
            method:'PATCH', body:JSON.stringify({score, putts})
        });
        if (rows?.length !== 1) throw new Error('A hole changed elsewhere or could not be updated. Close and reopen Edit.');
        // Keep confirmed progress for a safe retry if a later request fails.
        Object.assign(original, rows[0]);
        session.wrote = true;
    }
    if (currentUser?.id !== session.uid) throw new Error('Your account changed. Please sign in again.');
    const totals = roundEditTotals(session.round);
    const rows = await sbFetch('rounds?id=eq.' + encodeURIComponent(session.round.id) + '&user_id=eq.' + encodeURIComponent(session.uid), {
        method:'PATCH', body:JSON.stringify(totals)
    });
    if (rows?.length !== 1) throw new Error('Could not update round totals. Please retry Save changes.');
    return totals;
}

async function openRoundEdit(id) {
    if (roundEdit) return;
    const uid = currentUser?.id;
    if (!uid) return;
    const session = {uid, round:null, busy:false, wrote:false, focus:document.activeElement};
    roundEdit = session;
    const dialog = document.createElement('dialog');
    dialog.className = 'round-edit'; dialog.setAttribute('aria-labelledby', 'round-edit-title');
    dialog.innerHTML = '<form><h2 id="round-edit-title">Edit saved round</h2><p class="round-edit-info"></p><div class="round-edit-fields"></div><div class="round-edit-footer"><p role="status" aria-live="polite" class="round-edit-status">Loading round…</p><div class="round-edit-actions"><button type="button" class="round-edit-cancel">Cancel</button><button type="submit" class="round-edit-save" disabled>Save changes</button></div></div></form>';
    document.body.appendChild(dialog); session.dialog = dialog;
    const close = () => {
        if (session.busy) return;
        if (session.wrote && !confirm('Some corrections have already synced. Close without retrying the remaining changes?')) return;
        roundEdit = null; dialog.close(); dialog.remove(); session.focus?.focus();
        if (session.wrote) roundEditRefresh(uid).catch(console.warn);
    };
    dialog.querySelector('.round-edit-cancel').onclick = close;
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dialog.showModal();
    try {
        session.round = await roundEditFetch(id, uid);
        if (roundEdit !== session) return;
        const round = session.round;
        dialog.querySelector('.round-edit-info').textContent = new Date(round.date + 'T12:00:00').toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'}) + ' · ' + (round.courses.name || 'Saved course') + ' · Playing handicap ' + round.playing_handicap + '. Leave unrecorded putts blank. Save while online.';
        const fields = dialog.querySelector('.round-edit-fields');
        fields.innerHTML = '<div class="round-edit-head"><span>Hole</span><span>Score</span><span>Putts</span></div>';
        [...round.shots].sort((a,b) => a.hole_number-b.hole_number).forEach(shot => {
            const row = document.createElement('div'); row.className = 'round-edit-row';
            const label = document.createElement('span'); label.textContent = shot.hole_number; row.appendChild(label);
            ['score','putts'].forEach(key => {
                const input = document.createElement('input'); input.type = 'number'; input.inputMode = 'numeric'; input.min = key === 'score' ? '1' : '0'; input.step = '1'; input.required = key === 'score';
                input.value = shot[key] ?? ''; input.setAttribute('aria-label', 'Hole ' + shot.hole_number + ' ' + key);
                input.dataset.shotId = shot.id; input.dataset.field = key; row.appendChild(input);
            });
            fields.appendChild(row);
        });
        dialog.querySelector('.round-edit-status').textContent = '';
        dialog.querySelector('.round-edit-save').disabled = false;
    } catch(e) { if (roundEdit === session) dialog.querySelector('.round-edit-status').textContent = e.message; }
    dialog.querySelector('form').onsubmit = async e => {
        e.preventDefault(); if (session.busy || !session.round) return;
        const status = dialog.querySelector('.round-edit-status');
        const changes = session.round.shots.map(s => ({id:s.id,
            score:[...dialog.querySelectorAll('input')].find(i => i.dataset.shotId === s.id && i.dataset.field === 'score').value,
            putts:[...dialog.querySelectorAll('input')].find(i => i.dataset.shotId === s.id && i.dataset.field === 'putts').value
        }));
        session.busy = true; status.textContent = 'Saving corrections…';
        dialog.querySelectorAll('button, input').forEach(el => el.disabled = true);
        try {
            await roundEditPersist(session, changes);
            roundEdit = null; dialog.close(); dialog.remove(); session.focus?.focus();
            try { await roundEditRefresh(session.uid); } catch(refreshError) { console.warn('Round saved; refresh failed:', refreshError); }
            const message = document.createElement('p'); message.role = 'status'; message.className = 'round-edit-success'; message.textContent = '✓ Round updated. Scores, putting totals and Stableford points refreshed.';
            document.getElementById('stats-scroll').prepend(message);
        } catch(err) {
            status.textContent = 'Save not complete. ' + err.message + ' Your entries are still here. If a request was interrupted, reopen Edit to check what synced before retrying.';
        } finally { session.busy = false; dialog.querySelectorAll('button, input').forEach(el => el.disabled = false); }
    };
}
