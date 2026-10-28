// Tee-off UI and course finder. Searching and previewing never creates a round.
let setupCourses=[],setupTees={},setupLoading=false,setupRoundBusy=false,setupSwitchVersion=0,setupDialog=null,setupFindVersion=0,setupPendingCourse=null;
const suEl=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const teeLabel=(key,options=setupTees)=>options?.[key]?.name || String(key||'yellow').replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());
function setupStatus(text,error=false){const e=document.getElementById('setup-status');if(e){e.textContent=text;e.classList.toggle('is-error',error);} }
function setupRefresh(){
 const hero=document.getElementById('setup-course-meta');if(!hero)return;
 const c=setupCourses.find(c=>c.slug===selectedCourseSlug);
 hero.textContent=[c?.location,HOLES.length===18?'18 holes · Par '+HOLES.reduce((n,h)=>n+h.par,0)+' · '+teeLabel(selectedTee)+' tees':'Choose a complete scorecard'].filter(Boolean).join(' · ');
 document.getElementById('setup-player').textContent=playerName||'Your round';
 const buttons=document.getElementById('setup-tees');buttons.replaceChildren();
 const keys=Object.keys(setupTees).filter(k=>!k.startsWith('_'));
 (keys.length?keys:['yellow','white']).forEach(key=>{const b=suEl('button','tee-btn',teeLabel(key));b.type='button';b.id='tee-btn-'+key;b.setAttribute('aria-pressed',String(selectedTee===key));if(selectedTee===key)b.classList.add('is-selected');b.onclick=()=>selectTee(key);buttons.append(b);});
 const selected=setupTees[selectedTee];
 document.getElementById('setup-tee-meta').textContent=selected ? [selected.rating?'Rating '+selected.rating:null,selected.slope?'Slope '+selected.slope:null].filter(Boolean).join(' · ')||'Check your playing handicap against the club scorecard.':'Check your playing handicap against the club scorecard.';
 document.getElementById('setup-start').disabled=setupLoading||setupRoundBusy||HOLES.length!==18;
 const recent=document.getElementById('setup-recent');recent.replaceChildren();
 const ids=[...new Set((recentRounds||[]).map(r=>r.course_id))];
 const found=ids.map(id=>setupCourses.find(c=>c.id===id)).filter(Boolean).slice(0,3);
 document.getElementById('setup-recent-wrap').hidden=!found.length;
 found.forEach(c=>{const b=suEl('button','su-recent',c.name);b.type='button';b.setAttribute('aria-pressed',String(c.slug===selectedCourseSlug));b.onclick=()=>setupChooseCourse(c.slug);recent.append(b);});
}
async function setupChooseCourse(slug){
 if(activeRoundId&&localStorage.getItem(ROUND_STATE_KEY)){setupStatus('You already have a round in progress. Return Home to resume it.',true);return false;}
 document.getElementById('setup-course-select').value=slug;
 setupPendingCourse=switchCourse(slug); await setupPendingCourse;
 if(selectedCourseSlug!==slug||HOLES.length!==18)return false;
 localStorage.setItem('lastCourseSlug',slug);
 if(currentUser?.id)sbFetch('user_preferences?user_id=eq.'+currentUser.id,{method:'PATCH',body:JSON.stringify({last_course_slug:slug})}).catch(()=>{});
 setupRefresh();return true;
}
async function setupApi(action,data={}){
 const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)throw new Error('Please sign in again.');
 const r=await fetch('/api/courses'+(action==='import'?'':'?'+new URLSearchParams({action,...data})),{method:action==='import'?'POST':'GET',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},...(action==='import'?{body:JSON.stringify(data)}:{})});
 const result=await r.json();if(!r.ok)throw new Error(result.error||'Course search is unavailable.');return result;
}
function openCourseFinder(){
 if(setupDialog)return;
 const d=document.createElement('dialog');d.className='su-finder';d.setAttribute('aria-labelledby','su-find-title');
 d.innerHTML='<div class="su-dialog-head"><h2 id="su-find-title">Find your course</h2><button type="button" aria-label="Close course finder">×</button></div><p class="su-hint">Choose a course already in the app, or search for somewhere new.</p><form class="su-search"><label for="su-query">Course or club name</label><div><input id="su-query" type="search" autocomplete="off" placeholder="e.g. Hoebridge"><button type="submit">Search</button></div></form><p id="su-find-status" role="status" aria-live="polite"></p><div id="su-library"></div><div id="su-results"></div><div id="su-preview"></div>';
 setupDialog=d;document.body.append(d);d.showModal();
 const close=()=>{if(d.dataset.saving==='true')return;setupFindVersion++;setupDialog=null;d.close();d.remove();document.getElementById('setup-find').focus();};
 d.querySelector('.su-dialog-head button').onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();close();});
 const library=d.querySelector('#su-library'),results=d.querySelector('#su-results'),status=d.querySelector('#su-find-status');
 const showLibrary=()=>{library.replaceChildren(suEl('h3','','In the app'));const q=d.querySelector('input').value.trim().toLowerCase();const matches=setupCourses.filter(c=>(c.name+' '+(c.location||'')).toLowerCase().includes(q));
 matches.forEach(c=>{const b=suEl('button','su-course-result');b.type='button';b.append(suEl('strong','',c.name),suEl('span','',c.location||'Available in your course library'));b.onclick=async()=>{b.disabled=true;try{if(await setupChooseCourse(c.slug))close();else status.textContent=document.getElementById('setup-status').textContent;}finally{b.disabled=false;}};library.append(b);});
 if(!matches.length)library.append(suEl('p','su-hint','No matching courses in the app. Search to find a new one.'));};
 showLibrary();d.querySelector('input').oninput=showLibrary;
 d.querySelector('form').onsubmit=async e=>{e.preventDefault();const q=d.querySelector('input').value.trim();if(q.length<3){status.textContent='Enter at least 3 characters.';return;}
 const version=++setupFindVersion;status.textContent='Searching courses…';results.replaceChildren();d.querySelector('#su-preview').replaceChildren();
 const search=d.querySelector('form button');search.disabled=true;
 try{const data=await setupApi('search',{q});if(setupDialog!==d||version!==setupFindVersion)return;status.textContent=data.courses.length?data.courses.length+' results. Choose the correct club and course.':'No courses found. Try a shorter name or the club name.';
 results.append(suEl('h3','','Find a new course'));data.courses.forEach(c=>{const b=suEl('button','su-course-result');b.type='button';b.append(suEl('strong','',c.name),suEl('span','',c.location||'Location not listed'));b.onclick=()=>setupPreviewCourse(c.id,d);results.append(b);});
 }catch(err){if(setupDialog===d&&version===setupFindVersion)status.textContent=err.message;}finally{search.disabled=false;}};
}
async function setupPreviewCourse(id,d){
 const version=++setupFindVersion,status=d.querySelector('#su-find-status'),root=d.querySelector('#su-preview');status.textContent='Loading scorecards…';root.replaceChildren();
 try{const c=await setupApi('detail',{id});if(setupDialog!==d||version!==setupFindVersion)return;status.textContent='';
 root.append(suEl('h3','',c.name),suEl('p','su-hint',c.location));const label=suEl('label','su-field','Scorecard / tees'),select=document.createElement('select');select.setAttribute('aria-label','Course scorecard');
 c.choices.forEach(t=>{const o=suEl('option','',t.name+' · '+t.group+' · '+t.holes.length+' holes'+(!t.valid?' · incomplete':''));o.value=t.id;select.append(o);});label.append(select);root.append(label);
 const card=suEl('div','su-card-preview');root.append(card);const save=suEl('button','su-primary','Add course & use it');save.type='button';root.append(save);
 const draw=()=>{const t=c.choices.find(t=>t.id===select.value);card.replaceChildren();save.disabled=t?.holes.length!==18||!c.canImport;
 if(!t){card.append(suEl('p','su-hint','No scorecards are available for this course.'));return;}
 card.append(suEl('p','su-hint',t.valid?'18 holes · Par '+t.holes.reduce((n,h)=>n+h.par,0)+' · '+[t.rating?'Rating '+t.rating:null,t.slope?'Slope '+t.slope:null].filter(Boolean).join(' · '):'Some scorecard details are missing. Fill them in below from the club scorecard; stroke indexes must be unique from 1 to 18.'));
 const details=suEl('details','');details.open=!t.valid;details.append(suEl('summary','','Check / complete the scorecard'));
 const header=suEl('div','su-card-row');['Hole','Par','SI','Yards'].forEach(x=>header.append(suEl('span','',x)));details.append(header);
 t.holes.forEach((h,i)=>{const row=suEl('div','su-card-row');row.append(suEl('span','','H'+(i+1)));for(const key of ['par','stroke_index','yardage']){const input=document.createElement('input');input.type='number';input.inputMode='numeric';input.value=h[key]??'';input.min=key==='par'?'3':'1';input.max=key==='par'?'5':key==='stroke_index'?'18':'1000';input.step='1';input.placeholder='—';input.dataset.field=key;input.dataset.hole=i;input.setAttribute('aria-label','Hole '+(i+1)+' '+key.replace('_',' '));row.append(input);}details.append(row);});card.append(details);
 card.append(suEl('p','su-hint','Check these details against the club scorecard before adding. Only tees with matching pars and stroke indexes will share this course card.'));
 if(!c.canImport)card.append(suEl('p','su-hint','Adding new scorecards requires course-admin permission. You can select any course already in the app.'));
 };
 select.onchange=draw;draw();
 save.onclick=async()=>{d.dataset.saving='true';save.disabled=true;select.disabled=true;status.textContent='Adding course…';
 try{const holes=c.choices.find(t=>t.id===select.value).holes.map((h,i)=>Object.fromEntries(['par','stroke_index','yardage'].map(key=>{const raw=card.querySelector('[data-hole="'+i+'"][data-field="'+key+'"]').value.trim();return [key,raw===''?null:Number(raw)];})));
 if(holes.length!==18||holes.some(h=>![3,4,5].includes(h.par)||!Number.isInteger(h.stroke_index)||h.stroke_index<1||h.stroke_index>18)||new Set(holes.map(h=>h.stroke_index)).size!==18)throw new Error('Please complete all pars and stroke indexes (unique 1–18) using the club scorecard.');
 const added=await setupApi('import',{id,tee:select.value,holes});await loadCourseData(false);const ok=await setupChooseCourse(added.slug);if(!ok)throw new Error(document.getElementById('setup-status').textContent||'The course was added. Choose it from the course list.');selectTee(added.tee);setupDialog=null;d.close();d.remove();setupStatus(added.existing?'Course already in the app — ready to play.':'Course added — ready to play.');}
 catch(e){status.textContent=e.message;save.disabled=false;select.disabled=false;}finally{d.dataset.saving='false';}};
 root.scrollIntoView({block:'start',behavior:'smooth'});
 }catch(e){if(setupDialog===d&&version===setupFindVersion)status.textContent=e.message;}
}
