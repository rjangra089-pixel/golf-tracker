export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  // Vercel emits this handler as CommonJS; load the ESM catalog dynamically.
  const {addPortugalCards}=await import('../lib/portugal-scorecards.mjs');

 const base=(process.env.NEXT_PUBLIC_SUPABASE_URL||'').trim().replace(/\/$/,''),key=(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||'').trim();
 if(!base||!key)return res.status(503).json({error:'Course setup is not configured.'});
 const token=req.headers.authorization;if(!/^Bearer \S+$/.test(token||''))return res.status(401).json({error:'Please sign in.'});
 const headers={apikey:key,Authorization:token,'Content-Type':'application/json'};
 try{
  const auth=await fetch(base+'/auth/v1/user',{headers,signal:AbortSignal.timeout(10000)});if(!auth.ok)return res.status(401).json({error:'Please sign in again.'});
  const user=await auth.json();if(!user.id)return res.status(401).json({error:'Please sign in again.'});
  const db=async(path,options={})=>{const {prefer,...opts}=options;const r=await fetch(base+'/rest/v1/'+path,{...opts,headers:{...headers,Prefer:prefer||'return=representation'},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(r.status===403?'Your course-admin permission is required to add these cards.':'Could not add Portugal scorecards. Retry when connected.');return r.status===204?[]:r.json();};
  const profiles=await db('profiles?select=is_admin&id=eq.'+encodeURIComponent(user.id));
  if(profiles[0]?.is_admin!==true)return res.status(403).json({error:'Your course-admin permission is required to add these cards.'});
  return res.status(200).json({slugs:await addPortugalCards(db)});
 }catch(e){return res.status(400).json({error:e.message||'Could not add Portugal scorecards.'});}
}
