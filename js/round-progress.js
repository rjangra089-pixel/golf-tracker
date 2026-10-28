// Read-only challenge and one-round reflection. No persistence or inferred tags.
function rpChallenge(plan, shots) {
 if (!plan || plan.length!==18) return {available:false};
 const played=plan.map((p,i)=>({...p,score:shots[i]?.score})).filter(h=>Number.isInteger(h.score)&&h.score>0);
 const hc=played.reduce((n,h)=>n+h.hcTarget,0), target=played.reduce((n,h)=>n+h.target,0),gross=played.reduce((n,h)=>n+h.score,0);
 return {available:true,holes:played.length,complete:played.length===18,gross,hc,target,saved:hc-gross,overTarget:gross-target,cuts:hc-target,
   afterSix:played.filter(h=>h.hole>6).length,roundHc:plan.reduce((n,h)=>n+h.hcTarget,0),roundTarget:plan.reduce((n,h)=>n+h.target,0)};
}
function rpSaved(n) {return n>0?n+' saved':n<0?Math.abs(n)+' over':'level';}
function rpTarget(n) {return n>0?n+' over':n<0?Math.abs(n)+' ahead':'level';}
function rpReflection(plan, shots) {
 const challenge=rpChallenge(plan,shots);
 const played=shots.map((s,i)=>({...s,hole:i+1,plan:plan?.[i],tags:crParseTags(s.tags??s.error_tags)})).filter(s=>Number.isInteger(s.score)&&s.score>0);
 const stacked=played.filter(s=>s.tags.length>=2).map(s=>s.hole);
 const putting=played.filter(s=>Number.isInteger(s.putts)&&s.putts>=0&&s.putts<=s.score);
 const three=putting.filter(s=>s.putts>=3).map(s=>s.hole);
 const ob=played.filter(s=>s.fairway==='X' && s.plan && s.plan.hcTarget-s.plan.shots>=4).map(s=>s.hole);
 const gaps=played.filter(s=>s.plan&&s.score>s.plan.hcTarget).map(s=>({hole:s.hole,over:s.score-s.plan.hcTarget,tags:s.tags}))
   .sort((a,b)=>b.over-a.over||a.hole-b.hole);
 const costly=gaps.filter(h=>h.over>=2);
 const counts=CR_TAG_ORDER.map(tag=>({tag,count:played.filter(h=>h.tags.includes(tag)).length})).sort((a,b)=>b.count-a.count);
 const actions={T:['Keep tee shots playable','Choose a club and start line with the widest safe landing area.'],A:['Choose safer approach targets','Aim at the widest safe part of the green, allowing for your usual miss.'],S:['Simplify the short-game shot','Choose the simplest shot that safely gets the ball onto the green.'],B:['Get out of the bunker safely','Choose a safe exit before trying to get close to the flag.'],P:['Commit to putting pace','On the first putt, choose your finishing zone and commit to the pace.']};
 let focus={title:'Repeat your routine',evidence:'No single pattern stands out in the recorded data from this round.',action:'Use PICK → SEE → GO before every committed shot next round.'};
 if(stacked.length) focus={title:'Break the error stack',evidence:'Multiple stroke-costing error types tagged on '+stacked.length+' hole'+(stacked.length===1?'':'s')+'.',action:'After a mistake, choose the safest route back into play. One mistake doesn’t get a friend.'};
 else if(ob.length>=2) focus={title:'Keep tee shots in play',evidence:ob.length+' tee shots recorded OB. This is not a penalty-stroke total.',action:'Choose the club and start line that give you the widest safe landing area.'};
 else if(three.length>=2) focus={title:'Cut the three-putts',evidence:three.length+' three-putt-or-more holes among '+putting.length+' with recorded putts.',action:'On long first putts, choose a finishing zone around the hole and prioritise pace.'};
 else if(counts[0].count>=2) focus={title:actions[counts[0].tag][0],evidence:counts[0].tag+' stroke-costing errors tagged on '+counts[0].count+' holes.',action:actions[counts[0].tag][1]};
 else if(costly.length>=2) focus={title:'Limit the expensive holes',evidence:costly.length+' holes finished at least two shots above HC Target'+(challenge.complete?' in this round.':' among the holes recorded so far.'),action:'When the safe route changes, reset your plan and take the simplest next shot.'};
 return {challenge,played:played.length,stacked,three,ob,puttingKnown:putting.length,gaps:gaps.slice(0,3),focus};
}
function rpRender(root, model, options={}) {
 root.replaceChildren();const add=(tag,cls,text,parent=root)=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;parent.append(e);return e;};
 const c=model.challenge;
 add('h3','rp-title',c.complete?'Your round in brief':'Round check-in · '+model.played+'/18 holes');
 if(!options.historical&&c.available&&c.holes){
   add('p','rp-challenge','HC Target: '+c.hc+' · Target: '+c.target+' · Actual: '+c.gross+(c.complete?'':' · scored holes only'));
   add('p','rp-result',rpSaved(c.saved)+' vs HC Target · '+rpTarget(c.overTarget)+' vs Target');
   add('p','rp-note',c.complete?'Five-shot goal: '+c.roundTarget+' gross. Holes 1–6 unchanged; five one-shot shifts after hole 6.':'Round goal '+c.roundTarget+' gross · result so far uses only the holes scored.');
 }
 if(options.historical) add('p','rp-note','Based on this round’s recorded data. The five-shot challenge is not scored retrospectively.');
 add('h4','rp-label','Biggest gaps to HC Target');
 add('p','rp-evidence',model.gaps.length?model.gaps.map(h=>'H'+h.hole+': +'+h.over+(h.tags.length?' · tagged '+h.tags.join('/'):' · no error tagged')).join(' · '):'No scored holes above HC Target'+(c.available?'.':' could be assessed: target data unavailable.'));
 add('p','rp-note','Score gaps describe outcomes, not their causes.');
 add('p','rp-evidence',model.stacked.length?'Error stacking: multiple types tagged on H'+model.stacked.join(', H')+'.':'No multiple error types tagged on a hole. Blank tags do not prove an error-free round.');
 add('p','rp-note','Putting recorded on '+model.puttingKnown+'/'+model.played+' scored holes · penalties and forced recoveries are not captured.');
 add('h4','rp-label','One focus for next round: '+model.focus.title);
 add('p','rp-evidence',model.focus.evidence);add('p','rp-action',model.focus.action);
}
