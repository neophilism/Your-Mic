// Local correctness/concurrency simulation. This does not certify hosted latency,
// provider capacity, mobile networks, or browser audio behavior.
import {createRequire} from 'node:module';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=wranglerRequire('miniflare'),{build}=wranglerRequire('esbuild');
const built=await build({stdin:{contents:"import {api} from './lib/api.ts';export default {fetch:api};",resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'esm',external:['cloudflare:workers']});
const mf=new Miniflare({modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET']});
try{
 const DB=await mf.getD1Database('DB');
 for(const filename of (await readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())for(const sql of (await readFile('drizzle/'+filename,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await DB.prepare(sql).run();
 const event=randomUUID(),track=randomUUID(),now=Date.now();
 await DB.prepare('INSERT INTO events(id,owner_id,title,artist,created_at) VALUES(?,?,?,?,?)').bind(event,'load-artist','Local load test','Load Artist',now).run();
 await DB.prepare('INSERT INTO tracks(id,event_id,title,position,duration,audio_key,mime) VALUES(?,?,?,0,180,?,?)').bind(track,event,'Test instrumental','load.mp3','audio/mpeg').run();
 await (await mf.getR2Bucket('BUCKET')).put('load.mp3',new Uint8Array(1024));
 const guests=Array.from({length:300},()=>randomUUID());
 const times=[];let requests=0;const started=performance.now();
 async function req(path,options={}){
  const at=performance.now();const r=await mf.dispatchFetch('https://load.test/api/'+path,options);const data=await r.json();times.push(performance.now()-at);requests++;return {r,data};
 }
 const joined=await Promise.all(guests.map((guest,i)=>req(`events/${event}/queue`,{method:'POST',headers:{'x-guest-token':guest,'Content-Type':'application/json'},body:JSON.stringify({name:`Performer ${i+1}`,trackId:track})})));
 for(const {r} of joined)assert.equal(r.status,201);
 assert.equal((await req(`events/${event}`)).data.queue.length,300);
 // Ten full 300-client bursts, then concurrent duplicate attempts.
 for(let wave=0;wave<10;wave++){
  const snapshots=await Promise.all(guests.map(guest=>req(`events/${event}`,{headers:{'x-guest-token':guest}})));
  for(const {r,data} of snapshots){assert.equal(r.status,200);assert.equal(data.queue.length,300);assert.equal(data.queue.filter(q=>q.mine).length,1);}
 }
 const duplicated=await Promise.all(Array.from({length:20},()=>req(`events/${event}/queue`,{method:'POST',headers:{'x-guest-token':guests[0],'Content-Type':'application/json'},body:JSON.stringify({name:'Duplicate',trackId:track})})));
 for(const {r} of duplicated)assert.equal(r.status,409);
 const ctrl=randomUUID(),owner={'oai-authenticated-user-id':'load-artist','x-controller-token':ctrl,'Content-Type':'application/json'};
 const control=async(action,extra={})=>req(`events/${event}/control`,{method:'POST',headers:owner,body:JSON.stringify({action,controller:ctrl,...extra})});
 assert.equal((await control('claim')).r.status,200);
 let s=(await control('play')).data;
 await req(`events/${event}`,{method:'PATCH',headers:owner,body:JSON.stringify({action:'mode',mode:'auto'})});
 s=(await req(`events/${event}`)).data;
 const first=s.queue[0].id;
 const advance=await Promise.all(Array.from({length:20},()=>control('next',{version:s.event.version})));
 assert.equal(advance.filter(x=>x.r.status===200).length,1);
 assert.equal(advance.filter(x=>x.r.status===409).length,19);
 const final=(await req(`events/${event}`)).data;assert.equal(final.event.current_entry,first);assert.equal(final.queue.filter(q=>q.status==='playing').length,1);
 const range=await mf.dispatchFetch(`https://load.test/api/audio/${track}`,{headers:{Range:'bytes=100-199'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,100);
 times.sort((a,b)=>a-b);
 const report={environment:'Local Miniflare, isolated temporary D1/R2; not a hosted capacity guarantee',clients:300,snapshotWaves:10,requests,elapsedSeconds:Number(((performance.now()-started)/1000).toFixed(2)),p50Ms:Math.round(times[Math.floor(times.length*0.5)]),p95Ms:Math.round(times[Math.floor(times.length*0.95)]),concurrencyCorrectness:'300 distinct entries, no duplicates, one winner for 20 simultaneous advances, range audio passed'};
 await mkdir('work',{recursive:true});await writeFile('work/load-result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await mf.dispose();}
