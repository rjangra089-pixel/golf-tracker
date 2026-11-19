// Club-published scorecards checked 19 November 2026. Distances are METRES
// on the source cards; only yardage is stored in the app's distance fields.
// Vila Sol prints 18-hole odd/even SI. Rank within each nine for a standalone
// nine-hole allowance. The printed SI and physical number remain in metadata.
import {createHash} from 'node:crypto';
const uuid=label=>{const h=createHash('sha256').update('golf-tracker:portugal:v1:'+label).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const gramacho='https://pestanagolf.com/wp-content/uploads/2023/05/GRAMACHO-18.pdf';
const vila='https://pestanagolf.com/wp-content/uploads/2026/02/Vila-sol_compressed.pdf';
const definitions=[
 {slug:'pt-gramacho',name:'Gramacho',source:gramacho,start:1,
  par:[4,5,4,3,4,5,3,4,4,3,4,5,4,4,3,4,4,5],
  si:[4,6,10,16,2,14,12,18,8,9,13,3,15,7,17,1,11,5],
  white:[317,476,309,162,342,416,153,263,314,148,309,433,327,321,169,353,268,452],
  yellow:[302,456,307,130,322,391,137,242,293,134,295,427,310,305,150,341,246,424],
  ratings:{white:{rating:69.8,slope:127},yellow:{rating:68.1,slope:123}}},
 {slug:'pt-vila-sol-prime-9',name:'Vila Sol — Prime (9 holes)',source:vila,start:1,
  par:[4,4,4,3,4,5,3,5,4],si:[3,7,1,15,11,9,13,5,17],
  white:[381,407,385,190,392,515,180,499,292],yellow:[366,367,372,158,360,480,162,483,284]},
 {slug:'pt-vila-sol-challenge-9',name:'Vila Sol — Challenge (9 holes)',source:vila,start:10,
  par:[4,5,4,3,5,3,4,4,4],si:[10,16,6,18,2,14,8,12,4],
  white:[355,456,360,159,506,198,346,369,403],yellow:[342,446,341,150,458,161,338,349,358]},
 {slug:'pt-vila-sol-prestige-9',name:'Vila Sol — Prestige (9 holes)',source:vila,start:19,
  par:[5,3,4,4,5,4,3,4,4],si:[5,15,7,11,1,13,17,3,9],
  white:[488,166,368,342,524,320,147,398,369],yellow:[470,157,341,310,485,302,143,370,359]},
];
export const PORTUGAL_CARDS=definitions.map(d=>{
 const n=d.par.length,rank=[...d.si].sort((a,b)=>a-b),id=uuid(d.slug);
 const course={id,slug:d.slug,name:d.name,location:'Algarve, Portugal',par:d.par.reduce((a,b)=>a+b,0),
  course_rating:d.ratings?.yellow.rating??null,slope_rating:d.ratings?.yellow.slope??null,
  tee_options:{white:{name:'White',rating:d.ratings?.white.rating??null,slope:d.ratings?.white.slope??null},yellow:{name:'Yellow',rating:d.ratings?.yellow.rating??null,slope:d.ratings?.yellow.slope??null},
   _source:{provider:'pestana-verified',version:1,url:d.source,checked:'2026-11-19',holes:n,distance_source_unit:'metres',si_method:n===9?'Rank of printed stroke index within this nine; allocation 1–9':'Published 18-hole stroke index',nine_ratings:n===9?'Not published on the source scorecard':null}}};
 const holes=d.par.map((par,i)=>({id:uuid(d.slug+':hole:'+(i+1)),course_id:id,hole_number:i+1,par,stroke_index:n===9?rank.indexOf(d.si[i])+1:d.si[i],yardage:Math.round(d.yellow[i]/.9144),is_danger_hole:false,
  tee_options:{white:{yardage:Math.round(d.white[i]/.9144)},yellow:{yardage:Math.round(d.yellow[i]/.9144)},_layout:{physical_hole:d.start+i,printed_si:d.si[i],white_metres:d.white[i],yellow_metres:d.yellow[i]}}}));
 return {course,holes};
});
// Additive and retry-safe. Never PATCH/DELETE; never access rounds or shots.
// Fixed IDs + ignore-duplicates handle interrupted imports and concurrent tabs.
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export async function addPortugalCards(db){
 for(const {course,holes} of PORTUGAL_CARDS){
  const found=await db('courses?select=*&or=(id.eq.'+course.id+',slug.eq.'+course.slug+')');
  if(found.some(c=>c.id!==course.id||c.slug!==course.slug||c.tee_options?._source?.provider!=='pestana-verified'))throw new Error('A Portugal layout already exists with different data. It was left untouched.');
  await db('courses?on_conflict=id',{method:'POST',body:JSON.stringify(course),prefer:'resolution=ignore-duplicates,return=representation'});
  const existing=await db('holes?select=*&course_id=eq.'+course.id);
  for(const h of existing){const expected=holes.find(x=>x.id===h.id);if(!expected||['course_id','hole_number','par','stroke_index','yardage'].some(k=>h[k]!==expected[k])||canonical(h.tee_options)!==canonical(expected.tee_options))throw new Error('A Portugal scorecard differs from the verified card. It was left untouched.');}
  // Existing course metadata must also match; do not silently claim a repaired card.
  if(found[0]&&(['name','par','course_rating','slope_rating'].some(k=>found[0][k]!==course[k])||canonical(found[0].tee_options)!==canonical(course.tee_options)))throw new Error('A Portugal layout differs from the verified card. It was left untouched.');
  await db('holes?on_conflict=id',{method:'POST',body:JSON.stringify(holes),prefer:'resolution=ignore-duplicates,return=representation'});
  const confirmed=await db('holes?select=id&course_id=eq.'+course.id);
  if(confirmed.length!==holes.length)throw new Error('Portugal scorecards have not finished saving. Please retry.');
 }
 return PORTUGAL_CARDS.map(x=>x.course.slug);
}
