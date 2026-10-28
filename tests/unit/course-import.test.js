// Course import endpoint: fake provider + fake Supabase; never writes to a real database.
const fs=require('fs'),path=require('path'),assert=require('assert');
const src=fs.readFileSync(path.join(__dirname,'../../api/courses.js'),'utf8');
(async()=>{
 const {describeCourse,buildCourseImport,default:handler}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
 const raw={id:123,club_name:'New Golf Club',course_name:'Main Course',location:{city:'Woking',country:'England'},tees:{male:[{tee_name:'Blue',course_rating:71,slope_rating:123,holes:Array.from({length:18},(_,i)=>({par:4,handicap:i+1,yardage:300+i}))}]}};
 const detail=describeCourse(raw),built=buildCourseImport(detail,'male-0');
 assert.strictEqual(built.holes.length,18);assert.strictEqual(built.tee,'blue-men');assert.strictEqual(built.course.par,72);assert.ok(built.course.slug.startsWith('gca-123-'));assert.strictEqual(built.holes[0].tee_options['blue-men'].yardage,300);
 const incomplete=JSON.parse(JSON.stringify(raw));delete incomplete.tees.male[0].holes[0].handicap;assert.throws(()=>buildCourseImport(describeCourse(incomplete),'male-0'));
 assert.strictEqual(buildCourseImport(describeCourse(incomplete),'male-0',detail.choices[0].holes).holes.length,18);
 const duplicate=JSON.parse(JSON.stringify(raw));duplicate.tees.male[0].holes[1].handicap=1;assert.throws(()=>buildCourseImport(describeCourse(duplicate),'male-0'));
 const short=JSON.parse(JSON.stringify(raw));short.tees.male[0].holes=short.tees.male[0].holes.slice(0,9);assert.throws(()=>buildCourseImport(describeCourse(short),'male-0'));
 const changed=JSON.parse(JSON.stringify(raw));changed.tees.male[0].holes[0].par=5;assert.notStrictEqual(buildCourseImport(describeCourse(changed),'male-0').course.slug,built.course.slug);
 const extra=JSON.parse(JSON.stringify(raw));extra.tees.male.push({...extra.tees.male[0],tee_name:'White',holes:extra.tees.male[0].holes.map(h=>({...h,yardage:h.yardage+50}))});assert.strictEqual(Object.keys(buildCourseImport(describeCourse(extra),'male-0').holes[0].tee_options).length,2);
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://mock.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='ANON';process.env.GOLF_COURSE_API_KEY='PROVIDER_KEY';
 let calls=[],admin=true,existing=[],deny=false,failHoles=false;
 global.fetch=async(url,init={})=>{
  calls.push({url,init});let body;
  if(url.endsWith('/auth/v1/user'))return {ok:!deny,json:async()=>({id:'owner'})};
  if(url.includes('api.golfcourseapi.com')){assert.strictEqual(init.headers.Authorization,'Key PROVIDER_KEY');body=url.includes('/search?')?{courses:[raw]}:raw;}
  else if(url.includes('/profiles?'))body=[{is_admin:admin}];
  else if(url.includes('/courses?'))body=existing;
  else if(url.endsWith('/courses'))body=[{id:'new-id',...JSON.parse(init.body)}];
  else if(url.endsWith('/holes')){if(failHoles)return {ok:false,status:403};body=JSON.parse(init.body);}
  else throw new Error('Unexpected URL '+url);
  return {ok:true,status:200,json:async()=>body};
 };
 const run=async(method,body={},query={},auth='Bearer TOKEN')=>{let code,data;await handler({method,body,query,headers:{authorization:auth}},{setHeader(){},status(n){code=n;return this;},json(v){data=v;return this;}});return {code,data};};
 let result=await run('GET',{}, {action:'search',q:'New Club'},'');assert.strictEqual(result.code,401);assert.strictEqual(calls.length,0);
 deny=true;result=await run('POST',{id:'123',tee:'male-0'});assert.strictEqual(result.code,401);deny=false;
 admin=false;calls=[];result=await run('POST',{id:'123',tee:'male-0'});assert.strictEqual(result.code,403);assert.ok(!calls.some(c=>c.init.method));admin=true;
 calls=[];result=await run('POST',{id:'123',tee:'male-0'});assert.strictEqual(result.code,200);assert.strictEqual(result.data.tee,'blue-men');
 let writes=calls.filter(c=>c.init.method);assert.strictEqual(writes.length,2);assert.ok(writes.every(c=>c.init.method==='POST'));assert.ok(writes.every(c=>c.init.headers.Authorization==='Bearer TOKEN'));assert.ok(!writes.some(c=>/rounds|shots/.test(c.url)));
 existing=[{id:'old-id',slug:built.course.slug,holes:built.holes,tee_options:built.course.tee_options}];calls=[];result=await run('POST',{id:'123',tee:'male-0'});assert.strictEqual(result.code,200);assert.strictEqual(result.data.existing,true);assert.ok(!calls.some(c=>c.init.method));
 existing=[{id:'old-id',slug:built.course.slug,holes:[built.holes[0]]}];calls=[];result=await run('POST',{id:'123',tee:'male-0'});assert.strictEqual(result.code,409);assert.ok(!calls.some(c=>c.init.method));
 existing=[];failHoles=true;calls=[];result=await run('POST',{id:'123',tee:'male-0'});assert.strictEqual(result.code,403);assert.ok(calls.every(c=>!['PATCH','DELETE'].includes(c.init.method)));
 calls=[];result=await run('POST',{id:'123',tee:'not-a-tee'});assert.strictEqual(result.code,400);assert.ok(!calls.some(c=>c.init.method));
 assert.ok(!src.includes('AB6N'));assert.ok(!/method:['"](?:PATCH|DELETE)/.test(src));
 console.log('All course import tests passed (validation, permission, creation, duplicate/retry and preservation checks).');
})().catch(e=>{console.error(e);process.exitCode=1;});
