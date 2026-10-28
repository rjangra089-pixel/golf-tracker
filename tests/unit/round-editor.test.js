// Offline regression tests: all reads/writes use an in-memory database.
const fs = require('fs'), path = require('path'), assert = require('assert');
const code = fs.readFileSync(path.join(__dirname, '../../js/round-editor.js'), 'utf8');
const clone = x => JSON.parse(JSON.stringify(x));
let db, calls, fail, conflict, uid = 'owner';
const original = () => ({id:'round-1',user_id:'owner',round_status:'completed',date:'2026-10-20',course_id:'historical-course',playing_handicap:25,
    courses:{name:'Historical course',holes:Array.from({length:18},(_,i)=>({hole_number:i+1,par:i===0?3:4,stroke_index:i+1}))},
    shots:Array.from({length:18},(_,i)=>({id:'s'+i,round_id:'round-1',hole_number:i+1,score:5,putts:i===0?0:2,gir:i===1,fairway:'R',error_tags:'TB',notes:'Keep this'}))});
const currentUser = {get id(){return uid;}};
async function sbFetch(url, opts={}) {
    calls.push({url,...opts});
    if (!opts.method) return [clone(db)];
    if (fail && url.startsWith(fail)) {fail=null;throw new Error('network interrupted');}
    if (conflict && url.startsWith('shots')) return [];
    const body=JSON.parse(opts.body);
    if(url.startsWith('shots')) {
        const id = new URLSearchParams(url.split('?')[1]).get('id').slice(3);
        const shot=db.shots.find(s=>s.id===id); Object.assign(shot,body); return [clone(shot)];
    }
    Object.assign(db,body); return [clone(db)];
}
const api=new Function('sbFetch','currentUser', code+'; return {roundEditValidate,roundEditTotals,roundEditNumber,roundEditPersist};')(sbFetch,currentUser);
const setup=()=>{db=original();calls=[];fail=null;conflict=false;uid='owner';return {uid,round:clone(db),wrote:false};};
let n=0;
const t=async(name,fn)=>{await fn();n++;console.log('PASS',name);};
(async()=>{
await t('uses historical course and handicap, handles a zero putt and 9-hole rounds',()=>{
    setup(); const total=api.roundEditTotals(db);assert.deepStrictEqual(total,{total_score:90,total_putts:34,gir_count:1,stableford_points:42});
    db.shots=db.shots.slice(9);assert.strictEqual(api.roundEditTotals(db).total_score,45);
});
await t('rejects missing course, live rounds and duplicate shot rows',()=>{
    setup(); db.round_status='in_progress';assert.throws(()=>api.roundEditValidate(db));
    setup();db.courses.holes.pop();assert.throws(()=>api.roundEditValidate(db));
    setup();db.shots[1].hole_number=1;assert.throws(()=>api.roundEditValidate(db));
});
await t('invalid score or putts causes no write, including a late invalid hole',async()=>{
    for(const value of ['',0,-1,1.5,'oops']) {const s=setup(); await assert.rejects(api.roundEditPersist(s,[{id:'s0',score:4,putts:0},{id:'s1',score:value,putts:2}]));assert.strictEqual(calls.filter(c=>c.method).length,0);}
    const s=setup();await assert.rejects(api.roundEditPersist(s,[{id:'s0',score:4,putts:5}]));assert.strictEqual(calls.filter(c=>c.method).length,0);
    assert.strictEqual(api.roundEditNumber('',true,'Putts'),null);assert.strictEqual(api.roundEditNumber('0',true,'Putts'),0);
});
await t('updates existing shots only, preserves tags/notes/identity, recalculates totals',async()=>{
    const s=setup();const untouched=clone(db.shots[1]);
    const totals=await api.roundEditPersist(s,[{id:'s0',score:'4',putts:'0'}]);
    assert.strictEqual(totals.total_score,89);assert.strictEqual(totals.stableford_points,43);
    assert.deepStrictEqual(db.shots[1],untouched);assert.strictEqual(db.shots[0].error_tags,'TB');assert.strictEqual(db.shots[0].notes,'Keep this');
    assert.strictEqual(db.id,'round-1');assert.strictEqual(db.course_id,'historical-course');assert.strictEqual(db.playing_handicap,25);
    const writes=calls.filter(c=>c.method);assert.strictEqual(writes.length,2);assert.ok(writes.every(c=>c.method==='PATCH'));
    assert.deepStrictEqual(JSON.parse(writes[0].body),{score:4,putts:0});assert.ok(writes[0].url.includes('round_id=eq.round-1'));assert.ok(writes[1].url.includes('user_id=eq.owner'));
});
await t('catches changes from another device and changed accounts before writing',async()=>{
    let s=setup();db.shots[0].score=7;await assert.rejects(api.roundEditPersist(s,[{id:'s0',score:4,putts:0}]),/changed elsewhere/);assert.strictEqual(calls.filter(c=>c.method).length,0);
    s=setup();uid='other';await assert.rejects(api.roundEditPersist(s,[]));assert.strictEqual(calls.length,0);
});
await t('conditional patch rejects conflicts instead of claiming success',async()=>{
    const s=setup();conflict=true;await assert.rejects(api.roundEditPersist(s,[{id:'s0',score:4,putts:0}]),/changed elsewhere/);assert.strictEqual(calls.filter(c=>c.url.startsWith('rounds')&&c.method).length,0);
});
await t('retry after one confirmed hole update does not duplicate or delete rows',async()=>{
    const s=setup();fail='shots?id=eq.s1';const changes=[{id:'s0',score:4,putts:0},{id:'s1',score:6,putts:2}];
    await assert.rejects(api.roundEditPersist(s,changes));assert.strictEqual(s.wrote,true);assert.strictEqual(db.shots[0].score,4);
    await api.roundEditPersist(s,changes);assert.strictEqual(db.total_score,90);assert.strictEqual(db.shots.length,18);
    assert.strictEqual(calls.filter(c=>c.url.startsWith('shots?id=eq.s0')&&c.method).length,1);
});
await t('retry repairs round totals when summary update fails',async()=>{
    const s=setup();fail='rounds?';const changes=[{id:'s0',score:4,putts:''}];
    await assert.rejects(api.roundEditPersist(s,changes));assert.strictEqual(db.shots[0].putts,null);
    await api.roundEditPersist(s,changes);assert.strictEqual(db.total_score,89);assert.strictEqual(db.total_putts,34);
});
await t('editor never uses active round or storage queue and integration offers Edit only on saved rounds',()=>{
    assert.ok(!/\b(activeRoundId|holeData|HOLES|playingHC|selectedTee|selectedCourseSlug|queueWrite|localStorage|loadHomeData)\b/.test(code));
    const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8')+fs.readFileSync(path.join(__dirname,'../../js/stats.js'),'utf8');assert.ok(html.includes('js/round-editor.js?v=1'));assert.ok(html.includes("editBtn.addEventListener('click', () => openRoundEdit(r.id))"));
});
console.log(`\nAll ${n} round-editor tests passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
