import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {mcTrackPlan} from '../lib/mc.ts';
const require=createRequire(import.meta.url), wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=wranglerRequire('miniflare'),{build}=wranglerRequire('esbuild');
const built=await build({stdin:{contents:"import {api} from './lib/api.ts';export default {fetch:api};",resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'esm',external:['cloudflare:workers']});
const mf=new Miniflare({modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:{DEEPGRAM_API_KEY:'test-only-key'},outboundService:async()=>new Response(new Uint8Array(1600),{headers:{'Content-Type':'audio/mpeg'}})});
try{
 const DB=await mf.getD1Database('DB');
 for(const file of(await readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())for(const sql of(await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await DB.prepare(sql).run();
 const owner={'oai-authenticated-user-id':'artist'},controller=randomUUID(),host={...owner,'x-controller-token':controller},guest={'x-guest-token':randomUUID()};
 async function req(path,method='GET',body,headers=host,status=200){const response=await mf.dispatchFetch('https://bookends.test/api/'+path,{method,headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;}
 const created=await req('events','POST',{title:'Queue bookends',artist:'Capture Shock',album:'Minnesota Ave.'},host,201),base='events/'+created.id;
 const titles=['Extrajudicial Killing','Thought is Stupid','Elephant In The Room'];
 await DB.batch(titles.map((title,i)=>DB.prepare('INSERT INTO tracks(id,event_id,title,position,duration,audio_key,mime) VALUES(?,?,?,?,?,?,?)').bind('abc'[i],created.id,title,i,180,'abc'[i]+'.mp3','audio/mpeg')));
 const openings={},closings={};
 for(const id of 'abc'){
  openings[id]=await req(base+'/mc','POST',{kind:'track-start',trackId:id});closings[id]=await req(base+'/mc','POST',{kind:'track-end',trackId:id});
  assert.equal(openings[id].state,'ready');assert.equal(closings[id].state,'ready');
  for(const other of 'abc')if(other!==id){assert(!openings[id].text.includes(titles['abc'.indexOf(other)]));assert(!closings[id].text.includes(titles['abc'.indexOf(other)]));}
 }
 assert(!closings.a.text.includes('next'));
 const genericMap=Object.fromEntries(Object.entries(openings).map(([id,clip])=>[id,clip.id]));
 await req(base+'/mc','PATCH',{introEnabled:true,outroEnabled:true});
 const intro=await req(base+'/mc','POST',{kind:'intro'}),outro=await req(base+'/mc','POST',{kind:'outro'});
 const command=async(s,action,extra={})=>req(base+'/control','POST',{action,controller,version:s.event.version,splitMc:true,trackOpeningClips:genericMap,introClipId:intro.id,outroClipId:outro.id,...extra});
 let s=await req(base+'/control','POST',{action:'claim',controller});
 s=await command(s,'play');assert.equal(s.event.announcement_kind,'intro');const introPlayback=s.event.playback_id;
 s=await command(s,'finish-announcement',{announcementId:intro.id});assert.equal(s.event.announcement_kind,'track-start');assert.equal(s.event.announcement_id,openings.a.id);assert.notEqual(s.event.playback_id,introPlayback);
 s=await command(s,'finish-announcement',{announcementId:openings.a.id});assert.equal(s.event.announcement_id,null);assert.equal(s.event.current_track,'a');
 s=await req(base,'PATCH',{action:'mode',mode:'auto'});
 s=await command(s,'next',{closingClipId:closings.a.id,openingClipId:openings.b.id});assert.equal(s.event.announcement_kind,'track-end');assert.equal(s.event.current_track,'a');assert.equal(s.event.announcement_id,closings.a.id);
 const closingVersion=s.event.version;
 // The client expected B, but C enters the queue during A's closing credit.
 const joined=await req(base+'/queue','POST',{name:'First Rapper',trackId:'c'},guest,201),q1=joined.queue[0].id;
 s=await req(base);
 s=await command(s,'finish-announcement',{announcementId:closings.a.id,openingClipId:openings.b.id,genericOpeningClipId:openings.b.id});
 assert.equal(s.event.current_track,'c');assert.equal(s.event.current_entry,q1);assert.equal(s.event.announcement_id,openings.c.id);assert(s.announcementText.includes('Elephant In The Room'));assert(!s.announcementText.includes('Thought is Stupid'));
 await req(base+'/control','POST',{action:'finish-announcement',controller,version:closingVersion,splitMc:true,announcementId:closings.a.id},host,409);
 const q1Clip=await req(base+'/mc','POST',{kind:'track-start',trackId:'c',entryId:q1});assert(q1Clip.text.includes('First Rapper, it’s your mic!'));
 s=await command(s,'finish-announcement',{announcementId:openings.c.id});assert.equal(s.event.current_track,'c');assert.equal(s.event.announcement_id,null);assert.equal(s.event.position,0);
 const oldPlayback=s.event.playback_id;
 const guest2={'x-guest-token':randomUUID()};
 const queued=await req(base+'/queue','POST',{name:'Second Rapper',trackId:'c'},guest2,201),q2=queued.queue.find(q=>q.name==='Second Rapper').id;
 const q2Clip=await req(base+'/mc','POST',{kind:'track-start',trackId:'c',entryId:q2});
 s=await req(base);s=await command(s,'next',{closingClipId:closings.c.id});
 // Even the same track must not reuse another rapper's old named intro.
 s=await command(s,'finish-announcement',{announcementId:closings.c.id,openingClipId:q1Clip.id,genericOpeningClipId:openings.c.id});
 assert.equal(s.event.current_entry,q2);assert.equal(s.event.announcement_id,openings.c.id);assert(!s.announcementText.includes('First Rapper'));assert.notEqual(s.event.playback_id,oldPlayback);
 assert.equal((await req(base,'GET',undefined,guest)).lastTurn.id,q1);
 s=await command(s,'finish-announcement',{announcementId:openings.c.id});
 // A fresh named recording is reusable regardless of the previous track/order.
 const direct=mcTrackPlan({...s.event,current_track:'a'},s.tracks.find(t=>t.id==='c'),'track-start',{id:q2,name:'Second Rapper'});
 assert.equal(direct.context,q2Clip.context);
 s=await command(s,'next',{closingClipId:closings.c.id});s=await command(s,'finish-announcement',{announcementId:closings.c.id,openingClipId:q2Clip.id});
 assert.equal(s.event.current_entry,null);assert.equal(s.event.current_track,'b');assert.equal(s.event.announcement_id,openings.b.id);assert(!s.announcementText.includes('Second Rapper'));
 s=await command(s,'finish-announcement',{announcementId:openings.b.id});
 s=await req(base+'/mc','PATCH',{endAfterTrack:true});s=await command(s,'next',{closingClipId:closings.b.id});assert.equal(s.event.announcement_kind,'track-end');
 s=await command(s,'finish-announcement',{announcementId:closings.b.id});assert.equal(s.event.announcement_kind,'outro');assert.equal(s.event.show_ended,1);assert.equal(s.event.current_track,null);
 s=await command(s,'finish-announcement',{announcementId:outro.id});assert.equal(s.event.status,'idle');
 // Independent custom scripts are private, editable and do not add successors.
 await req(base+'/mc','PATCH',{trackId:'a',part:'start',text:'Make room for {track}, by {artist}!'});
 await req(base+'/mc','PATCH',{trackId:'a',part:'end',text:'Big love for {track}.'});
 const customStart=await req(base+'/mc','POST',{kind:'track-start',trackId:'a'}),customEnd=await req(base+'/mc','POST',{kind:'track-end',trackId:'a'});
 assert.equal(customStart.text,'Make room for Extrajudicial Killing, by Capture Shock!');assert.equal(customEnd.text,'Big love for Extrajudicial Killing.');
 const publicView=await req(base,'GET',undefined,guest);assert(!JSON.stringify(publicView.tracks).includes('mc_intro_text'));assert(!JSON.stringify(publicView.tracks).includes('Make room'));
 await req(base+'/mc','POST',{kind:'track-start',trackId:'a'},guest,401);
 // Missing speech cannot stall a selected song.
 s=await req(base+'/mc','PATCH',{endAfterTrack:true});s=await command(s,'select',{trackId:'a',trackOpeningClips:{}});assert.equal(s.event.current_track,'a');assert.equal(s.event.status,'playing');assert.equal(s.event.announcement_id,null);
 console.log('Split MC passed: per-track credits, show intro -> track intro -> music, late queue changes, same-track new rappers, stale packet rejection, real-order opening selection, custom scripts, optional ending, privacy and missing-voice fallback.');
}finally{await mf.dispose();}
