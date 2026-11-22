// No live connections. Catalog imports use an in-memory database only.
const fs=require('fs'),path=require('path'),assert=require('assert'),R=path.resolve(__dirname,'../..');
const text=f=>fs.readFileSync(path.join(R,f),'utf8');
(async()=>{
 const {PORTUGAL_CARDS:cards,addPortugalCards}=await import(path.join(R,'lib/portugal-scorecards.mjs'));
 assert.deepStrictEqual(cards.map(c=>c.holes.length),[18,9,9,9]);
 const expected=[[5532,5212],[3241,3032],[3152,2943],[3122,2937]];
 for(const [j,c] of cards.entries()){
  const n=c.holes.length;assert.strictEqual(c.course.par,n===18?72:36);assert.strictEqual(new Set(c.holes.map(h=>h.stroke_index)).size,n);
  assert.deepStrictEqual(c.holes.map(h=>h.stroke_index).sort((a,b)=>a-b),Array.from({length:n},(_,i)=>i+1));
  for(const [t,k]of [['white',0],['yellow',1]])assert.strictEqual(c.holes.reduce((s,h)=>s+h.tee_options._layout[t+'_metres'],0),expected[j][k]);
  for(const h of c.holes)for(const t of ['white','yellow'])assert.strictEqual(h.tee_options[t].yardage,Math.round(h.tee_options._layout[t+'_metres']/.9144));
  if(n===9)assert.strictEqual(c.course.tee_options.yellow.rating,null);
 }
 assert.strictEqual(cards[2].holes[0].tee_options._layout.physical_hole,10);assert.strictEqual(cards[3].holes[8].tee_options._layout.physical_hole,27);
 let data={courses:[],holes:[],rounds:[{id:'untouched',score:95}],shots:[{id:'old-shot',score:2,putts:0}]},calls=[],failAt=1;
 const old=JSON.stringify([data.rounds,data.shots]);
 const db=async(url,opts={})=>{calls.push({url,...opts});assert.ok(!/^(rounds|shots)/.test(url));assert.ok(!opts.method||opts.method==='POST');const table=url.split('?')[0];
  if(opts.method==='POST'){if(table==='holes'&&failAt--===1)throw Error('interrupted');for(const row of [].concat(JSON.parse(opts.body)))if(!data[table].some(x=>x.id===row.id))data[table].push(row);return [];}
  if(table==='courses'){const ids=[...url.matchAll(/(?:id|slug)\.eq\.([^,)]+)/g)].map(m=>m[1]);return data.courses.filter(c=>ids.includes(c.id)||ids.includes(c.slug));}
  const id=url.split('course_id=eq.')[1];return data.holes.filter(h=>h.course_id===id);
 };
 await assert.rejects(addPortugalCards(db),/interrupted/);await addPortugalCards(db);await addPortugalCards(db);
 assert.strictEqual(data.courses.length,4);assert.strictEqual(data.holes.length,45);assert.strictEqual(JSON.stringify([data.rounds,data.shots]),old);
 // jsonb reorders object keys; it must still be a safe, idempotent match.
 data.holes.forEach(h=>h.tee_options=Object.fromEntries(Object.entries(h.tee_options).reverse()));await addPortugalCards(db);
 data.holes[0].par=5;const corrupt=JSON.stringify(data);await assert.rejects(addPortugalCards(db),/left untouched/);assert.strictEqual(JSON.stringify(data),corrupt);
 // Pure models: nine-hole HC allocation sums exactly to chosen allowance,
 // including plus handicaps, and nine-hole rounds never enter 18-hole averages.
 const inline=text('index.html');const fn=name=>inline.match(new RegExp('function '+name+'\\([\\s\\S]*?\\n\\}'))[0];
 const build=new Function(fn('buildCaddieTargets')+';return buildCaddieTargets;')();
 const model=new Function(text('js/coach-review.js')+'\n'+text('js/stats-model.js')+';return {stSummary,stComplete,stProgress,crBuildReview,crTotalsRows};')();
 const zones=new Function(text('js/scoring-zones.js')+';return {szPlan};')();
 const tools=new Function(text('js/round-tools.js')+';return {rtValidSnapshot};')();
 const editor=new Function(text('js/round-editor.js')+';return {roundEditTotals};')();
 for(const card of cards.slice(1)){
  const holes=card.holes.map(h=>({num:h.hole_number,par:h.par,si:h.stroke_index,siScale:9}));
  assert.deepStrictEqual(zones.szPlan(holes).reduce((g,h)=>(g[h.group]=(g[h.group]||0)+1,g),{}),{Harder:3,Medium:3,Easier:3});
  for(const hc of [-3,0,9,13,25]){
   const plan=build(holes,hc,0);assert.strictEqual(plan.reduce((s,h)=>s+h.shots,0),hc);assert.ok(tools.rtValidSnapshot({v:1,shots:0,plan}));
   const round={round_status:'completed',playing_handicap:hc,courses:{name:card.course.name,holes:card.holes},shots:card.holes.map(h=>({id:'shot-'+h.id,hole_number:h.hole_number,score:h.par+(plan[h.hole_number-1].shots),putts:0}))};
   const invalid={...round,shots:[...round.shots,...round.shots.map(s=>({...s,hole_number:s.hole_number+9}))]};assert.strictEqual(model.stComplete(invalid),false);
   assert.strictEqual(model.stSummary(round).points,18);assert.strictEqual(editor.roundEditTotals(round).stableford_points,18);assert.strictEqual(model.stComplete(round),false);assert.strictEqual(model.stProgress([round]).full,0);
   const review=model.crBuildReview({status:'completed',holes:card.holes,shots:round.shots});assert.strictEqual(review.holeCount,9);assert.strictEqual(review.standaloneNine,true);assert.match(model.crTotalsRows(review)[0].value,/9 holes/);
  }
  assert.strictEqual(build(holes,13,5),null);
 }
 // Endpoint checks the real signed-in user and admin before any catalog writes.
 let count=0;const handler=new Function('addPortugalCards',text('api/portugal-courses.js').replace("const {addPortugalCards}=await import('../lib/portugal-scorecards.mjs');",'').replace('export default async function handler','return async function handler'))(async()=>{count++;return [];});
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://mock.invalid';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='TEST';let admin=false;
 global.fetch=async(url)=>({ok:true,status:200,json:async()=>url.includes('/auth/')?{id:'owner'}:[{is_admin:admin}]});
 const run=async(req)=>{let code=200,result;await handler(req,{setHeader(){},status(n){code=n;return this;},json(v){result=v;}});return {code,result};};
 assert.strictEqual((await run({method:'GET',headers:{}})).code,405);assert.strictEqual((await run({method:'POST',headers:{}})).code,401);
 assert.strictEqual((await run({method:'POST',headers:{authorization:'Bearer TEST'}})).code,403);assert.strictEqual(count,0);admin=true;
 assert.strictEqual((await run({method:'POST',headers:{authorization:'Bearer TEST'}})).code,200);assert.strictEqual(count,1);
 console.log('All Portugal/nine-hole tests passed (45 verified holes, units, permissions, retry, no round access, SI allocation, editing, history separation).');
})().catch(e=>{console.error(e);process.exit(1);});
