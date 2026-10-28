import { createHash } from 'node:crypto';
const clean=v=>String(v??'').trim().slice(0,180);
const num=v=>v===null||v===undefined||v===''?null:Number(v);
const slug=v=>clean(v).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const cache=new Map();
const requests=new Map();
export function describeCourse(raw) {
 const c=raw.course||raw, names=[clean(c.club_name),clean(c.course_name)].filter(Boolean);
 const name=[...new Set(names)].join(' — ')||'Unnamed course';
 const choices=[];
 for(const [gender,group] of [['male','Men'],['female','Women']]) (c.tees?.[gender]||[]).forEach((t,i)=>{
  const holes=(t.holes||[]).map((h,j)=>({hole_number:num(h.hole_number??h.hole??j+1),par:num(h.par),stroke_index:num(h.handicap),yardage:num(h.yardage)})).sort((a,b)=>a.hole_number-b.hole_number);
  const valid=holes.length===18&&holes.every((h,j)=>h.hole_number===j+1&&[3,4,5].includes(h.par)&&Number.isInteger(h.stroke_index)&&h.stroke_index>=1&&h.stroke_index<=18)&&new Set(holes.map(h=>h.stroke_index)).size===18;
  choices.push({id:gender+'-'+i,name:clean(t.tee_name)||'Unnamed tee',group,rating:num(t.course_rating),slope:num(t.slope_rating),holes,valid});
 });
 return {id:String(c.id),name,location:[c.location?.city,c.location?.state,c.location?.country].filter(Boolean).map(clean).join(', '),choices};
}
export function buildCourseImport(course,choiceId,corrections=null) {
 let primary=course.choices.find(t=>t.id===choiceId);
 if(primary && corrections) {
  if(primary.holes.length!==18 || !Array.isArray(corrections) || corrections.length!==18)throw new Error('An 18-hole scorecard is required.');
  const holes=corrections.map((h,i)=>({hole_number:i+1,par:num(h.par),stroke_index:num(h.stroke_index),yardage:num(h.yardage)}));
  const valid=holes.every(h=>[3,4,5].includes(h.par)&&Number.isInteger(h.stroke_index)&&h.stroke_index>=1&&h.stroke_index<=18)&&new Set(holes.map(h=>h.stroke_index)).size===18;
  primary={...primary,holes,valid};
 }
 if(!primary?.valid) throw new Error('A complete 18-hole scorecard with unique stroke indexes is required.');
 const signature=JSON.stringify(primary.holes.map(h=>[h.par,h.stroke_index]));
 const compatible=course.choices.map(t=>t.id===choiceId?primary:t).filter(t=>t.valid&&JSON.stringify(t.holes.map(h=>[h.par,h.stroke_index]))===signature);
 const teeOptions={},keys=new Map();
 compatible.forEach(t=>{let key=slug(t.name+'-'+t.group);if(teeOptions[key])key+='-'+t.id.split('-')[1];keys.set(t.id,key);teeOptions[key]={name:t.name+' · '+t.group,rating:Number.isFinite(t.rating)?t.rating:null,slope:Number.isFinite(t.slope)?t.slope:null};});
 const fingerprint=createHash('sha256').update(signature).digest('hex').slice(0,10);
 teeOptions._source={provider:'golfcourseapi',id:course.id,card:fingerprint};
 const holes=primary.holes.map((h,i)=>({hole_number:i+1,par:h.par,stroke_index:h.stroke_index,
  yardage:Number.isInteger(h.yardage)&&h.yardage>0?h.yardage:null,is_danger_hole:false,
  tee_options:Object.fromEntries(compatible.map(t=>[keys.get(t.id),{yardage:Number.isInteger(t.holes[i].yardage)&&t.holes[i].yardage>0?t.holes[i].yardage:null}]))}));
 return {course:{name:course.name,slug:'gca-'+course.id+'-'+fingerprint,location:course.location||null,par:holes.reduce((n,h)=>n+h.par,0),course_rating:primary.rating,slope_rating:primary.slope,tee_options:teeOptions},holes,tee:keys.get(primary.id)};
}
export default async function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 if(!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Method not allowed'});
 const base=(process.env.NEXT_PUBLIC_SUPABASE_URL||'').trim().replace(/\/$/,''),key=(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||'').trim(),apiKey=(process.env.GOLF_COURSE_API_KEY||'').trim();
 if(!base||!key||!apiKey)return res.status(503).json({error:'Course search is not configured yet. You can still select courses already in the app.'});
 const token=req.headers.authorization;
 if(!/^Bearer \S+$/.test(token||''))return res.status(401).json({error:'Please sign in to find courses.'});
 const headers={apikey:key,Authorization:token,'Content-Type':'application/json',Prefer:'return=representation'};
 const db=async(path,opts={})=>{const r=await fetch(base+'/rest/v1/'+path,{...opts,headers,signal:AbortSignal.timeout(15000)});if(!r.ok){const e=new Error(r.status===403?'Your account does not have permission to add courses.':'Could not save the course. Please try again.');e.status=r.status;throw e;}return r.status===204?[]:r.json();};
 const external=async path=>{const old=cache.get(path);if(old&&Date.now()-old.at<300000)return old.data;
  const r=await fetch('https://api.golfcourseapi.com/v1/'+path,{headers:{Authorization:'Key '+apiKey},signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw new Error(r.status===429?'Course search has reached its limit. Please try again later.':'Course search is temporarily unavailable. Please try again.');
  const data=await r.json();if(cache.size>100)cache.clear();cache.set(path,{at:Date.now(),data});return data;};
 try {
  const auth=await fetch(base+'/auth/v1/user',{headers,signal:AbortSignal.timeout(10000)});
  if(!auth.ok)return res.status(401).json({error:'Your session expired. Please sign in again.'});
  const user=await auth.json();if(!user.id)return res.status(401).json({error:'Please sign in again.'});
  const count=requests.get(user.id);if(count&&Date.now()-count.at<60000&&count.n>=20)return res.status(429).json({error:'Please wait a moment before searching again.'});
  requests.set(user.id,count&&Date.now()-count.at<60000?{...count,n:count.n+1}:{at:Date.now(),n:1});
  if(requests.size>1000)requests.delete(requests.keys().next().value);
  const profiles=await db('profiles?select=is_admin&id=eq.'+encodeURIComponent(user.id));const canImport=profiles[0]?.is_admin===true;
  if(req.method==='GET'&&req.query.action==='search') {
   const query=clean(req.query.q);if(query.length<3||query.length>100)return res.status(400).json({error:'Enter at least 3 characters of the course name.'});
   const data=await external('search?search_query='+encodeURIComponent(query));
   return res.status(200).json({canImport,courses:(data.courses||[]).slice(0,30).map(c=>({id:String(c.id),name:[...new Set([clean(c.club_name),clean(c.course_name)].filter(Boolean))].join(' — '),location:[c.location?.city,c.location?.state,c.location?.country].filter(Boolean).map(clean).join(', ')}))});
  }
  const id=String(req.method==='POST'?req.body?.id:req.query.id);
  if(!/^\d{1,12}$/.test(id))return res.status(400).json({error:'Choose a course from the search results.'});
  if(req.method==='POST'&&!canImport)return res.status(403).json({error:'Adding a new scorecard requires your existing course-admin permission. You can choose any course already in the app.'});
  const detail=describeCourse(await external('courses/'+id));detail.id=id;
  if(req.method==='GET')return res.status(200).json({...detail,canImport});
  const data=buildCourseImport(detail,String(req.body?.tee),req.body?.holes||null);
  const path='courses?select=id,slug,name,created_at,tee_options,holes(hole_number,par,stroke_index)&slug=eq.'+encodeURIComponent(data.course.slug);
  const existing=await db(path);let record=existing[0];
  if(record?.holes?.length===18)return res.status(200).json({slug:record.slug,tee:data.tee,existing:true});
  if(record&&((record.holes||[]).length||record.tee_options?._source?.provider!=='golfcourseapi'))return res.status(409).json({error:'This course needs a scorecard check in Admin. Its existing holes have not been changed.'});
  if(record&&Date.now()-Date.parse(/[Zz]|[+-]\d{2}:?\d{2}$/.test(record.created_at)?record.created_at:record.created_at+'Z')<30000)return res.status(409).json({error:'This course is still being added. Please try again in a moment.'});
  if(!record){
   try{record=(await db('courses',{method:'POST',body:JSON.stringify(data.course)}))[0];}
   catch(e){if(e.status===409)return res.status(409).json({error:'This course is being added. Please try again in a moment.'});throw e;}
  }
  if(!record?.id)throw new Error('The course could not be added.');
  await db('holes',{method:'POST',body:JSON.stringify(data.holes.map(h=>({...h,course_id:record.id})))});
  return res.status(200).json({slug:data.course.slug,tee:data.tee,existing:false});
 }catch(e){return res.status(e.status===403?403:400).json({error:e.message||'Could not load the course. Please try again.'});}
}
