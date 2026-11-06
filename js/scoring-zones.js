// App coaching framework: fixed SI groups, independent of any break-score goal.
const SZ_NOTE='GT_HOLE_V1:';
const SZ_POSITIONS=['green','50','100','outside'];
function szPlan(holes){
 if(!Array.isArray(holes)||holes.length!==18||new Set(holes.map(h=>h.si)).size!==18||holes.some(h=>![3,4,5].includes(h.par)||!Number.isInteger(h.si)||h.si<1||h.si>18))return null;
 return holes.map((h,i)=>({hole:i+1,par:h.par,si:h.si,shots:h.par-2,group:h.si>=13?'Easier':h.si>=7?'Medium':'Harder',zone:h.si>=13?'green':h.si>=7?'50':'100'}));
}
function szDecode(note){
 const empty={note,position:null,penalties:null,inside100:null,par:null,si:null};
 try{if(typeof note!=='string'||!note.startsWith(SZ_NOTE))return empty;const s=JSON.parse(note.slice(SZ_NOTE.length));if(s.v!==1)return empty;
  return {note:typeof s.note==='string'?s.note:null,position:SZ_POSITIONS.includes(s.position)?s.position:null,penalties:Number.isInteger(s.penalties)&&s.penalties>=0&&s.penalties<=99?s.penalties:null,inside100:Number.isInteger(s.inside100)&&s.inside100>=0&&s.inside100<=99?s.inside100:null,par:[3,4,5].includes(s.par)?s.par:null,si:Number.isInteger(s.si)&&s.si>=1&&s.si<=18?s.si:null};
 }catch(e){return empty;}
}
function szEncode(base,d,h){
 const prior=szDecode(base),position=SZ_POSITIONS.includes(d.position)?d.position:null,penalties=Number.isInteger(d.penalties)?d.penalties:null,inside100=Number.isInteger(d.inside100)?d.inside100:null;
 if(position===null&&penalties===null&&inside100===null&&!String(base||'').startsWith(SZ_NOTE))return base;
 return SZ_NOTE+JSON.stringify({v:1,note:prior.note,position,penalties,inside100,par:h?.par??prior.par,si:h?.si??prior.si});
}
function szCheck(d){return ['penalties','inside100'].every(k=>d[k]===null||d[k]===undefined||Number.isInteger(d[k])&&d[k]>=0&&d[k]<=99&&(!d.score||d[k]<=d.score));}
function szRender(idx){
 const h=szPlan(HOLES)?.[idx],d=holeData[idx];
 document.getElementById('cb-zone-cue').textContent=h?h.group+' · '+(h.zone==='green'?'Green':h.zone==='50'?'Within 50y':'Within 100y')+' after shot '+h.shots+(h.group==='Harder'?' · Keep it in play':''):'Check the course scorecard';
 document.getElementById('zone-position-label').textContent='Position after shot '+(h?.shots??'—');
 document.querySelectorAll('[data-zone]').forEach(b=>b.setAttribute('aria-pressed',String(d.position===b.dataset.zone)));
 for(const k of ['penalties','inside100'])document.getElementById('entry-'+k).value=d[k]??'';
 document.getElementById('zone-entry-status').textContent=szCheck(d)?'':'Counts cannot exceed gross score. Correct the entries before saving.';
}
function szSetPosition(value){
 if(!SZ_POSITIONS.includes(value))return;
 const d=holeData[currentHole];d.position=d.position===value?null:value;
 if(d.position!==null)d.gir=d.position==='green';
 saveRoundStateToStorage();renderHole(currentHole);
}
function szSetCount(field,raw){
 if(!['penalties','inside100'].includes(field))return;
 const value=raw.trim()===''?null:Number(raw);if(value!==null&&(!Number.isInteger(value)||value<0||value>99)){document.getElementById('zone-entry-status').textContent='Enter a whole number from 0 to 99, or leave blank if unknown.';return;}
 holeData[currentHole][field]=value;saveRoundStateToStorage();szRender(currentHole);
}
function szRows(rows){
 const groups=['Easier','Medium','Harder'].map(name=>({name,recorded:0,met:0,holes:0}));let penalties=0,penaltyHoles=0,inside=0,insideHoles=0,scored=0;
 for(const r of rows){if(r.round_status==='in_progress')continue;for(const shot of r.shots||[]){if(!Number.isInteger(shot.score)||shot.score<1)continue;scored++;
  const d=szDecode(shot.notes);if(d.penalties!==null&&d.penalties<=shot.score){penalties+=d.penalties;penaltyHoles++;}if(d.inside100!==null&&d.inside100<=shot.score){inside+=d.inside100;insideHoles++;}
  if(d.par===null||d.si===null)continue;const g=groups[d.si>=13?0:d.si>=7?1:2];g.holes++;
  if(d.position!==null){g.recorded++;if(d.position==='green'||g.name==='Medium'&&d.position==='50'||g.name==='Harder'&&['50','100'].includes(d.position))g.met++;}
 }}return {groups,penalties,penaltyHoles,inside,insideHoles,scored};
}
function szResults(root,rows){
 const m=szRows(rows),card=stCard(root,'6×6×6 · Arrival and finishing','SI 13–18: green · SI 7–12: within 50y · SI 1–6: within 100y, after par minus 2 shots. Your app coaching plan; independent of breaking 100/90/80.');
 for(const g of m.groups)stPair(card,g.name,g.recorded?g.met+' / '+g.recorded+' met':'Not recorded','Recorded positions only. Earlier GIR entries do not fill in missing position data.');
 stPair(card,'Penalty strokes',m.penaltyHoles?String(m.penalties):'Not recorded',m.penaltyHoles+'/'+m.scored+' scored holes recorded · included in gross, never added twice.');
 stPair(card,'Strokes from inside 100y',m.insideHoles?(m.inside/m.insideHoles).toFixed(1)+' / hole':'Not recorded',m.insideHoles+'/'+m.scored+' scored holes recorded. Includes subsequent penalties. This overlaps other metrics; do not add the totals together.');
 card.append(stText('p','st-caption','Reaching a distance zone does not prove the ball stayed in play. No fixed finishing benchmark or handicap forecast is assigned.'));
}
function szSetupPlan(){
 const root=document.getElementById('setup-zone-plan');if(!root)return;root.replaceChildren(suEl('h3','','Your 6×6×6 plan'));const plan=szPlan(HOLES);if(!plan){root.append(suEl('p','su-hint','Choose a complete course scorecard.'));return;}
 for(const [group,goal] of [['Easier','Green'],['Medium','Within 50y'],['Harder','Within 100y · keep it in play']])root.append(suEl('p','su-hint',group+' — holes '+plan.filter(h=>h.group===group).map(h=>h.hole).join(', ')+' · '+goal));
 root.append(suEl('p','su-hint','Position after shot 1 on par 3s, shot 2 on par 4s, shot 3 on par 5s. Groups follow this course’s SI, not the order you play the holes.'));
}
