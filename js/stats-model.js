// Read-only Stats model. Every score uses its own round's course and handicap.
// No UI, network, active-round state or writes. Missing data never becomes a miss.
const ST_FAIRWAYS = ['C', 'Y', 'L', 'R', 'X', 'N'];
const ST_TAGS = ['T', 'A', 'S', 'B', 'P'];
const stWhole = (v, min = 0) => Number.isInteger(v) && v >= min;
const stMean = xs => xs.length ? xs.reduce((a,b) => a+b, 0) / xs.length : null;
const stCourseKey = r => String(r.course_id ?? r.courses?.id ?? 'unknown');
const stTeeKey = r => r.tee_color ? String(r.tee_color) : 'unknown';
const stCourseName = r => r.courses?.name || 'Course not recorded';
const stHandicap = r => typeof r.playing_handicap === 'number' && Number.isFinite(r.playing_handicap) && r.playing_handicap >= -10;
const stPuttsKnown = s => stWhole(s.putts) && s.putts <= s.score;
const stOrder = rows => [...rows].sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')) || (crUtcMs(b.created_at) || 0) - (crUtcMs(a.created_at) || 0));

function stCourseMap(r) {
    const holes = r.courses?.holes;
    if (!Array.isArray(holes) || holes.length !== 18) return null;
    const map = new Map();
    for (const h of holes) {
        if (!stWhole(h.hole_number, 1) || h.hole_number > 18 || map.has(h.hole_number) || !stWhole(h.par, 1)
            || !stWhole(h.stroke_index, 1) || h.stroke_index > 18) return null;
        map.set(h.hole_number, {par:h.par, si:h.stroke_index});
    }
    return map;
}

function stScoredShots(r) {
    const shots = r.shots || [], seen = new Set();
    for (const s of shots) {
        if (!stWhole(s.hole_number, 1) || s.hole_number > 18 || seen.has(s.hole_number)) return [];
        seen.add(s.hole_number);
    }
    return shots.filter(s => stWhole(s.score, 1));
}

function stShape(r) {
    const shots = stScoredShots(r), nums = new Set(shots.map(s => s.hole_number));
    const has = (a,b) => Array.from({length:b-a+1}, (_,i) => a+i).every(n => nums.has(n));
    if (shots.length === 18 && has(1,18)) return 'full';
    if (shots.length === 9 && has(1,9)) return 'front';
    if (shots.length === 9 && has(10,18)) return 'back';
    return 'partial';
}
const stComplete = r => r.round_status !== 'in_progress' && r.shots?.length === 18 && stShape(r) === 'full' && !!stCourseMap(r);
const stPoints = (r, s, h) => Math.max(0, h.par - s.score + Math.floor(r.playing_handicap / 18) + (h.si <= (r.playing_handicap % 18+18)%18 ? 1 : 0) + 2);

function stSummary(r) {
    const shots = stScoredShots(r), map = stCourseMap(r);
    return {
        holes:shots.length, shape:stShape(r), complete:stComplete(r),
        gross:shots.length ? shots.reduce((n,s) => n+s.score, 0) : null,
        points:shots.length && map && stHandicap(r) ? shots.reduce((n,s) => n+stPoints(r,s,map.get(s.hole_number)),0) : null,
        putts:shots.length && shots.every(stPuttsKnown) ? shots.reduce((n,s) => n+s.putts,0) : null,
    };
}

function stSelect(rows, course = 'all', tee = 'all') {
    return stOrder(rows).filter(r => (course === 'all' || stCourseKey(r) === course) && (tee === 'all' || stTeeKey(r) === tee));
}

// A per-round leak rate requires 3 fully recorded, complete rounds.
function stRate(rows, kind) {
    let total = 0, eligible = 0;
    for (const r of rows) {
        const map = stCourseMap(r);
        if (kind === 'zero') {
            if (!stHandicap(r)) continue;
            total += r.shots.filter(s => stPoints(r,s,map.get(s.hole_number)) === 0).length;
        } else if (kind === 'putts') {
            if (!r.shots.every(stPuttsKnown)) continue;
            total += r.shots.filter(s => s.putts >= 3).length;
        } else {
            const tees = r.shots.filter(s => [4,5].includes(map.get(s.hole_number).par));
            if (!tees.length || !tees.every(s => ST_FAIRWAYS.includes(s.fairway))) continue;
            total += tees.filter(s => s.fairway === 'X').length;
        }
        eligible++;
    }
    return {total, eligible, window:rows.length, rate:eligible >= 3 ? Math.round(total/eligible*10)/10 : null};
}

