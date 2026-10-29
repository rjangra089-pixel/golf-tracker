// Stats UI: read-only history, isolated filters, and explicit data coverage.
let statsRows = [], statsOwner = null, statsRequest = 0;
let statsState = {tab:'progress', course:'all', tee:'all', window:5, courseView:null, courseTee:'all', search:'', shown:25};
const stText = (tag, cls, text) => {const el=document.createElement(tag); if(cls) el.className=cls; if(text !== undefined) el.textContent=text; return el;};
const stFixed = n => n === null ? '—' : n.toFixed(1);
const stDate = value => crFormatDate(value) || 'Date not recorded';
const stTeeName = value => value === 'unknown' ? 'Tees not recorded' : value.replace(/-/g,' ').replace(/^./,c=>c.toUpperCase())+' tees';
const stSigned = n => (n>0?'+':'')+n.toFixed(1);

async function fetchStatsHistory(uid) {
    if (!uid) throw new Error('Please sign in to view your rounds.');
    const rows = [], pageSize = 100;
    for (let offset=0; ; offset+=pageSize) {
        if (currentUser?.id!==uid) throw new Error('Account changed. Please sign in again.');
        const page = await sbFetch('rounds?select=*,shots(*),courses(id,name,holes(hole_number,par,stroke_index))'
            + '&user_id=eq.'+encodeURIComponent(uid)+'&order=date.desc,created_at.desc,id.desc&limit='+pageSize+'&offset='+offset);
        if (!Array.isArray(page)) throw new Error('Your round history could not be loaded.');
        rows.push(...page);
        if (page.length<pageSize) return rows;
    }
}

// Live caddie averages remain tied to the ACTIVE course, never the Stats filters.
function statsUpdateCaddie() {
    const holes = stCourseHoles(statsRows, String(courseId ?? 'unknown'));
    holeStats = holes.map((h,i) => ({...h, par:HOLES[i]?.par ?? 4, si:HOLES[i]?.si ?? i+1,
        scores:[], putts:[], targetScore:(HOLES[i]?.par ?? 4)+Math.floor(targetHC/18)+((HOLES[i]?.si ?? i+1)<=targetHC%18?1:0)}));
}

async function loadStats() {
    const uid = currentUser?.id, request = ++statsRequest;
    const scroll = document.getElementById('stats-scroll');
    scroll.replaceChildren(stText('p','st-message','Loading your rounds…'));
    if (uid !== statsOwner) {
        statsRows=[]; statsOwner=uid;
        statsState={tab:'progress',course:'all',tee:'all',window:5,courseView:null,courseTee:'all',search:'',shown:25};
    }
    try {
        const rows = await fetchStatsHistory(uid);
        if (request!==statsRequest || currentUser?.id!==uid) return;
        statsRows=stOrder(rows);
        statsUpdateCaddie();
        const courses=statsCourses();
        if (!courses.some(c=>c.id===statsState.courseView)) statsState.courseView=courses.some(c=>c.id===String(courseId))?String(courseId):courses[0]?.id;
        if (statsState.course!=='all' && !courses.some(c=>c.id===statsState.course)) {statsState.course='all'; statsState.tee='all';}
        document.getElementById('stats-sub').textContent=statsRows.filter(stComplete).length+' full rounds · '+statsRows.length+' records in history';
        statsRender();
    } catch(e) {
        if (request!==statsRequest || currentUser?.id!==uid) return;
        statsRows=[]; holeStats=[];
        document.getElementById('stats-sub').textContent='Your history is unavailable';
        const retry=stText('button','st-button','Try again'); retry.type='button'; retry.onclick=()=>loadStats();
        scroll.replaceChildren(stText('h2','st-section-title','Could not load Stats'),stText('p','st-message','Check your connection and try again. Your saved rounds have not changed.'),retry);
    }
}

function statsCourses() {
    const courses=new Map();
    statsRows.forEach(r=>{const id=stCourseKey(r); if(!courses.has(id)) courses.set(id,{id,name:stCourseName(r)});});
    return [...courses.values()].sort((a,b)=>a.name.localeCompare(b.name));
}

