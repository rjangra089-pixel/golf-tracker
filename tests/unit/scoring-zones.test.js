const fs=require('fs'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../../js/scoring-zones.js'),'utf8');
const {szPlan,szUnwrapNote,szRows}=new Function(source+';return {szPlan,szUnwrapNote,szRows};')();
const holes=Array.from({length:18},(_,i)=>({par:3+i%3,si:18-i}));
const plan=szPlan(holes);
assert.deepStrictEqual([plan[0].group,plan[6].group,plan[12].group],['Easier','Medium','Harder']);
assert.strictEqual(szPlan(holes.map(h=>({...h,si:1}))),null);

const note='GT_HOLE_V1:'+JSON.stringify({v:1,note:'Original note',penalties:0,inside100:3});
assert.strictEqual(szUnwrapNote(note),'Original note');
assert.strictEqual(szUnwrapNote('Original note'),'Original note');
assert.strictEqual(szUnwrapNote('GT_HOLE_V1:broken'),'GT_HOLE_V1:broken');
const rounds=[{round_status:'completed',shots:[{score:6,notes:note},{score:5,notes:null}]}];
const copy=JSON.stringify(rounds);
assert.deepStrictEqual(szRows(rounds),{penaltyHoles:1,penalties:0,insideHoles:1,inside:3,scored:2});
assert.strictEqual(szRows([{...rounds[0],round_status:'in_progress'}]).scored,0);
assert.strictEqual(JSON.stringify(rounds),copy);
console.log('Scoring plan and historical shot notes passed.');
