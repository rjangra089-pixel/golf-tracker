const fs=require('fs'),assert=require('assert'),vm=require('vm'),path=require('path');
const root=path.resolve(__dirname,'../..'),src=fs.readFileSync(path.join(root,'index.html'),'utf8');
const f=src.match(/function verifiedCourseData\(path, data\) \{[\s\S]*?\n\}/)[0];
const ctx={URLSearchParams};vm.createContext(ctx);vm.runInContext(f,ctx);
const pars=[4,4,5,4,4,3,4,4,4,4,3,3,4,3,5,4,4,4],si=[9,5,15,3,11,17,1,13,7,6,16,12,2,18,8,14,4,10];
const holes=pars.map((par,i)=>({id:'h'+i,hole_number:i+1,par,stroke_index:i+1,yardage:300}));
const query='holes?course_id=eq.c3066a9c-5067-47f5-9df8-99b515427b95';
const corrected=ctx.verifiedCourseData(query,holes);
assert.deepStrictEqual(Array.from(corrected,h=>h.stroke_index),si);
assert.deepStrictEqual(holes.map(h=>h.stroke_index),Array.from({length:18},(_,i)=>i+1),'input unchanged');
assert.deepStrictEqual(Array.from(corrected,h=>h.id),holes.map(h=>h.id));
assert.strictEqual(ctx.verifiedCourseData('holes?course_id=eq.other',holes).map(h=>h.stroke_index).join(','),holes.map(h=>h.stroke_index).join(','));
const rounds=[{total_score:90,stableford_points:30,shots:[{score:5}],courses:{name:'Ashford Manor Golf Club',holes}}];
const fixed=ctx.verifiedCourseData('rounds?select=*',rounds);
assert.deepStrictEqual(Array.from(fixed[0].courses.holes,h=>h.stroke_index),si);
assert.strictEqual(fixed[0].stableford_points,30);assert.strictEqual(fixed[0].shots[0].score,5);
assert.strictEqual(ctx.verifiedCourseData(query,corrected),corrected,'already-correct card untouched');
const other=holes.map(h=>({...h}));other[0].par=5;
assert.strictEqual(ctx.verifiedCourseData(query,other),other,'different layout untouched');
// Run actual admin save handler with invalid fields; validation must stop before any writes.
const admin=fs.readFileSync(path.join(root,'admin.html'),'utf8');
const handler=admin.match(/async function saveCourse\(\) \{[\s\S]*?\n\}/)[0];
(async()=>{
for(const invalid of ['', '2.5','19']){
 let message='';const env={document:{getElementById:id=>({value:id==='preview-name-input'?'Test':id==='preview-par-input'?'70':id.startsWith('ph-si-')?invalid:id.startsWith('ph-par-')?'4':'',checked:false})},setStatus:(id,state,text)=>message=text};
 vm.createContext(env);vm.runInContext(handler,env);await env.saveCourse();assert.match(message,/Complete every par and stroke index/);
}
console.log('All scorecard tests passed (verified correction, record preservation, admin missing/invalid SI).');
})().catch(e=>{console.error(e);process.exit(1)});