function statsTab(tab, focus=false) {
    if (!['progress','courses','rounds'].includes(tab)) return;
    statsState.tab=tab; statsRender();
    if(focus) document.getElementById('st-tab-'+tab).focus({preventScroll:true});
    document.getElementById('stats-scroll').scrollTop=0;
    document.getElementById('screen-stats').scrollTop=0;
}

function statsRender() {
    document.querySelectorAll('#stats-tabs [role="tab"]').forEach(button=>{
        const selected=button.dataset.tab===statsState.tab;
        button.setAttribute('aria-selected',String(selected)); button.tabIndex=selected?0:-1;
        button.onclick=()=>statsTab(button.dataset.tab);
        button.onkeydown=e=>{
            const names=['progress','courses','rounds'], current=names.indexOf(button.dataset.tab);
            const next=e.key==='ArrowRight'?(current+1)%3:e.key==='ArrowLeft'?(current+2)%3:e.key==='Home'?0:e.key==='End'?2:null;
            if(next!==null){e.preventDefault();statsTab(names[next],true);}
        };
    });
    const root=document.getElementById('stats-scroll');
    root.setAttribute('aria-labelledby','st-tab-'+statsState.tab); root.replaceChildren();
    if(statsState.tab==='progress') statsRenderProgress(root);
    else if(statsState.tab==='courses') statsRenderCourses(root);
    else statsRenderRounds(root);
}

function stCard(root,title,sub) {
    const card=stText('section','st-card'); card.append(stText('h2','st-section-title',title));
    if(sub) card.append(stText('p','st-caption',sub)); root.append(card); return card;
}
function stSelectControl(parent,label,value,options,change) {
    const wrapper=stText('label','st-field'), select=document.createElement('select');
    const visibleLabel={'Progress course':'Course','Progress tees':'Tees','Analysis window':'Rounds','Course to explore':'Course','Course tees':'Tees'}[label] || label;
    wrapper.append(stText('span','',visibleLabel)); select.setAttribute('aria-label',label);
    options.forEach(([v,text])=>{const o=stText('option','',text);o.value=v;select.append(o);}); select.value=String(value);
    select.onchange=()=>{
        change(select.value);
        const next=[...document.querySelectorAll('#stats-scroll select')].find(el=>el.getAttribute('aria-label')===label);
        next?.focus({preventScroll:true});
    };wrapper.append(select);parent.append(wrapper);return select;
}
function stMetric(parent,label,value,sub) {
    const el=stText('div','st-metric'); el.append(stText('dt','',label),stText('dd','st-value',value),stText('div','st-caption',sub));parent.append(el);
}
function stPair(parent,label,value,detail) {
    const el=stText('div','st-pair'); const text=stText('div','');text.append(stText('h3','',label));if(detail)text.append(stText('p','st-caption',detail));
    el.append(text,stText('strong','',value));parent.append(el);
}
function stFilters(root) {
    const controls=stText('div','st-filters');root.append(controls);
    stSelectControl(controls,'Progress course',statsState.course,[['all','All courses'],...statsCourses().map(c=>[c.id,c.name])],v=>{statsState.course=v;statsState.tee='all';statsRender();});
    const tees=[...new Set(stSelect(statsRows,statsState.course).map(stTeeKey))].sort();
    stSelectControl(controls,'Progress tees',statsState.tee,[['all','All recorded tees'],...tees.map(t=>[t,stTeeName(t)])],v=>{statsState.tee=v;statsRender();});
    stSelectControl(controls,'Analysis window',statsState.window,[['5','Last 5 full rounds'],['10','Last 10 full rounds'],['all','All full rounds']],v=>{statsState.window=v;statsRender();});
}

