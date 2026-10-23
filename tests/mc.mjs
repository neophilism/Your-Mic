import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {mcPlan, mcSpecialPlan, canUseMcClip} from '../lib/mc.ts';
import {nextSelection} from '../lib/playback.ts';
const require=createRequire(import.meta.url), wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=wranglerRequire('miniflare'), {build}=wranglerRequire('esbuild');

const tracks=[{id:'a',title:'Track A'},{id:'b',title:'Track B'}];
const event={id:'event',artist:'The Artist',album:'The Album',current_track:'a',album_cursor:'a',mode:'auto',version:1,mc_enabled:1};
const queue=[{id:'first',track_id:'a',name:'First Rapper',status:'waiting'}];
const plan=mcPlan(event,tracks,nextSelection(event,tracks,queue));
assert(plan.text.includes('Track A on The Album by The Artist'));
assert(plan.text.endsWith('Playing next, Track A. First Rapper, it’s your mic!'));
assert(!canUseMcClip(plan,mcPlan(event,tracks,nextSelection(event,tracks,[]))));
assert(!canUseMcClip(plan,mcPlan(event,tracks,nextSelection(event,tracks,[{...queue[0],id:'new',name:'New Rapper'}]))));
assert.equal(mcPlan({...event,mc_enabled:0},tracks,nextSelection(event,tracks,queue)),null);
assert.notEqual(plan.text,mcPlan({...event,version:2},tracks,nextSelection(event,tracks,queue)).text);
const custom=mcPlan(event,[{...tracks[0],mc_text:'Big love for {track}, from {album}!'},tracks[1]],nextSelection(event,tracks,queue));
assert(custom.text.startsWith('Big love for Track A, from The Album!'));
assert(canUseMcClip(plan,custom),'A late script change may use the previous audio for the same performer');
assert.equal(mcPlan({...event,end_after_track:1,outro_enabled:0},tracks,nextSelection(event,tracks,queue)),null);
assert.equal(mcPlan({...event,end_after_track:1,outro_enabled:1},tracks,nextSelection(event,tracks,queue)).kind,'outro');
assert(mcSpecialPlan({...event,intro_text:'Welcome to {album}, by {artist}!'},'intro').text.includes('The Album, by The Artist'));

