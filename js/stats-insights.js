// Read-only analysis. Score gaps are outcomes; tags describe recorded causes.
function siAllowance(hc,si){return Math.floor(hc/18)+(si<=((hc%18+18)%18)?1:0);}
function siCard(r){const map=stCourseMap(r);return map&&new Set([...map.values()].map(h=>h.si)).size===18&&[...map.values()].every(h=>[3,4,5].includes(h.par))?map:null;}
function siWindow(rows){
 const full=rows.filter(stComplete),hcRows=full.filter(r=>Number.isInteger(r.playing_handicap)&&!!siCard(r));
 const scores=full.map(r=>stSummary(r).gross),errors=Object.fromEntries(ST_TAGS.map(t=>[t,0]));
 let gaps=0,expensive=0,stacked=0,tagged=0,puttsKnown=0,threePutts=0,teeKnown=0,teeTotal=0,ob=0;
 const phases=Array.from({length:3},()=>({gap:0,holes:0})),holes=new Map();
 for(const r of hcRows){const map=siCard(r);
  for(const s of r.shots){const h=map.get(s.hole_number),gap=s.score-h.par-siAllowance(r.playing_handicap,h.si),key=stCourseKey(r)+':'+stTeeKey(r)+':'+s.hole_number;
   gaps+=Math.max(0,gap);if(gap>=2)expensive++;
   const phase=phases[Math.floor((s.hole_number-1)/6)];phase.gap+=gap;phase.holes++;
   if(!holes.has(key))holes.set(key,{course:stCourseName(r),tee:stTeeKey(r),hole:s.hole_number,gap:0,above:0,rounds:0});
   const item=holes.get(key);item.gap+=Math.max(0,gap);if(gap>0)item.above++;item.rounds++;
  }
 }
 for(const r of full)for(const s of r.shots){const tags=crParseTags(s.error_tags);if(tags.length)tagged++;if(tags.length>=2)stacked++;tags.forEach(t=>{if(t in errors)errors[t]++;});
  if(stPuttsKnown(s)){puttsKnown++;if(s.putts>=3)threePutts++;}
  const h=stCourseMap(r).get(s.hole_number);if([4,5].includes(h.par)){teeTotal++;if(['C','L','R','X'].includes(s.fairway)){teeKnown++;if(s.fairway==='X')ob++;}}
 }
 return {rounds:full.length,hcRounds:hcRows.length,average:stMean(scores),spread:scores.length?Math.max(...scores)-Math.min(...scores):null,expensive,gaps,phases,errors,tagged,stacked,puttsKnown,threePutts,teeKnown,teeTotal,ob,
  trouble:[...holes.values()].filter(h=>h.rounds>=3&&h.above>=2).map(h=>({...h,average:h.gap/h.rounds})).sort((a,b)=>b.average-a.average||b.above-a.above||a.hole-b.hole).slice(0,3)};
}
function siAnalysis(rows,course,tee,window){
 const full=stSelect(rows,course,tee).filter(stComplete),played=window==='all'?full:full.slice(0,Number(window));
 const latest=full.slice(0,5),previous=full.slice(5,10),recent=siWindow(latest),prior=siWindow(previous);
 const comparable=full.length>=10&&new Set(full.slice(0,10).map(r=>stCourseKey(r)+':'+stTeeKey(r))).size===1&&latest.every(r=>stTeeKey(r)!=='unknown'&&stCourseKey(r)!=='unknown');
 return {current:siWindow(played),recent,prior,ten:full.length>=10,comparable};
}
function siTarget(rows,course,tee,meta,index,target,allowance,calculate){
 const rounds=stSelect(rows,course,tee).filter(stComplete).slice(0,10),map=rounds.length?siCard(rounds[0]):null;
 if(course==='all'||tee==='all'||tee==='unknown')return {reason:'Select one course and recorded tee to see the route to your target HC.'};
 if(!map)return {reason:'A complete, valid course scorecard is needed for this comparison.'};
 const par=[...map.values()].reduce((n,h)=>n+h.par,0),current=calculate(index,meta?.slope,meta?.rating,par,allowance),goal=calculate(target,meta?.slope,meta?.rating,par,allowance);
 if(current===null||goal===null)return {reason:'Handicap Index, target HI, or verified rating/slope is missing. No handicap allowance has been guessed.'};
 const currentCourse=calculate(index,meta.slope,meta.rating,par,1),goalCourse=calculate(target,meta.slope,meta.rating,par,1);
 const holes=[...map].sort((a,b)=>a[0]-b[0]).map(([num,h])=>{const avg=stMean(rounds.map(r=>r.shots.find(s=>s.hole_number===num).score)),tags={};for(const r of rounds)for(const tag of crParseTags(r.shots.find(s=>s.hole_number===num).error_tags))tags[tag]=(tags[tag]||0)+1;return {hole:num,par:h.par,current:h.par+siAllowance(current,h.si),target:h.par+siAllowance(goal,h.si),average:avg,gap:avg-(h.par+siAllowance(goal,h.si)),tags};});
 return {rounds:rounds.length,par,current,goal,currentCourse,goalCourse,currentGross:par+current,goalGross:par+goal,average:stMean(rounds.map(r=>stSummary(r).gross)),holes,opportunities:rounds.length>=3?holes.filter(h=>h.gap>0).sort((a,b)=>b.gap-a.gap||a.hole-b.hole).slice(0,3):[]};
}
function siRenderProgress(root){
 const model=siAnalysis(statsRows,statsState.course,statsState.tee,statsState.window),c=model.current;
 if(!c.rounds)return;
 const findings=stCard(root,'What your data says',c.rounds+' full rounds in the selected window. Observations, not measured strokes gained or a handicap forecast.');
 const lines=[];
 if(c.hcRounds)lines.push(c.expensive+' holes finished 2+ shots above HC Target across '+c.hcRounds+' rounds; '+(c.gaps/c.hcRounds).toFixed(1)+' positive score-gap shots per round. Under-target holes do not cancel those gaps.');
 if(c.trouble[0]){const h=c.trouble[0];lines.push(h.course+' · '+stTeeName(h.tee)+' · H'+h.hole+' is the largest repeated gap: '+h.average.toFixed(1)+' shots above HC Target per round, counting only positive gaps ('+h.above+'/'+h.rounds+' visits above target).');}
 if(model.comparable&&model.recent.puttsKnown===90&&model.prior.puttsKnown===90)lines.push('Three-putts: '+model.recent.threePutts+' in the last 5 vs '+model.prior.threePutts+' in the previous 5. Putting recorded on all 180 holes.');
 else if(c.puttsKnown)lines.push(c.threePutts+' three-putt-or-more holes among '+c.puttsKnown+'/'+(c.rounds*18)+' holes with putts recorded; unrecorded holes are unknown.');
 lines.slice(0,3).forEach(text=>findings.append(stText('p','st-caption',text)));
 if(!lines.length)findings.append(stText('p','st-caption','More recorded handicap and putting data is needed to identify patterns.'));
 const consistency=stCard(root,'Consistency','Score spread is highest minus lowest gross. Expensive holes are 2+ above that round’s HC Target (par plus saved Playing HC strokes).');
 stPair(consistency,'Score spread',c.spread+' shots',c.rounds+' full rounds · course and tee differences affect this figure.');
 stPair(consistency,'Expensive holes',c.hcRounds?(c.expensive/c.hcRounds).toFixed(1)+' / round':'Not available',c.expensive+' holes across '+c.hcRounds+'/'+c.rounds+' rounds with a valid Playing HC and stroke indexes.');
 if(model.ten){stPair(consistency,'Last 5 vs previous 5 · spread',model.recent.spread+' vs '+model.prior.spread+' shots',model.comparable?'Same course and recorded tees.':'Mixed or unknown courses/tees; descriptive only.');
  stPair(consistency,'Last 5 vs previous 5 · expensive holes',model.recent.hcRounds===5&&model.prior.hcRounds===5?(model.recent.expensive/5).toFixed(1)+' vs '+(model.prior.expensive/5).toFixed(1)+' / round':'Incomplete handicap coverage','Each hole uses its round’s saved Playing HC.');
 }else consistency.append(stText('p','st-caption','Ten full rounds are needed for a last-5 vs previous-5 comparison.'));
 const costs=stCard(root,'Where the score gaps are','These rank outcomes above HC Target, not the number of strokes caused by a particular error.');
 if(!c.trouble.length)costs.append(stText('p','st-caption','No repeat hole can be ranked yet. Need at least 3 visits on the same course and tees, with 2 visits above HC Target.'));
 c.trouble.forEach(h=>stPair(costs,h.course+' · '+stTeeName(h.tee)+' · Hole '+h.hole,h.average.toFixed(1)+' / round',h.above+'/'+h.rounds+' visits above HC Target · positive score gaps only.'));
 const causes=stCard(root,'Recorded causes and error stacking','One tag does not equal one lost shot. Missing tags do not prove error-free golf; there is no per-hole “all errors recorded” flag.');
 const names={T:'Tee',A:'Approach',S:'Short game',B:'Bunker',P:'Putting'};
 const entries=Object.entries(c.errors).sort((a,b)=>b[1]-a[1]);
 entries.forEach(([tag,count])=>{const trend=model.ten?' · last 5: '+model.recent.errors[tag]+'; previous 5: '+model.prior.errors[tag]+' (raw recorded counts)':'';stPair(causes,names[tag],String(count)+' tagged holes',c.rounds+' full rounds in window'+trend);});
 stPair(causes,'Stacked errors',String(c.stacked)+' holes','Two or more different error types tagged on the same hole. Categories can overlap.');
 stPair(causes,'Three-putts or more',String(c.threePutts)+' recorded',c.puttsKnown+'/'+(c.rounds*18)+' holes have putts recorded.');
 stPair(causes,'Tee shots marked OB',String(c.ob)+' recorded',c.teeKnown+'/'+c.teeTotal+' par-4/5 tee shots use C/L/R/X recording. Legacy Y/N and blanks do not establish OB. This is not total penalty strokes.');
 const phases=stCard(root,'Your round in three parts','Average score relative to HC Target per six holes. Negative is under target. This describes scoring; it does not establish fatigue or explain the cause.');
 c.phases.forEach((p,i)=>stPair(phases,['Holes 1–6','Holes 7–12','Holes 13–18'][i],p.holes?stSigned(p.gap/(p.holes/6))+' shots':'Not available',p.holes+' holes from '+c.hcRounds+' full rounds with handicap data.'));
}
function siRenderTarget(root){
 const course=statsState.courseView,tee=statsState.courseTee;
 const card=stCard(root,'Your route to target HC','A scoring allowance for planning, not an average target-handicap golfer’s score or a prediction of your future Handicap Index.');
 const allowance=Number(statsState.targetAllowance??1);
 stSelectControl(card,'Target comparison allowance',String(allowance),[['1','General play · 100%'],['0.95','Singles Stableford / stroke play · 95%']],v=>{statsState.targetAllowance=Number(v);statsRender();});
 const library=setupCourses.find(c=>String(c.id)===String(course)),meta=library?.tee_options?.[tee];
 const model=siTarget(statsRows,course,tee,meta,officialHI,toHandicap(targetHC),allowance,calculatePlayingHandicap);
 if(model.reason){card.append(stText('p','st-caption',model.reason));return;}
 stPair(card,'Current HI '+officialHI.toFixed(1),'Playing HC '+model.current,'Course Handicap '+model.currentCourse+' · '+Math.round(allowance*100)+'% allowance.');
 stPair(card,'Target HI '+toHandicap(targetHC).toFixed(1),'Playing HC '+model.goal,'Course Handicap '+model.goalCourse+' · '+Math.round(allowance*100)+'% allowance.');
 stPair(card,'Planning score',model.goalGross+' gross','Par '+model.par+' + target Playing HC '+model.goal+'; current allowance '+model.currentGross+' gross ('+(model.current-model.goal)+' shots difference).');
 stPair(card,'Your recent scoring',stFixed(model.average)+' gross',model.rounds+' complete rounds on these tees · '+stSigned(model.average-model.goalGross)+' vs target-HC allowance.');
 card.append(stText('p','st-caption','A golfer at your target HI will still have good and bad holes. This is not a strokes-gained comparison. Achieving an HI depends on qualifying Score Differentials. Your 2/3/5-below-current-HC challenge remains separate.'));
 const link=stText('a','st-caption','How Course and Playing Handicap are calculated (R&A Rule 6)');link.href='https://www.randa.org/roh/the-rules-of-handicapping/rule-6';link.target='_blank';link.rel='noopener noreferrer';card.append(link);
 const opportunities=stCard(root,'Biggest gaps to the target-HC plan','Your highest average score gaps on these tees. They are opportunities to investigate, not guaranteed recoverable shots.');
 if(!model.opportunities.length)opportunities.append(stText('p','st-caption',model.rounds<3?'Need 3 complete rounds on these tees before ranking opportunities.':'Your recorded averages have no positive gaps to this allowance.'));
 model.opportunities.forEach(h=>{const action=rtPlanAction(h.tags);stPair(opportunities,'Hole '+h.hole+' · Par '+h.par,stFixed(h.average)+' → '+h.target,'Your average → target-HC allowance · '+stFixed(h.gap)+' shots gap. '+action.evidence+'. '+action.action);});
 const table=stText('details','st-card');table.append(stText('summary','','All 18 holes · current and target allowances'));
 model.holes.forEach(h=>stPair(table,'Hole '+h.hole+' · Par '+h.par,'Target '+h.target,'Current-HC allowance '+h.current+' · your average '+stFixed(h.average)));root.append(table);
}