function statsRenderProgress(root) {
    stFilters(root);
    const p=stProgress(statsRows,statsState.course,statsState.tee,statsState.window);
    rtChallengeProgress(root,p.played);
    if(!p.full){stCard(root,'Your progress starts here','No complete 18-hole rounds match these filters yet. Nine-hole, partial and in-progress rounds remain available in Rounds.');return;}
    const sample=p.played.length+' complete 18-hole round'+(p.played.length===1?'':'s');
    const period=stDate(p.played[p.played.length-1].date)+' – '+stDate(p.played[0].date);
    root.append(stText('p','st-caption',sample+' · '+period+(p.excluded?' · '+p.excluded+' other record'+(p.excluded===1?'':'s')+' excluded from averages.':'.')));
    const summary=stCard(root,'Scoring progress','Gross scores from completed holes. These figures are not a Handicap Index or Score Differential.');
    const grid=stText('dl','st-metrics');summary.append(grid);
    stMetric(grid,'Average gross',stFixed(p.average),sample);
    stMetric(grid,'Highest gross',p.highest===null?'—':String(p.highest),'Upper end of your scores in this window');
    const compare=stText('div','st-compare');summary.append(compare);
    if(p.previousAvg===null) compare.append(stText('p','st-caption','Last 5 vs previous 5: '+p.full+'/10 full rounds available. A comparison appears once 10 exist in these filters.'));
    else {
        stPair(compare,'Last 5 vs previous 5',stFixed(p.recentAvg)+' vs '+stFixed(p.previousAvg),'Average gross · '+(p.delta===0?'No change':Math.abs(p.delta).toFixed(1)+' shots '+(p.delta<0?'lower':'higher')));
        stPair(compare,'Highest score in each five',String(p.recentHigh)+' vs '+p.previousHigh,'Last 5 vs previous 5 · watch whether your higher scores come down');
        compare.append(stText('p','st-caption',p.comparable?p.direction+' · Same course and recorded tees.':'Mixed or unrecorded courses/tees. This is a descriptive comparison; select one course and tee for a clearer trend.'));
    }
    statsScoreChart(summary,p.played.slice(0,10));
    const leaks=stCard(root,'Scoring leaks','Rates per full round, using each round’s saved playing handicap and course.');
    for(const [label,metric] of [['Zero-point holes',p.zero],['Three-putts',p.threePutts],['Tee shots OB',p.ob]]) {
        stPair(leaks,label,metric.rate===null?'Not enough data':metric.rate.toFixed(1)+' / round',metric.eligible+'/'+metric.window+' rounds with all required data'+(metric.rate===null?' · need 3': ' · '+metric.total+' recorded'));
    }
    leaks.append(stText('p','st-caption','A zero-point hole is the blow-up measure used on Home. Tee shots OB are not a total penalty count.'));
    const errors=stCard(root,'Recorded error tags','Your manually recorded tags, counted by hole. They are not measured strokes lost.');
    const tags=stText('div','st-tag-grid');errors.append(tags);
    const names={T:'Tee',A:'Approach',S:'Short game',B:'Bunker',P:'Putting'};
    p.errors.forEach(e=>{const item=stText('div','st-tag-count');item.append(stText('strong','',e.tag),stText('span','',e.rounds?String(e.count):'—'),stText('span','st-caption',names[e.tag]),stText('span','st-caption',e.rounds?e.rounds+'/'+p.played.length+' rounds eligible':'Not captured'));tags.append(item);});
    errors.append(stText('p','st-caption','A blank tag does not prove an error-free hole. Older rounds may predate tagging.'));
    const details=stText('details','st-card');details.append(stText('summary','','Putting, GIR and fairways'));
    const s=p.supporting;
    stPair(details,'Average total putts',stFixed(s.putts),s.puttRounds+'/'+p.played.length+' rounds with all 18 putt counts · zero putts included');
    stPair(details,'Greens in regulation',s.girRecorded?Math.round(s.gir/s.girRecorded*100)+'%':'—',s.gir+'/'+s.girRecorded+' recorded greens hit · '+s.girRecorded+'/'+s.holes+' holes recorded');
    stPair(details,'Fairways hit',s.fairwaysRecorded?Math.round(s.fairways/s.fairwaysRecorded*100)+'%':'—',s.fairways+'/'+s.fairwaysRecorded+' recorded fairways hit · '+s.fairwaysRecorded+'/'+s.teeHoles+' par-4/5 tee shots recorded');
    details.append(stText('p','st-caption','Missing values are excluded, not treated as misses. Total putts also depend on where approaches and chips finish.'));root.append(details);
}

