// Real Stats model, fake history. No network, no database writes.
const fs=require('fs'),path=require('path'),assert=require('assert');
const ROOT=path.join(__dirname,'../..');
const source=fs.readFileSync(path.join(ROOT,'js/stats-model.js'),'utf8');
const coach=fs.readFileSync(path.join(ROOT,'js/coach-review.js'),'utf8');
const M=new Function(coach+'\n'+source+'; return {stProgress,stComplete,stSummary,stSupporting,stCourseHoles,stTroubleHoles,stSelect,stErrors,stRate,stCourseMap,stOrder};')();
const clone=x=>JSON.parse(JSON.stringify(x));
function round(id,extra={}) {
  return {id,date:'2026-10-'+String(28-id).padStart(2,'0'),created_at:'2026-10-10T12:00:00Z',course_id:'a',round_status:'completed',playing_handicap:0,tee_color:'yellow',
    total_score:999,stableford_points:999,total_putts:999,
    courses:{name:'Course A',holes:Array.from({length:18},(_,i)=>({hole_number:i+1,par:4,stroke_index:i+1}))},
    shots:Array.from({length:18},(_,i)=>({hole_number:i+1,score:5,putts:2,gir:false,fairway:'C',error_tags:null})),...extra};
}
let n=0;const t=(name,fn)=>{fn();n++;console.log('PASS',name);};
t('excludes in-progress, front/back 9 and partial records from all full-round averages',()=>{
 const full=round(1), live=round(2,{round_status:'in_progress'}),front=round(3),back=round(4),partial=round(5);
 front.shots=front.shots.slice(0,9);back.shots=back.shots.slice(9);partial.shots=partial.shots.slice(0,14);
 const p=M.stProgress([full,live,front,back,partial]);assert.strictEqual(p.full,1);assert.strictEqual(p.average,90);assert.strictEqual(p.excluded,4);
 assert.strictEqual(M.stSummary(front).shape,'front');assert.strictEqual(M.stSummary(back).shape,'back');assert.strictEqual(M.stSummary(live).complete,false);
});
t('unknown legacy status with 18 valid holes qualifies; duplicates and invalid scores do not',()=>{
 assert.ok(M.stComplete(round(1,{round_status:null})));
 for(const invalid of [null,0,-1,1.2,'5']){const r=round(1);r.shots[0].score=invalid;assert.ok(!M.stComplete(r));}
 const r=round(1);r.shots[1].hole_number=1;assert.ok(!M.stComplete(r));assert.strictEqual(M.stSummary(r).gross,null);
});
t('hole scores are authoritative; stale stored totals are never used',()=>{
 const s=M.stSummary(round(1));assert.strictEqual(s.gross,90);assert.strictEqual(s.points,18);assert.strictEqual(s.putts,36);
});
t('same hole on two courses uses its own par and stroke index for points and zero-point holes',()=>{
 const a=round(1),b=round(2,{course_id:'b'});a.shots[0].score=6;b.shots[0].score=6;b.courses.holes[0].par=5;b.courses.holes[0].stroke_index=18;
 assert.strictEqual(M.stSummary(a).points,17);assert.strictEqual(M.stSummary(b).points,18);
 const ap=M.stCourseHoles([a,b],'a')[0],bp=M.stCourseHoles([a,b],'b')[0];assert.strictEqual(ap.relative,2);assert.strictEqual(bp.relative,1);assert.strictEqual(ap.zero,1);assert.strictEqual(bp.zero,0);
});
t('saved playing handicap, including zero, controls points; missing handicap never becomes zero',()=>{
 const a=round(1,{playing_handicap:18}),b=round(2,{playing_handicap:null});assert.strictEqual(M.stSummary(a).points,36);assert.strictEqual(M.stSummary(b).points,null);
 const p=M.stProgress([a,b,round(3)]);assert.strictEqual(p.zero.eligible,2);assert.strictEqual(p.zero.rate,null);assert.strictEqual(p.average,90);
});
t('0-putt holes count; unknown putts and implausible putts do not produce full-round totals',()=>{
 const a=round(1);a.shots[0].putts=0;assert.strictEqual(M.stSummary(a).putts,34);assert.strictEqual(M.stSupporting([a]).putts,34);
 for(const v of [null,undefined,'2',-1,6]){const b=round(2);b.shots[0].putts=v;assert.strictEqual(M.stSummary(b).putts,null);assert.strictEqual(M.stSupporting([b]).puttRounds,0);}
});
t('GIR denominators count true and false; unknown and missing values are excluded',()=>{
 const r=round(1);r.shots.forEach(s=>s.gir=null);r.shots[0].gir=true;r.shots[1].gir=false;delete r.shots[2].gir;
 const s=M.stSupporting([r]);assert.strictEqual(s.gir,1);assert.strictEqual(s.girRecorded,2);assert.strictEqual(s.holes,18);assert.strictEqual(M.stCourseHoles([r],'a')[2].girPct,null);
});
t('fairways accept legacy Y/N; par 3s, unknown and empty entries never count as misses',()=>{
 const r=round(1);r.shots.forEach(s=>s.fairway=null);r.shots[0].fairway='Y';r.shots[1].fairway='N';r.shots[2].fairway='X';r.courses.holes[2].par=3;r.shots[3].fairway='';r.shots[4].fairway='junk';
 const s=M.stSupporting([r]);assert.strictEqual(s.fairways,1);assert.strictEqual(s.fairwaysRecorded,2);assert.strictEqual(s.teeHoles,17);
});
t('leak rates require 3 eligible rounds, include zero events and disclose coverage',()=>{
 const rows=[round(1),round(2),round(3),round(4)];rows[0].shots[0].putts=null;rows[1].shots[0].putts=3;
 let p=M.stProgress(rows);assert.strictEqual(p.threePutts.eligible,3);assert.strictEqual(p.threePutts.rate,0.3);assert.strictEqual(p.ob.rate,0);
 rows[2].shots[0].putts=null;p=M.stProgress(rows);assert.strictEqual(p.threePutts.rate,null);assert.strictEqual(p.threePutts.eligible,2);
 rows[0].shots[0].fairway='junk';assert.strictEqual(M.stProgress(rows).ob.eligible,3);
});
t('recent five vs previous five needs 10 complete rounds, uses played-date order and rounds only once',()=>{
 const rows=Array.from({length:10},(_,i)=>round(i+1));rows.slice(0,5).forEach(r=>r.shots[0].score=3);
 let p=M.stProgress([...rows].reverse());assert.strictEqual(p.recentAvg,88);assert.strictEqual(p.previousAvg,90);assert.strictEqual(p.delta,-2);assert.strictEqual(p.direction,'Lower scores');assert.strictEqual(p.previousHigh,90);assert.strictEqual(p.recentHigh,88);
 p=M.stProgress(rows.slice(0,9));assert.strictEqual(p.previousAvg,null);assert.strictEqual(p.direction,null);
});
t('mixed courses, mixed tees or unrecorded tees never imply a comparable improvement trend',()=>{
 const rows=Array.from({length:10},(_,i)=>round(i+1));rows[9].course_id='b';assert.strictEqual(M.stProgress(rows).direction,null);
 rows[9].course_id='a';rows[9].tee_color='white';assert.strictEqual(M.stProgress(rows).direction,null);
 rows[9].tee_color=null;assert.strictEqual(M.stProgress(rows).direction,null);
});
t('course/tee/window filters isolate the intended data including all history beyond 20 rounds',()=>{
 const rows=Array.from({length:26},(_,i)=>round(i+1));rows[0].course_id='b';rows[1].tee_color='white';
 assert.strictEqual(M.stProgress(rows,'a','yellow','all').played.length,24);assert.strictEqual(M.stProgress(rows,'a','yellow',10).played.length,10);assert.strictEqual(M.stProgress(rows,'b').full,1);
});
t('course trouble holes use rates then relative-to-par; larger par-5 gross alone does not rank highest',()=>{
 const rows=[round(1),round(2),round(3)];rows.forEach(r=>{r.courses.holes[0].par=5;r.shots[0].score=6;r.courses.holes[1].par=3;r.shots[1].score=5;});
 const holes=M.stCourseHoles(rows,'a');assert.strictEqual(M.stTroubleHoles(holes)[0].num,2);assert.strictEqual(holes[0].zero,0);assert.strictEqual(holes[1].zero,3);
 assert.deepStrictEqual(M.stTroubleHoles(M.stCourseHoles(rows.slice(0,2),'a')),[]);
});
t('course holes disclose putt/OB coverage instead of turning missing into zero',()=>{
 const rows=[round(1),round(2),round(3)];rows[0].shots[0].putts=null;rows[1].shots[0].putts=0;rows[2].shots[0].putts=3;rows[0].shots[0].fairway=null;rows[1].shots[0].fairway='X';
 const h=M.stCourseHoles(rows,'a')[0];assert.strictEqual(h.threePutts,1);assert.strictEqual(h.puttsRecorded,2);assert.strictEqual(h.avgPutts,1.5);assert.strictEqual(h.ob,1);assert.strictEqual(h.teeRecorded,2);
});
t('only manual tags count; duplicate tags deduplicate; no errors inferred from poor outcomes',()=>{
 const r=round(1);r.shots[0].score=15;r.shots[0].putts=5;r.shots[0].fairway='X';assert.ok(M.stErrors([r]).every(e=>e.count===0));
 r.shots[0].error_tags='TTP';const errors=M.stErrors([r]);assert.strictEqual(errors.find(e=>e.tag==='T').count,1);assert.strictEqual(errors.find(e=>e.tag==='P').count,1);assert.strictEqual(errors.find(e=>e.tag==='B').count,0);
});
t('older untagged rounds show no tag availability; stored tags prove availability',()=>{
 const r=round(1,{created_at:'2026-09-01T12:00:00Z'});assert.ok(M.stErrors([r]).every(e=>e.rounds===0));r.shots[0].error_tags='T';assert.strictEqual(M.stErrors([r])[0].rounds,1);assert.strictEqual(M.stErrors([r]).find(e=>e.tag==='B').rounds,0);
});
t('missing course or invalid course layout is excluded from Progress but history score survives',()=>{
 const r=round(1);r.courses=null;assert.strictEqual(M.stComplete(r),false);assert.strictEqual(M.stSummary(r).gross,90);assert.strictEqual(M.stSummary(r).points,null);
 const bad=round(2);bad.courses.holes[1].hole_number=1;assert.strictEqual(M.stCourseMap(bad),null);
});
t('model does not mutate input, active-round globals or recorded totals',()=>{
 const rows=[round(1),round(2)],before=JSON.stringify(rows);M.stProgress(rows);M.stCourseHoles(rows,'a');assert.strictEqual(JSON.stringify(rows),before);
 assert.ok(!/\b(HOLES|holeData|activeRoundId|playingHC|selectedCourseSlug|localStorage|sbFetch)\b/.test(source));
});
t('forecasts and old projection helpers are removed from the player app',()=>{
 const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');assert.ok(!/function (calcTargetGrossScore|linearRegression|projectDate)|HC .*Projection|chart-score-trend|chartjs-adapter/.test(html));
 assert.ok(html.includes('js/stats-model.js?v=1'));assert.ok(html.includes('id="st-tab-rounds"'));
});
(async()=>{
 const ui=fs.readFileSync(path.join(ROOT,'js/stats.js'),'utf8');const requests=[];
 const fetchHistory=new Function('sbFetch','currentUser',ui+';return fetchStatsHistory;')(async url=>{requests.push(url);return requests.length===1?Array.from({length:100},(_,i)=>round(i)): [round(101)];},{id:'owner'});
 assert.strictEqual((await fetchHistory('owner')).length,101);assert.strictEqual(requests.length,2);assert.ok(requests.every(u=>u.includes('&user_id=eq.owner')));assert.ok(requests[1].includes('offset=100'));
 await assert.rejects(fetchHistory(null));console.log('PASS history pagination is complete, authenticated and read-only');n++;
 assert.ok(!/method:\s*['"](?:POST|PATCH|DELETE)/.test(ui));console.log(`\nAll ${n} Stats tests passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
