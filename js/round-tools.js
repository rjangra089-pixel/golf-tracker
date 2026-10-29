// Round management, immutable challenge snapshots and evidence-based course plans.
let roundChallengePlan=null, roundChallengeRecorded=false, roundShotNotes={}, roundDraftId=null;
let rtSwitchBusy=false;
const RT_NOTE='GT_CHALLENGE_V1:';
function rtSnapshot(plan,shots){return {v:1,shots,plan:plan.map(h=>({...h}))};}
function rtValidSnapshot(s){
 return s?.v===1&&Number.isInteger(s.shots)&&s.shots>=0&&s.shots<=12&&Array.isArray(s.plan)&&s.plan.length===18&&
 s.plan.every((h,i)=>h.hole===i+1&&Number.isInteger(h.si)&&h.si>=1&&h.si<=18&&Number.isInteger(h.shots)&&Number.isInteger(h.hcTarget)&&Number.isInteger(h.target)&&h.hcTarget-h.target===(h.shift?1:0)&&(!h.shift||i>=6))&&
 new Set(s.plan.map(h=>h.si)).size===18&&s.plan.filter(h=>h.shift).length===s.shots;
}
function rtReadNote(note){try{if(typeof note!=='string'||!note.startsWith(RT_NOTE))return null;const s=JSON.parse(note.slice(RT_NOTE.length));return rtValidSnapshot(s)?s:null;}catch(e){return null;}}
function rtRoundSnapshot(round){
 const snapshots=(round.shots||[]).map(s=>rtReadNote(s.notes)).filter(Boolean);
 if(!snapshots.length)return null;
 const first=JSON.stringify(snapshots[0]);return snapshots.every(s=>JSON.stringify(s)===first)?snapshots[0]:null;
}
function rtLivePlan(){return roundChallengePlan||buildCaddieTargets(HOLES,playingHC,roundChallengeShots);}
function rtShotNote(index){return roundChallengeRecorded&&roundChallengePlan?RT_NOTE+JSON.stringify(rtSnapshot(roundChallengePlan,roundChallengeShots)):(roundShotNotes[index]??null);}
function rtChallengeResult(round){
 const snapshot=rtRoundSnapshot(round);if(!snapshot||round.round_status==='in_progress')return null;
 const seen=new Set(),shots=round.shots||[];
 if(shots.length!==18||shots.some(s=>!Number.isInteger(s.hole_number)||s.hole_number<1||s.hole_number>18||seen.has(s.hole_number)||(seen.add(s.hole_number),false)||!Number.isInteger(s.score)||s.score<1))return null;
 const gross=shots.reduce((n,s)=>n+s.score,0),hc=snapshot.plan.reduce((n,h)=>n+h.hcTarget,0),target=snapshot.plan.reduce((n,h)=>n+h.target,0);
 return {shots:snapshot.shots,gross,hc,target,under:hc-gross,met:gross<=target};
}
function rtChallengeProgress(root,rounds){
 const card=stCard(root,'Your challenge','Uses the goal recorded when each round started. Older rounds without a recorded goal are not assigned one.');
 const results=rounds.map(rtChallengeResult).filter(Boolean);
 if(!results.length){card.append(stText('p','st-caption','No completed rounds with a recorded challenge yet. Your next round will start this history.'));return;}
 const atHC=results.filter(r=>r.gross<=r.hc).length,met=results.filter(r=>r.met).length;
 stPair(card,'At HC Target or better',atHC+' / '+results.length,'Compared with each round’s Playing HC allowance.');
 stPair(card,'Personal challenge met',met+' / '+results.length,'A lower gross score is better.');
 for(const n of [2,3,5])stPair(card,'At least '+n+' below HC',results.filter(r=>r.under>=n).length+' / '+results.length,'Against each round’s recorded HC Target.');
 for(const goal of [...new Set(results.map(r=>r.shots))].sort((a,b)=>a-b)){
  const group=results.filter(r=>r.shots===goal);stPair(card,goal+' below HC',group.filter(r=>r.met).length+' / '+group.length,'Rounds played with this original goal.');
 }
 card.append(stText('p','st-caption',(rounds.length-results.length)+' rounds in this window have no recorded challenge.'));
}
function rtCoursePlan(rows,id,tee){
 const rounds=rows.filter(r=>String(r.course_id)===String(id)&&r.tee_color===tee&&stComplete(r)&&stHandicap(r)).slice(0,10);
 if(rounds.length<3)return {rounds:rounds.length,holes:[]};
 const holes=[];
 for(let num=1;num<=18;num++){
  let excess=0,above=0;const tags={};
  for(const r of rounds){const h=stCourseMap(r).get(num),s=r.shots.find(s=>s.hole_number===num),hc=r.playing_handicap;
   const allowance=Math.floor(hc/18)+(h.si<=((hc%18+18)%18)?1:0),gap=s.score-h.par-allowance;
   excess+=Math.max(0,gap);if(gap>0)above++;
   for(const tag of parseErrorTags(s.error_tags))tags[tag]=(tags[tag]||0)+1;
  }
  if(above>=2)holes.push({hole:num,average:excess/rounds.length,above,tags});
 }
 holes.sort((a,b)=>b.average-a.average||b.above-a.above||a.hole-b.hole);
 return {rounds:rounds.length,holes:holes.slice(0,3)};
}
function rtPlanAction(tags){
 const actions={T:'Choose a tee club that keeps your usual miss in play.',A:'Aim for the centre of the green.',S:'Choose the simplest short-game shot to a safe landing area.',B:'After trouble, take the safest route back into play.',P:'Prioritise pace and a comfortable next putt.'};
 const repeat=Object.entries(tags).filter(([tag,n])=>actions[tag]&&n>=2).sort((a,b)=>b[1]-a[1]);
 return repeat.length?{evidence:repeat[0][0]+' error tagged in '+repeat[0][1]+' rounds',action:actions[repeat[0][0]]}:{evidence:'No repeated error tag establishes the cause',action:'Play to HC Target; after trouble, return safely to play.'};
}
async function rtRenderCoursePlan(){
 const root=document.getElementById('setup-course-plan');if(!root)return;
 const uid=currentUser?.id,id=courseId,tee=selectedTee,request=root.dataset.request=String((Number(root.dataset.request)||0)+1);
 root.replaceChildren(suEl('h3','','Your course plan'),suEl('p','su-hint','Loading your recorded rounds…'));
 try{
  const rows=await fetchStatsHistory(uid);
  if(currentUser?.id!==uid||courseId!==id||selectedTee!==tee||root.dataset.request!==request)return;
  const model=rtCoursePlan(stOrder(rows),id,tee);root.replaceChildren(suEl('h3','','Your course plan'));
  if(model.rounds<3){root.append(suEl('p','su-hint',model.rounds+'/3 complete rounds on these tees. A course plan appears after three.'));return;}
  root.append(suEl('p','su-hint','Based on your last '+model.rounds+' complete rounds on these tees. Gaps are shots above each round’s HC Target.'));
  if(!model.holes.length)root.append(suEl('p','su-hint','No hole was above HC Target in two or more rounds. Stick to PICK → SEE → GO.'));
  for(const h of model.holes){const a=rtPlanAction(h.tags),block=suEl('div','st-pair');block.append(suEl('strong','','Hole '+h.hole+' · '+h.average.toFixed(1)+' excess shots per round'),suEl('p','su-hint','Above HC Target in '+h.above+'/'+model.rounds+' rounds · '+a.evidence),suEl('p','',a.action));root.append(block);}
 }catch(e){if(root.dataset.request===request)root.replaceChildren(suEl('h3','','Your course plan'),suEl('p','su-hint','History unavailable. Retry by reopening Tee Off. Your round can still start.'));}
}
function rtDraftKey(){return 'gt_preserved_rounds_'+currentUser.id;}
function rtDrafts(){try{return JSON.parse(localStorage.getItem(rtDraftKey())||'{}');}catch(e){return {};}}
async function rtPreserveCurrent(){
 await roundSyncHoleChain;
 if(roundSyncBusy||setupRoundBusy)throw new Error('Wait for the current save to finish, then try again.');
 if(activeRoundId||(!completedRoundId&&holeData.some(h=>h.score))){
  saveRoundStateToStorage(false);
  const raw=localStorage.getItem(ROUND_STATE_KEY);if(!raw)throw new Error('Could not preserve this round on your device.');
  const state=JSON.parse(raw);if(state.syncUser!==currentUser.id)throw new Error('Sign in as the owner of this round.');
  if(state.activeRoundId!==activeRoundId||JSON.stringify(state.holeData)!==JSON.stringify(holeData))throw new Error('Your latest entries could not be preserved on this device. Keep this round open and retry saving.');
  const all=rtDrafts();state.draftId=state.draftId||roundDraftId||crypto.randomUUID();roundDraftId=state.draftId;
  all[state.activeRoundId||'local-'+state.draftId]=state;
  localStorage.setItem(rtDraftKey(),JSON.stringify(all));
 }
}
async function rtStartNew(){
 if(rtSwitchBusy)throw new Error('Wait for the round switch to finish.');rtSwitchBusy=true;
 try{
 await rtPreserveCurrent();
 // Existing queued operations retain their round IDs; do not replay into a new round.
 await flushWriteQueue();if(roundSyncQueue().length)throw new Error('Your pending changes are safe. Reconnect and sync before starting another round.');
 activeRoundId=null;completedRoundId=null;roundDraftId=null;roundChallengePlan=null;roundChallengeRecorded=false;roundShotNotes={};
 holeData=Array.from({length:18},()=>({score:null,putts:null,fairway:null,gir:null,tags:[]}));
 clearRoundStateFromStorage();showScreen('screen-setup');setupStatus('Previous rounds kept. Choose your course and tee off.');
 }finally{rtSwitchBusy=false;}
}
function rtResumeRollback(){
 const values=[activeRoundId,completedRoundId,currentHole,roundDate,playingHC,selectedTee,holeData,courseId,selectedCourseSlug,selectedCourseName,COURSE_PAR,COURSE_RATING,HOLES,holeIds,holeStats,setupTees,roundChallengeShots,roundChallengePlan,roundChallengeRecorded,roundShotNotes,roundDraftId,roundSyncHoles,roundSyncState,roundSyncLast,window._inProgressRound];
 const raw=localStorage.getItem(ROUND_STATE_KEY),screen=document.querySelector('.screen.active')?.id;
 return ()=>{
  [activeRoundId,completedRoundId,currentHole,roundDate,playingHC,selectedTee,holeData,courseId,selectedCourseSlug,selectedCourseName,COURSE_PAR,COURSE_RATING,HOLES,holeIds,holeStats,setupTees,roundChallengeShots,roundChallengePlan,roundChallengeRecorded,roundShotNotes,roundDraftId,roundSyncHoles,roundSyncState,roundSyncLast,window._inProgressRound]=values;
  if(raw)localStorage.setItem(ROUND_STATE_KEY,raw);else localStorage.removeItem(ROUND_STATE_KEY);
  document.getElementById('setup-course-select').value=selectedCourseSlug;document.getElementById('setup-course-tag').textContent=selectedCourseName;
  setupRefresh();renderStartMeta();if(screen)showScreen(screen);if(screen==='screen-play')renderHole(currentHole);
 };
}
async function rtResume(round){
 if(!round)throw new Error('Choose an unfinished round to resume.');
 if(rtSwitchBusy)throw new Error('Wait for the round switch to finish.');rtSwitchBusy=true;
 try{
 await rtPreserveCurrent();const rollback=rtResumeRollback();
 try{
  if(!round.local){const rows=await sbFetch('rounds?select=id,round_status&user_id=eq.'+encodeURIComponent(currentUser.id)+'&id=eq.'+encodeURIComponent(round.id));if(!rows?.[0]||rows[0].round_status!=='in_progress')throw new Error('This round is no longer unfinished. Open it in Stats.');}
  const saved=rtDrafts()[round.id];
  if(saved&&saved.syncUser===currentUser.id){
   if(round.round_status==='completed')throw new Error('This round is already completed. Open it in Stats.');
   await switchCourse(saved.selectedCourseSlug);if(selectedCourseSlug!==saved.selectedCourseSlug)throw new Error('The course could not load. Please retry.');
   await loadStats();
   localStorage.setItem(ROUND_STATE_KEY,JSON.stringify(saved));activeRoundId=null;completedRoundId=null;restoreRoundStateIfNeeded();return;
  }
  window._inProgressRound=round;await resumeRound();
 }catch(e){rollback();throw e;}
 }finally{rtSwitchBusy=false;}
}
async function openRoundManager(){
 const previous=document.getElementById('round-manager');if(previous?.open)return;previous?.remove();
 const uid=currentUser?.id;if(!uid)return;
 const d=suEl('dialog','su-finder');d.id='round-manager';d.setAttribute('aria-label','Manage your rounds');
 const close=suEl('button','st-button','Close');close.onclick=()=>{d.close();d.remove();};
 const title=suEl('h2','','Your rounds'),message=suEl('p','su-hint','Loading unfinished rounds…'),list=suEl('div','');
 const fresh=suEl('button','st-button','Start a new round');fresh.onclick=async()=>{fresh.disabled=true;try{await rtStartNew();d.close();d.remove();}catch(e){message.textContent=e.message;}finally{fresh.disabled=false;}};
 d.append(close,title,message,list,fresh);document.body.append(d);d.showModal();d.addEventListener('close',()=>d.remove());
 try{
  await rtPreserveCurrent();const rounds=[];
  for(let offset=0;;offset+=100){const page=await sbFetch('rounds?select=*,courses(name)&user_id=eq.'+encodeURIComponent(uid)+'&round_status=eq.in_progress&order=date.desc,id.desc&limit=100&offset='+offset);if(!Array.isArray(page))throw new Error('Could not load unfinished rounds.');rounds.push(...page.filter(r=>r.round_status==='in_progress'));if(page.length<100)break;}
  if(currentUser?.id!==uid||!d.isConnected)return;
  const drafts=rtDrafts(),seen=new Set(rounds.map(r=>r.id));
  for(const [id,state] of Object.entries(drafts))if(!seen.has(id)&&state.syncUser===uid){
   if(state.activeRoundId){const rows=await sbFetch('rounds?select=id,round_status&user_id=eq.'+encodeURIComponent(uid)+'&id=eq.'+encodeURIComponent(state.activeRoundId));if(rows?.[0]?.round_status==='completed')continue;}
   rounds.push({id,date:state.roundDate,round_status:'in_progress',courses:{name:state.selectedCourseSlug},local:true});
  }
  message.textContent=rounds.length?'Resume an unfinished round, or start another. Starting a new round keeps the others.':'No unfinished rounds. Ready for your next round.';
  for(const round of rounds){const item=suEl('section','profile-section'),label=suEl('p','',stDate(round.date)+' · '+(round.courses?.name||'Course not recorded')+(round.local?' · kept on this device':' · saved unfinished'));
   const resume=suEl('button','st-button','Resume');resume.onclick=async()=>{resume.disabled=true;try{await rtResume(round);d.close();d.remove();}catch(e){message.textContent=e.message;}finally{resume.disabled=false;}};item.append(label,resume);list.append(item);}
 }catch(e){message.textContent='Could not load all rounds. '+e.message;}
}