function statsScoreChart(root, newest) {
    const rows=[...newest].reverse(), scores=rows.map(r=>stSummary(r).gross);
    const box=stText('figure','st-trend');box.append(stText('figcaption','st-caption','Gross scores · oldest → newest · '+rows.length+' rounds'));
    if(rows.length<2){box.append(stText('p','st-caption','A scoring chart appears after two full rounds.'));root.append(box);return;}
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 320 110');svg.setAttribute('role','img');svg.setAttribute('aria-label','Gross scores, oldest to newest: '+scores.join(', ')+'. Lower is better.');
    const lo=Math.min(...scores)-2,hi=Math.max(...scores)+2,coords=scores.map((n,i)=>[20+i*280/(scores.length-1),88-(n-lo)/(hi-lo)*60]);
    const line=document.createElementNS(ns,'polyline');line.setAttribute('points',coords.map(p=>p.join(',')).join(' '));line.setAttribute('class','st-trend-line');svg.append(line);
    rows.forEach((r,i)=>{const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',coords[i][0]);dot.setAttribute('cy',coords[i][1]);dot.setAttribute('r','4');const title=document.createElementNS(ns,'title');title.textContent=stDate(r.date)+' · '+stCourseName(r)+' · '+stTeeName(stTeeKey(r))+' · '+scores[i]+' gross';dot.append(title);svg.append(dot);
        const text=document.createElementNS(ns,'text');text.setAttribute('x',coords[i][0]);text.setAttribute('y',coords[i][1]-9);text.textContent=scores[i];svg.append(text);});
    box.append(svg,stText('p','st-caption','Lower is better. Course and tee changes affect gross scores. No future scores are projected.'));root.append(box);
}

function statsRenderCourses(root) {
    const courses=statsCourses(), controls=stText('div','st-filters');root.append(controls);
    if(!courses.length){stCard(root,'No course history yet','Your saved rounds will appear here after you play.');return;}
    stSelectControl(controls,'Course to explore',statsState.courseView,courses.map(c=>[c.id,c.name]),v=>{statsState.courseView=v;statsState.courseTee='all';statsRender();});
    const tees=[...new Set(stSelect(statsRows,statsState.courseView).map(stTeeKey))].sort();
    stSelectControl(controls,'Course tees',statsState.courseTee,[['all','All recorded tees'],...tees.map(t=>[t,stTeeName(t)])],v=>{statsState.courseTee=v;statsRender();});
    const holes=stCourseHoles(statsRows,statsState.courseView,statsState.courseTee), count=holes[0].count;
    root.append(stText('p','st-caption',count+' complete 18-hole rounds · Each round uses its own course data. Nine-hole, partial and in-progress rounds are excluded.'));
    const danger=stCard(root,'Recurring trouble holes',count<3?'Play at least 3 full rounds on this course and tee selection to identify repeat trouble holes.':'Ranked by zero-point frequency, then average score relative to par. These are observations, not measured strokes lost.');
    stTroubleHoles(holes).forEach(h=>statsHoleCard(danger,h));
    if(!count) return;
    const all=stText('details','st-card');all.append(stText('summary','','All 18 holes'));holes.forEach(h=>statsHoleCard(all,h));root.append(all);
}
function statsHoleCard(root,h) {
    const card=stText('article','st-hole');card.append(stText('h3','','Hole '+h.num+' · Par '+h.pars.join('/')));
    card.append(stText('p','st-caption',h.count+' rounds · Average '+stFixed(h.avg)+' gross ('+stSigned(h.relative)+' vs par)'));
    stPair(card,'Zero-point holes',h.zeroRecorded?h.zero+'/'+h.zeroRecorded:'—','Rounds with a recorded playing handicap');
    stPair(card,'Three-putts',h.puttsRecorded?h.threePutts+'/'+h.puttsRecorded:'—','Holes with putts recorded');
    stPair(card,'Tee shots OB',h.teeRecorded?h.ob+'/'+h.teeRecorded:'—',h.pars.every(p=>p===3)?'Not applicable on a par 3':'Recorded par-4/5 tee shots');root.append(card);
}

