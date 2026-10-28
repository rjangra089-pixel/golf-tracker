const fs=require('fs'),assert=require('assert'),vm=require('vm');
const src=fs.readFileSync(require('path').join(__dirname,'../../index.html'),'utf8');
const code=src.match(/async function cancelRound\(\) \{[\s\S]*?\n\}/)[0];
assert.ok(!/sbFetch|DELETE|\.delete\(/.test(code),'leave has no database mutation path');
(async()=>{
 for(const id of ['saved-completed','live-draft',null]){
  const events=[],ctx={activeRoundId:id,currentHole:12,roundDate:'2026-10-16',selectedCourseSlug:'richings',completedRoundId:null,roundSyncBusy:0,setupRoundBusy:false,holeData:[{score:5}],saveRoundStateToStorage:dirty=>events.push(['persist',dirty]),track:(e,p)=>events.push([e,p]),document:{getElementById:()=>null},showScreen:()=>{},loadHomeData:async()=>{}};
  vm.createContext(ctx);vm.runInContext(code,ctx);await ctx.cancelRound();
  assert.strictEqual(ctx.activeRoundId,id);assert.strictEqual(ctx.holeData[0].score,5);
  assert.strictEqual(events[1][0],'round_left');assert.strictEqual(events[1][1].hole,13);assert.strictEqual(events[1][1].round_id,id);
 }
 console.log('All cancel safety tests passed (no deletion path, stale completed IDs, draft preservation, accurate logging).');
})().catch(e=>{console.error(e);process.exit(1)});