// A fake speech provider keeps tests isolated, deterministic, and free of API calls.
const wav=new Uint8Array(16044), view=new DataView(wav.buffer);
for(const [offset,string]of[[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])for(let n=0;n<string.length;n++)wav[offset+n]=string.charCodeAt(n);
view.setUint32(4,wav.length-8,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);view.setUint32(40,16000,true);
let calls=0,failSpeech=false;
const built=await build({stdin:{contents:"import {api} from './lib/api.ts';export default {fetch:api};",resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'esm',external:['cloudflare:workers']});
const mf=new Miniflare({modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:{MC_CLOUDFLARE_ACCOUNT_ID:'test-account',MC_CLOUDFLARE_API_TOKEN:'test-token'},outboundService:async request=>{
  assert.equal(new URL(request.url).hostname,'api.cloudflare.com');assert(request.url.endsWith('/ai/run/@cf/deepgram/aura-2-en'));
  const body=await request.json();assert.equal(body.speaker,'zeus');assert.equal(body.encoding,'mp3');calls++;
  return failSpeech?new Response('unavailable',{status:503}):new Response(wav,{headers:{'Content-Type':'audio/mpeg'}});
}});
try{
 const DB=await mf.getD1Database('DB');
 for(const file of(await readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())for(const sql of(await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await DB.prepare(sql).run();
 const owner={'oai-authenticated-user-id':'artist'}, controller=randomUUID(), host={...owner,'x-controller-token':controller}, guest={'x-guest-token':randomUUID()};
 async function req(path,method='GET',body,headers=host,status=200){const response=await mf.dispatchFetch('https://mc.test/api/'+path,{method,headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;}
 const created=await req('events','POST',{title:'The Show',artist:'The Artist',album:'The Album'},host,201);const base='events/'+created.id;
 const now=Date.now();await DB.batch(['a','b'].map((id,index)=>DB.prepare('INSERT INTO tracks(id,event_id,title,position,duration,audio_key,mime) VALUES(?,?,?,?,?,?,?)').bind(id,created.id,'Track '+id.toUpperCase(),index,180,id+'.mp3','audio/mpeg')));
 let s=await req(base);assert.equal(s.event.intro_enabled,0);assert.equal(s.event.outro_enabled,0);assert.equal(s.speechAvailable,true);
 await req(base+'/mc','PATCH',{trackId:'a',text:'Nope'},guest,401);
 await req(base+'/mc','POST',{},guest,401);
 await req(base+'/mc','PATCH',{trackId:'foreign',text:'Nope'},host,404);
 await req(base+'/mc','PATCH',{trackId:'a',text:'x'.repeat(601)},host,400);
 await req(base+'/mc','PATCH',{introEnabled:true,outroEnabled:true,introText:'Welcome to {album}!',outroText:'Thanks, everybody. That’s the show!'});
 const intro=await req(base+'/mc','POST',{kind:'intro'});assert.equal(intro.state,'ready');
 await req(base+'/mc','POST',{kind:'intro'});assert.equal(calls,1,'Unchanged audio is cached');
 s=await req(base+'/control','POST',{action:'claim',controller});
 s=await req(base+'/control','POST',{action:'play',controller,mcClipId:intro.id});assert.equal(s.event.announcement_kind,'intro');assert.equal(s.event.current_track,'a');
 const introVersion=s.event.version;
 s=await req(base+'/control','POST',{action:'pause',controller});assert.equal(s.event.status,'paused');assert.equal(s.event.announcement_id,intro.id);
 s=await req(base+'/control','POST',{action:'play',controller});assert.equal(s.event.announcement_id,intro.id);
 s=await req(base+'/control','POST',{action:'finish-announcement',controller,version:s.event.version,announcementId:intro.id});assert.equal(s.event.announcement_id,null);assert.equal(s.event.position,0);assert.equal(s.event.current_track,'a');
 await req(base+'/control','POST',{action:'finish-announcement',controller,version:introVersion,announcementId:intro.id},host,409);
 s=await req(base,'PATCH',{action:'mode',mode:'auto'});
 s=await req(base+'/queue','POST',{name:'First Rapper',trackId:'b'},guest,201);
 const rapper=await req(base+'/mc','POST',{});assert.equal(rapper.state,'ready');assert(rapper.text.includes('First Rapper, it’s your mic!'));
 await req(base+'/mc','PATCH',{trackId:'a',text:'Brand new words for {track}!'});
 const newScript=await req(base+'/mc','POST',{});s=await req(base);assert(newScript.text.startsWith('Brand new words for Track A!'));assert.notEqual(rapper.id,newScript.id);
 // At the boundary, an older recording for this same next performer is safe.
 s=await req(base+'/control','POST',{action:'next',controller,version:s.event.version,mcClipId:rapper.id});assert.equal(s.event.announcement_id,rapper.id);assert.equal(s.event.current_entry,s.queue[0].id);assert.equal(s.event.current_track,'b');
 s=await req(base+'/control','POST',{action:'finish-announcement',controller,version:s.event.version,announcementId:rapper.id});assert.equal(s.event.position,0);assert.equal(s.event.current_track,'b');
 // Reusing the old name on a different transition is rejected without delaying music.
 s=await req(base+'/control','POST',{action:'next',controller,version:s.event.version,mcClipId:rapper.id});assert.equal(s.event.announcement_id,null);assert.equal(s.event.current_entry,null);
 const stranger=await req(base,'GET',undefined,guest);assert(!('intro_text'in stranger.event));assert(stranger.tracks.every(t=>!('mc_text'in t)));assert(!('speechAvailable'in stranger));
 // Mid-playlist ending stops the loop and closes the queue after the optional outro.
 const outro=await req(base+'/mc','POST',{kind:'outro'});
 s=await req(base+'/mc','PATCH',{endAfterTrack:true});
 s=await req(base+'/control','POST',{action:'next',controller,version:s.event.version,mcClipId:outro.id});assert.equal(s.event.announcement_kind,'outro');assert.equal(s.event.current_track,null);assert.equal(s.event.show_ended,1);assert.equal(s.event.queue_open,0);
 s=await req(base+'/control','POST',{action:'finish-announcement',controller,version:s.event.version,announcementId:outro.id});assert.equal(s.event.status,'idle');assert.equal(s.event.show_ended,1);assert.equal(s.event.announcement_id,null);
 s=await req(base+'/mc','PATCH',{introEnabled:false,outroEnabled:false});
 s=await req(base+'/control','POST',{action:'play',controller,mcClipId:intro.id});assert.equal(s.event.announcement_id,null);assert.equal(s.event.show_ended,0);
 s=await req(base+'/mc','PATCH',{endAfterTrack:true});
 s=await req(base+'/control','POST',{action:'next',controller,version:s.event.version,mcClipId:outro.id});assert.equal(s.event.status,'idle');assert.equal(s.event.announcement_id,null);
 s=await req(base+'/control','POST',{action:'play',controller});
 s=await req(base+'/mc','PATCH',{trackId:s.event.current_track,text:'This recording will fail.'});failSpeech=true;
 const failed=await req(base+'/mc','POST',{});assert.equal(failed.state,'failed');
 const before=Date.now();s=await req(base+'/control','POST',{action:'next',controller,version:s.event.version});assert.equal(s.event.status,'playing');assert.equal(s.event.announcement_id,null);assert(Date.now()-before<2000,'No synthesis wait at a boundary');
 const range=await mf.dispatchFetch('https://mc.test/api/mc-audio/'+intro.id,{headers:{Range:'bytes=0-43'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,44);
 console.log('MC passed: varied credits, automatic performer callouts, custom text/replacements, ownership, private drafts, cached speech, intro/pause/resume, guarded transitions, stale-name rejection, optional outro, early show end, failure fallback and audio ranges.');
}finally{await mf.dispose();}