function statsRenderRounds(root) {
    const head=stCard(root,'Round history','Full, nine-hole, partial and in-progress records. Review or correct a saved round here.');
    const ai=stText('button','st-button','AI debrief · Latest full round');ai.id='btn-review-round';ai.type='button';ai.onclick=()=>openAssessment('screen-stats');head.append(ai);
    const label=stText('label','st-field');label.append(stText('span','','Find a round'));
    const search=document.createElement('input');search.type='search';search.placeholder='Course or date';search.value=statsState.search;search.setAttribute('aria-label','Find a round');label.append(search);root.append(label);
    const list=stText('div','st-round-list');root.append(list);
    const renderList=()=>{
        const q=statsState.search.trim().toLowerCase();
        const rows=statsRows.filter(r=>!q || (stCourseName(r)+' '+(r.date||'')+' '+stDate(r.date)).toLowerCase().includes(q));
        list.replaceChildren(stText('p','st-caption',rows.length+' matching round'+(rows.length===1?'':'s')));
        rows.slice(0,statsState.shown).forEach(r=>statsRoundCard(list,r));
        if(!rows.length) list.append(stText('p','st-message',statsRows.length?'No rounds match this course or date.':'No rounds saved yet.'));
        if(rows.length>statsState.shown){const more=stText('button','st-button','Show more rounds');more.type='button';more.onclick=()=>{statsState.shown+=25;renderList();};list.append(more);}
    };
    search.oninput=()=>{statsState.search=search.value;statsState.shown=25;renderList();};renderList();
}
function statsRoundCard(root,r) {
    const summary=stSummary(r),date=stDate(r.date),card=stText('article','round-history-item st-round');
    const left=stText('div','rhi-left');left.append(stText('h3','rhi-date',date),stText('p','rhi-sub',stCourseName(r)+' · '+stTeeName(stTeeKey(r))));
    const kind=r.round_status==='in_progress'?'In progress':summary.shape==='full'?'18 holes':summary.shape==='front'?'Front 9':summary.shape==='back'?'Back 9':'Partial';
    left.append(stText('p','st-caption',kind+' · '+summary.holes+' scored holes · Playing handicap '+(stHandicap(r)?r.playing_handicap:'not recorded')));card.append(left);
    if(!stCourseMap(r)) left.append(stText('p','st-caption','Course data unavailable · excluded from Progress'));
    const numbers=stText('div','st-round-numbers');const score=stText('span','rhi-score',summary.gross===null?'—':String(summary.gross));score.setAttribute('aria-label',(summary.gross??'Unknown')+' gross');
    numbers.append(score,stText('span','st-caption','gross'),stText('span','rhi-pts',summary.points===null?'Points unavailable':summary.points+' pts'));
    numbers.append(stText('span','st-caption',summary.putts===null?'Putts incomplete':summary.putts+' putts'));card.append(numbers);
    const challenge=rtChallengeResult(r);left.append(stText('p','st-caption',challenge?challenge.shots+' below HC goal · '+rpTarget(challenge.gross-challenge.target)+' Challenge Target':'Challenge goal not recorded'));
    const actions=stText('div','st-round-actions');card.append(actions);
    if(r.round_status==='in_progress'){const resume=stText('button','st-button rhi-resume','Resume');resume.type='button';resume.onclick=()=>rtResume(r).catch(e=>alert(e.message));actions.append(resume);}
    if(r.round_status!=='in_progress' && r.shots?.length) {
        const editBtn=stText('button','rhi-edit','Edit');editBtn.type='button';editBtn.setAttribute('aria-label','Edit round for '+date);
        editBtn.addEventListener('click', () => openRoundEdit(r.id));actions.append(editBtn);
    }
    if(r.round_status!=='in_progress' && ['full','front','back'].includes(summary.shape)) {
        const reviewBtn=stText('button','rhi-review','Review');reviewBtn.type='button';reviewBtn.setAttribute('aria-label','Coach review for '+date);reviewBtn.onclick=()=>openRoundReview(r.id);actions.append(reviewBtn);
    }
    const more=stText('details','st-round-more');more.append(stText('summary','','More'));
    const del=stText('button','rhi-delete st-delete','Delete round');del.type='button';del.setAttribute('aria-label','Delete round for '+date);del.onclick=()=>confirmDelete(r.id,date);more.append(del);actions.append(more);root.append(card);
}