function stSupporting(rows) {
    const putting = rows.filter(r => r.shots.every(stPuttsKnown)).map(r => r.shots.reduce((n,s) => n+s.putts, 0));
    let gir = 0, girRecorded = 0, fairways = 0, fairwaysRecorded = 0, teeHoles = 0;
    for (const r of rows) {
        const map = stCourseMap(r);
        for (const s of r.shots) {
            if (typeof s.gir === 'boolean') {girRecorded++; if (s.gir) gir++;}
            if (![4,5].includes(map.get(s.hole_number).par)) continue;
            teeHoles++;
            if (!ST_FAIRWAYS.includes(s.fairway)) continue;
            fairwaysRecorded++; if (['C','Y'].includes(s.fairway)) fairways++;
        }
    }
    return {putts:stMean(putting), puttRounds:putting.length, gir, girRecorded, holes:rows.length*18, fairways, fairwaysRecorded, teeHoles};
}

function stErrors(rows) {
    return ST_TAGS.map(tag => {
        const since = tag === 'B' ? CR_BUNKER_TAG_SINCE : CR_ERROR_TAGS_SINCE;
        const eligible = rows.filter(r => crCapturedSince(r.created_at, since) || r.shots.some(s => {
            const tags = crParseTags(s.error_tags); return tag === 'B' ? tags.includes('B') : tags.length > 0;
        }));
        const count = eligible.reduce((n,r) => n+r.shots.filter(s => crParseTags(s.error_tags).includes(tag)).length, 0);
        return {tag, count, rounds:eligible.length};
    });
}

function stProgress(rows, course = 'all', tee = 'all', window = 5) {
    const selected = stSelect(rows,course,tee), full = selected.filter(stComplete);
    const recent = full.slice(0,5), previous = full.slice(5,10);
    const played = window === 'all' ? full : full.slice(0,Number(window));
    const scores = played.map(r => stSummary(r).gross);
    const recentAvg = stMean(recent.map(r => stSummary(r).gross));
    const previousAvg = previous.length === 5 ? stMean(previous.map(r => stSummary(r).gross)) : null;
    const comparison = full.slice(0,10);
    const comparable = comparison.length === 10 && comparison.every(r => stCourseKey(r) !== 'unknown' && stTeeKey(r) !== 'unknown')
        && new Set(comparison.map(r => stCourseKey(r) + ':' + stTeeKey(r))).size === 1;
    const delta = previousAvg === null ? null : Math.round((recentAvg-previousAvg)*10)/10;
    return {
        selected: selected.length, full:full.length, excluded:selected.length-full.length, played, scores,
        average:stMean(scores), highest:scores.length ? Math.max(...scores) : null,
        recentAvg, previousAvg, recentHigh:recent.length ? Math.max(...recent.map(r => stSummary(r).gross)) : null,
        previousHigh:previous.length === 5 ? Math.max(...previous.map(r => stSummary(r).gross)) : null,
        comparable, delta, direction:!comparable ? null : delta <= -2 ? 'Lower scores' : delta >= 2 ? 'Higher scores' : 'Steady scores',
        zero:stRate(played,'zero'), threePutts:stRate(played,'putts'), ob:stRate(played,'ob'),
        supporting:stSupporting(played), errors:stErrors(played),
    };
}

function stCourseHoles(rows, course, tee = 'all') {
    const rounds = stSelect(rows,course,tee).filter(stComplete);
    return Array.from({length:18}, (_,i) => {
        let gross = 0, relative = 0, zero = 0, zeroRecorded = 0, putts = [], ob = 0, teeRecorded = 0, gir = 0, girRecorded = 0, fairways = 0;
        const pars = new Set();
        for (const r of rounds) {
            const s = r.shots.find(s => s.hole_number === i+1), h = stCourseMap(r).get(i+1);
            pars.add(h.par); gross += s.score; relative += s.score-h.par;
            if (stHandicap(r)) {zeroRecorded++; if (stPoints(r,s,h) === 0) zero++;}
            if (stPuttsKnown(s)) putts.push(s.putts);
            if (typeof s.gir === 'boolean') {girRecorded++; if (s.gir) gir++;}
            if ([4,5].includes(h.par) && ST_FAIRWAYS.includes(s.fairway)) {
                teeRecorded++; if (s.fairway === 'X') ob++; if (['C','Y'].includes(s.fairway)) fairways++;
            }
        }
        const count = rounds.length;
        return {num:i+1, count, pars:[...pars].sort(), avg:count ? gross/count : null, relative:count ? relative/count : null,
            zero, zeroRecorded, zeroRate:zeroRecorded >= 3 ? zero/zeroRecorded : null,
            threePutts:putts.filter(p => p>=3).length, puttsRecorded:putts.length, avgPutts:stMean(putts), ob, teeRecorded,
            girPct:girRecorded ? Math.round(gir/girRecorded*100) : null, girRecorded,
            firPct:teeRecorded ? Math.round(fairways/teeRecorded*100) : null};
    });
}

function stTroubleHoles(holes) {
    return holes.filter(h => h.count >= 3).sort((a,b) => (b.zeroRate ?? -1)-(a.zeroRate ?? -1) || b.relative-a.relative || a.num-b.num).slice(0,3);
}
