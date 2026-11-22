// App coaching framework: fixed SI groups, independent of any break-score goal.
const SZ_NOTE='GT_HOLE_V1:';
function szPlan(holes){
 if(!Array.isArray(holes)||![9,18].includes(holes.length)||new Set(holes.map(h=>h.si)).size!==holes.length||holes.some(h=>![3,4,5].includes(h.par)||!Number.isInteger(h.si)||h.si<1||h.si>holes.length))return null;
 const third=holes.length/3;
 return holes.map((h,i)=>({hole:i+1,par:h.par,si:h.si,shots:h.par-2,group:h.si>third*2?'Easier':h.si>third?'Medium':'Harder',zone:h.si>third*2?'green':h.si>third?'50':'100'}));
}
// Older shot rows can wrap a free-text note or a challenge snapshot.
function szReadNote(note){
 if(typeof note!=='string'||!note.startsWith(SZ_NOTE))return null;
 try{
  const data=JSON.parse(note.slice(SZ_NOTE.length));
  return data?.v===1?data:null;
 }catch(e){return null;}
}
function szUnwrapNote(note){
 const data=szReadNote(note);
 return data?(typeof data.note==='string'?data.note:null):note;
}

function szRows(rows){
 let penalties=0,penaltyHoles=0,inside=0,insideHoles=0,scored=0;
 for(const round of rows){
  if(round.round_status==='in_progress')continue;
  for(const shot of round.shots||[]){
   if(!Number.isInteger(shot.score)||shot.score<1)continue;
   scored++;
   const data=szReadNote(shot.notes);
   if(!data)continue;
   if(Number.isInteger(data.penalties)&&data.penalties>=0&&data.penalties<=99&&data.penalties<=shot.score){penalties+=data.penalties;penaltyHoles++;}
   if(Number.isInteger(data.inside100)&&data.inside100>=0&&data.inside100<=99&&data.inside100<=shot.score){inside+=data.inside100;insideHoles++;}
  }
 }
 return {penalties,penaltyHoles,inside,insideHoles,scored};
}
function szResults(root,rows){
 const m=szRows(rows);
 if(!m.penaltyHoles&&!m.insideHoles)return;
 const card=stCard(root,'Historical finishing stats','');
 stPair(card,'Penalty strokes',m.penaltyHoles?String(m.penalties):'Not recorded',m.penaltyHoles+'/'+m.scored+' scored holes recorded · included in gross.');
 stPair(card,'Strokes from inside 100y',m.insideHoles?(m.inside/m.insideHoles).toFixed(1)+' / hole':'Not recorded',m.insideHoles+'/'+m.scored+' scored holes recorded. Includes subsequent penalties.');
}
function szSetupPlan(){
 const root=document.getElementById('setup-zone-plan');if(!root)return;root.replaceChildren(suEl('h3','',HOLES.length===9?'Your 3×3×3 nine-hole plan':'Your 6×6×6 plan'));const plan=szPlan(HOLES);if(!plan){root.append(suEl('p','su-hint','Choose a complete course scorecard.'));return;}
 if(HOLES.length===9)root.append(suEl('p','su-hint','Nine-hole round: play to HC Target. Your 18-hole personal challenge is not applied.'));
 for(const [group,goal] of [['Easier','Green'],['Medium','Within 50y'],['Harder','Within 100y · keep it in play']])root.append(suEl('p','su-hint',group+' — holes '+plan.filter(h=>h.group===group).map(h=>h.hole).join(', ')+' · '+goal));
 root.append(suEl('p','su-hint','Aim to reach each target within par minus two strokes. Groups follow this course’s SI, not the order you play the holes.'));
}
