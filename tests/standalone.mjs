import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomBytes,createHmac} from 'node:crypto';
const require=createRequire(import.meta.url);
const wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=wranglerRequire('miniflare');
const {build}=wranglerRequire('esbuild');
const built=await build({stdin:{contents:"import {standaloneFetch} from './lib/standalone.ts';export default {fetch:(r,env)=>standaloneFetch(r,env,async clean=>Response.json({page:true,identity:clean.headers.get('oai-authenticated-user-id')}))};",resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'esm',external:['cloudflare:workers']});
const password=randomBytes(24).toString('hex'),secret=randomBytes(32).toString('hex');
const options={modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET']};
const mf=new Miniflare({...options,bindings:{ARTIST_PASSWORD:password,SESSION_SECRET:secret}});
try{
 const DB=await mf.getD1Database('DB');
 for(const filename of (await readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())for(const sql of (await readFile('drizzle/'+filename,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await DB.prepare(sql).run();
 async function request(path,init={}){return mf.dispatchFetch('https://your-mic.test'+path,{redirect:'manual',...init});}
 const form=(value,headers={})=>({method:'POST',headers:{Origin:'https://your-mic.test','Content-Type':'application/x-www-form-urlencoded','cf-connecting-ip':'192.0.2.1',...headers},body:new URLSearchParams({password:value}).toString()});
 assert.equal((await request('/healthz')).status,200);
 assert.equal((await request('/artist/sign-in')).status,200);
 assert.equal((await request('/artist/sign-in',form(password,{Origin:'https://evil.test'}))).status,403);
 assert.equal((await request('/artist/sign-in',form('wrong'))).status,401);
 const login=await request('/artist/sign-in',form(password));assert.equal(login.status,303);
 const setCookie=login.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/Secure/);assert.match(setCookie,/SameSite=Lax/);
 const cookie=setCookie.split(';')[0];
 assert.equal((await (await request('/api/me',{headers:{Cookie:cookie}})).json()).signedIn,true);
 assert.equal((await (await request('/api/me',{headers:{'oai-authenticated-user-id':'standalone-artist'}})).json()).signedIn,false);
 assert.equal((await request('/api/events',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':'standalone-artist'},body:JSON.stringify({title:'Forged',artist:'Attacker'})})).status,401);
 const created=await request('/api/events',{method:'POST',headers:{Cookie:cookie,Origin:'https://your-mic.test','Content-Type':'application/json'},body:JSON.stringify({title:'Live event',artist:'Artist'})});assert.equal(created.status,201);
 assert.equal((await request('/api/mine',{headers:{Cookie:cookie}})).status,200);
 assert.equal((await request('/api/mine')).status,401);
 const badCookie=cookie.slice(0,-4)+'AAAA';assert.equal((await (await request('/api/me',{headers:{Cookie:badCookie}})).json()).signedIn,false);
 const expired=Buffer.from(JSON.stringify({artist:'standalone-artist',exp:Math.floor(Date.now()/1000)-1})).toString('base64url');
 const expiredCookie='__Host-ym-artist='+expired+'.'+createHmac('sha256',secret).update(expired).digest('base64url');
 assert.equal((await (await request('/api/me',{headers:{Cookie:expiredCookie}})).json()).signedIn,false);
 const fallback=await (await request('/admin',{headers:{'oai-authenticated-user-id':'forged'}})).json();assert.equal(fallback.identity,null);
 assert.equal((await request('/artist/sign-out',{method:'POST',headers:{Origin:'https://evil.test',Cookie:cookie}})).status,403);
 const out=await request('/artist/sign-out',{method:'POST',headers:{Origin:'https://your-mic.test',Cookie:cookie}});assert.equal(out.status,303);assert.match(out.headers.get('set-cookie'),/Max-Age=0/);
 for(let i=0;i<20;i++)await request('/artist/sign-in',form('wrong',{'cf-connecting-ip':'192.0.2.2'}));
 assert.equal((await request('/artist/sign-in',form(password,{'cf-connecting-ip':'192.0.2.2'}))).status,429);
 console.log('Standalone hosting passed: secure artist cookie, sign-in/out, cross-origin protection, forged-header removal, ownership, expired/tampered sessions, shared login rate limit, health check.');
}finally{await mf.dispose();}
const unconfigured=new Miniflare(options);
try{
 const r=await unconfigured.dispatchFetch('https://your-mic.test/api/me',{headers:{'oai-authenticated-user-id':'forged'}});
 assert.equal((await r.json()).signedIn,false);
 assert.equal((await unconfigured.dispatchFetch('https://your-mic.test/artist/sign-in')).status,503);
}finally{await unconfigured.dispose();}
