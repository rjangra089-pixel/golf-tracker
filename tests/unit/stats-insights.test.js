const fs=require('fs'),assert=require('assert'),path=require('path'),root=path.resolve(__dirname,'../..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const calculate=read('js/setup.js').match(/function calculatePlayingHandicap\([^]*?\n\}/)[0];
const M=new Function(read('js/coach-review.js')+read('js/stats-model.js')+calculate+read('js/stats-insights.js')+';return {window:siWindow,analysis:siAnalysis,target:siTarget,allow:siAllowance,calculate:calculatePlayingHandicap};')();
function round(n){return {id:String(n),course_id:'a',tee_color:'yellow',date:'2026-10-'+String(28-n).padStart(2,'0'),round_status:'completed',playing_handicap:18,courses:{name:'Course A',holes:Array.from({length:18},(_,i)=>({hole_number:i+1,par:4,stroke_index:i+1}))},shots:Array.from({length:18},(_,i)=>({hole_number:i+1,score:5,putts:2,fairway:'C',error_tags:null}))};}
const rows=Array.from({length:10},(_,i)=>round(i)),before=JSON.stringify(rows);
let c=M.window(rows);assert.strictEqual(c.expensive,0);assert.strictEqual(c.gaps,0);assert.strictEqual(c.puttsKnown,180);assert.strictEqual(c.teeKnown,180);assert.strictEqual(c.spread,0);
for(const r of rows){r.shots[0].score=8;r.shots[0].error_tags='TA';r.shots[1].putts=null;r.shots[2].putts=0;r.shots[3].fairway='X';r.shots[4].fairway='Y';}
c=M.window(rows);assert.strictEqual(c.expensive,10);assert.strictEqual(c.gaps,30);assert.strictEqual(c.stacked,10);assert.strictEqual(c.errors.T,10);assert.strictEqual(c.errors.A,10);assert.strictEqual(c.puttsKnown,170);assert.strictEqual(c.teeKnown,170);assert.strictEqual(c.ob,10);assert.strictEqual(c.trouble[0].hole,1);assert.strictEqual(c.trouble[0].average,3);assert.strictEqual(c.phases[0].gap/(c.phases[0].holes/6),3);
assert.strictEqual(M.window(rows.slice(0,2)).trouble.length,0);const mixed=JSON.parse(JSON.stringify(rows.slice(0,4)));mixed[2].course_id='b';mixed[3].tee_color='white';assert.strictEqual(M.window(mixed).trouble.length,0,'different courses and tees do not form a repeat-hole sample');
const missing=round(1);missing.playing_handicap=null;assert.strictEqual(M.window([missing]).hcRounds,0);assert.strictEqual(M.window([missing]).phases[0].holes,0);
const duplicate=round(1);duplicate.courses.holes[1].stroke_index=1;assert.strictEqual(M.window([duplicate]).hcRounds,0);
const partial=round(1);partial.shots.pop();assert.strictEqual(M.window([partial]).rounds,0);const live=round(1);live.round_status='in_progress';assert.strictEqual(M.window([live]).rounds,0);
assert.strictEqual(M.allow(-1,18),-1);assert.strictEqual(M.allow(-1,1),0);
let a=M.analysis(rows,'all','all',5);assert.ok(a.ten&&a.comparable);assert.strictEqual(a.current.rounds,5);rows[0].tee_color='white';assert.strictEqual(M.analysis(rows,'all','all',5).comparable,false);rows[0].tee_color='yellow';
const meta={rating:72,slope:113};let t=M.target(rows,'a','yellow',meta,25,15,1,M.calculate);assert.strictEqual(t.current,25);assert.strictEqual(t.goal,15);assert.strictEqual(t.currentGross-t.goalGross,10);assert.strictEqual(t.goalGross,87);assert.strictEqual(t.holes.reduce((n,h)=>n+h.target,0),87);assert.strictEqual(t.opportunities[0].hole,1);assert.strictEqual(t.opportunities[0].tags.T,10);
assert.strictEqual(M.target(rows,'a','yellow',meta,25,15,.95,M.calculate).goal,14);assert.strictEqual(M.target(rows,'a','yellow',meta,25,0,1,M.calculate).goal,0);
assert.ok(M.target(rows,'all','all',meta,25,15,1,M.calculate).reason);assert.ok(M.target(rows,'a','yellow',{},25,15,1,M.calculate).reason);assert.ok(M.target(rows,'a','yellow',meta,null,15,1,M.calculate).reason);
assert.strictEqual(M.target(rows.slice(0,2),'a','yellow',meta,25,15,1,M.calculate).opportunities.length,0);
assert.strictEqual(JSON.stringify(Array.from({length:10},(_,i)=>round(i))),before,'fixtures remain reproducible; models do not persist changes');const copy=JSON.stringify(rows);M.window(rows);M.target(rows,'a','yellow',meta,25,15,1,M.calculate);assert.strictEqual(JSON.stringify(rows),copy);
console.log('All Stats insight tests passed (score gaps vs causes, coverage, mixed tees, phases, target conversion, missing data and non-mutation).');
