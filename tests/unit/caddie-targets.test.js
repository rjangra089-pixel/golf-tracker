const fs=require('fs'),assert=require('assert');
const src=fs.readFileSync(require('path').join(__dirname,'../../index.html'),'utf8');
const code=src.match(/function buildCaddieTargets\(holes, handicap\) \{[\s\S]*?\n\}/)[0];
const build=new Function(code+';return buildCaddieTargets')();
const sis=[9,5,15,3,11,17,1,13,7,6,16,12,2,18,8,14,4,10];
const holes=sis.map((si,i)=>({par:i%3===0?3:4,si}));
const original=JSON.stringify(holes);
for(const hc of [-10,0,5,18,25,27,36,54,99]){
 const plan=build(holes,hc);
 assert.ok(plan.slice(0,6).every(h=>!h.shift && h.target===h.hcTarget));
 assert.strictEqual(plan.filter(h=>h.shift).length,5);
 assert.strictEqual(plan.reduce((n,h)=>n+h.hcTarget-h.target,0),5);
 assert.strictEqual(plan.reduce((n,h)=>n+h.hcTarget,0),holes.reduce((n,h)=>n+h.par,0)+hc);
 assert.ok(plan.every(h=>Number.isInteger(h.target) && h.target>=1));
 assert.strictEqual(JSON.stringify(holes),original,'no course mutation');
}
const p=build(holes,25);
assert.deepStrictEqual(p.filter(h=>h.shift).map(h=>h.hole),[7,9,10,13,17],'highest stroke buckets first, easiest SI within bucket');
assert.ok(p[0].shots===1 && p[0].hcTarget===4 && p[0].target===4);
assert.strictEqual(build(holes,25.5),null);
assert.strictEqual(build(holes.slice(1),25),null);
assert.strictEqual(build(holes.map(h=>({...h,si:1})),25),null);
console.log('All caddie target tests passed (five shots saved, holes 1–6 unchanged, stroke allocation, no mutations).');
