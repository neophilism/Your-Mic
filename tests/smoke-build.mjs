// Run after build:cloudflare. Executes the actual production Worker and assets.
import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=wranglerRequire('miniflare');
const password=randomBytes(24).toString('hex');
const config=JSON.parse(await readFile('dist/server/wrangler.json','utf8'));
const files=(await readdir('dist/server',{recursive:true})).filter(f=>/\.m?js$/.test(f));
const modules=['index.js',...files.filter(f=>f!=='index.js')].map(f=>({type:'ESModule',path:path.resolve('dist/server',f)}));
const mf=new Miniflare({modules,modulesRoot:path.resolve('dist/server'),compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,d1Databases:['DB'],r2Buckets:['BUCKET'],assets:{directory:path.resolve('dist/client'),routerConfig:{has_user_worker:true}},bindings:{ARTIST_PASSWORD:password,SESSION_SECRET:randomBytes(32).toString('hex')}});
try{
 const DB=await mf.getD1Database('DB');
 for(const filename of (await readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())for(const sql of (await readFile('drizzle/'+filename,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await DB.prepare(sql).run();
 const get=async(url,options={})=>mf.dispatchFetch('https://your-mic.test'+url,{redirect:'manual',...options});
 const home=await get('/');assert.equal(home.status,200);const html=await home.text();assert.match(html,/Your Mic/);
 const assets=[...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(m=>m[1]).filter(s=>s.startsWith('/'));
 assert(assets.length>0,'Production HTML must reference client assets');for(const asset of assets){const r=await get(asset);assert.equal(r.status,200);await r.arrayBuffer();}
 const admin=await get('/admin');assert.equal(admin.status,200);await admin.text();
 const signin=await get('/artist/sign-in');assert.equal(signin.status,200);assert.match(await signin.text(),/Artist password/);
 const login=await get('/artist/sign-in',{method:'POST',headers:{Origin:'https://your-mic.test','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password}).toString()});assert.equal(login.status,303);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const created=await get('/api/events',{method:'POST',headers:{Cookie:cookie,Origin:'https://your-mic.test','Content-Type':'application/json'},body:JSON.stringify({title:'Built Worker event',artist:'Artist'})});assert.equal(created.status,201);
 assert.equal((await get('/healthz')).status,200);
 console.log('Production smoke passed: real built Worker, rendered public/admin pages, client assets, independent sign-in, authenticated event creation, health check.');
}finally{await mf.dispose();}
