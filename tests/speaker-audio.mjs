import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SpeakerPlayback,SpeakerAudioCache,currentSpeakerFailure,speakerFailureMessage} from '../lib/speaker-audio.ts';
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
class Audio extends EventTarget {
 src='';paused=true;ended=false;readyState=0;duration=240;time=0;seeks=[];loads=0;plays=0;
 get currentTime(){return this.time;} set currentTime(v){this.seeks.push(v);this.time=v;}
 pause(){this.paused=true;}
 play(){this.plays++;this.paused=false;return Promise.resolve();}
 load(){this.loads++;this.ended=false;this.time=0;this.readyState=4;this.dispatchEvent(new Event('loadedmetadata'));}
}
const track=(values={})=>({key:'song-1',source:'/api/audio/song',status:'playing',position:0,...values});
test('server polling cannot seek a running song, even after a long buffering delay or clock jump',async()=>{
 const audio=new Audio(),errors=[];
 const player=new SpeakerPlayback(audio,async()=> 'blob:complete-song',()=>{},e=>errors.push(e));
 player.sync(track());await flush();audio.time=37;
 for(let i=0;i<60;i++)player.sync(track({position:40+i*3}));
 assert.equal(audio.currentTime,37);assert.deepEqual(audio.seeks,[]);assert.equal(audio.loads,1);assert.equal(audio.plays,1);assert.deepEqual(errors,[]);
});
test('a delayed download starts at the opening bar instead of skipping to wall-clock time',async()=>{
 const audio=new Audio();let resolve;
 const player=new SpeakerPlayback(audio,()=>new Promise(r=>resolve=r),()=>{},assert.fail);
 player.sync(track());player.sync(track({position:18}));
 assert.equal(audio.loads,0);resolve('blob:complete-song');await flush();
 assert.equal(audio.currentTime,0);assert.deepEqual(audio.seeks,[]);assert.equal(audio.loads,1);
});
test('pause/resume preserves the local playhead; an explicit takeover resumes only once',async()=>{
 const audio=new Audio();const player=new SpeakerPlayback(audio,async()=> 'blob:song',()=>{},assert.fail);
 player.sync(track({position:25}));await flush();assert.deepEqual(audio.seeks,[25]);
 audio.time=48;player.sync(track({status:'paused',position:99}));assert.equal(audio.paused,true);
 player.sync(track({position:102}));await flush();assert.equal(audio.paused,false);assert.equal(audio.currentTime,48);assert.deepEqual(audio.seeks,[25]);
});
test('same-file repeat and announcement-to-song boundaries have separate media instances',async()=>{
 const audio=new Audio();const player=new SpeakerPlayback(audio,async source=>'blob:'+source,()=>{},assert.fail);
 player.sync(track({key:'announcement',source:'mc'}));await flush();audio.time=5;
 player.sync(track({key:'verse-1'}));await flush();assert.equal(audio.currentTime,0);
 audio.time=240;audio.ended=true;audio.paused=true;assert.equal(player.ended,true);
 const plays=audio.plays;player.sync(track({key:'verse-1',position:260}));assert.equal(audio.plays,plays,'Polling must not replay ended audio while a transition is pending');
 player.sync(track({key:'verse-2'}));await flush();assert.equal(audio.currentTime,0);assert.equal(player.ended,false);assert.equal(audio.loads,3);
});
test('a stale download or play result cannot replace a more recent manual selection',async()=>{
 const audio=new Audio(),pending=new Map();
 const player=new SpeakerPlayback(audio,source=>new Promise(r=>pending.set(source,r)),()=>{},assert.fail);
 player.sync(track({key:'old',source:'old'}));player.sync(track({key:'new',source:'new'}));
 pending.get('new')('blob:new');await flush();pending.get('old')('blob:old');await flush();
 assert.equal(audio.src,'blob:new');assert.equal(audio.loads,1);assert.equal(player.key,'new');
 player.stop();assert.equal(audio.paused,true);assert.equal(player.ready,false);
});
test('audio cache publishes only complete files and reuses them without network reads during playback',async()=>{
 let finishBody,calls=0,urls=0;const revoked=[];
 const response=new Response(new ReadableStream({start(controller){finishBody=()=>{controller.enqueue(new Uint8Array([1,2,3,4]));controller.close();};}}),{headers:{'Content-Type':'audio/mpeg','Content-Length':'4'}});
 const cache=new SpeakerAudioCache(async()=>{calls++;return response;},()=>`blob:${++urls}`,url=>revoked.push(url));
 const pending=cache.get('/song');assert.equal(urls,0);assert.equal(cache.get('/song'),pending);
 finishBody();assert.equal(await pending,'blob:1');assert.equal(await cache.get('/song'),'blob:1');assert.equal(calls,1);
 cache.keep(['/song']);assert.deepEqual(revoked,[]);cache.dispose();assert.deepEqual(revoked,['blob:1']);
});
test('truncated audio and unsuccessful responses are rejected before the speaker starts',async()=>{
 for(const response of [new Response('no',{status:503}),new Response(new Uint8Array(2),{headers:{'Content-Type':'audio/mpeg','Content-Length':'4'}})]){
  const cache=new SpeakerAudioCache(async()=>new Response(response.status===503?'no':new Uint8Array(2),{status:response.status,headers:response.headers}),()=>assert.fail('Must not publish partial audio'));
  await assert.rejects(cache.get('/song'),/complete|incomplete/);cache.dispose();
 }
});

test('failed loads preserve the opening bar and an expired controller retains its real resume position',async()=>{
 const audio=new Audio();let resolve;
 const player=new SpeakerPlayback(audio,()=>new Promise(r=>resolve=r),()=>{},()=>{});
 player.sync(track());player.sync(track({position:180}));assert.equal(player.position,0);
 resolve('blob:song');await flush();audio.time=42;
 player.stop();assert.deepEqual(player.resumePoint,{key:'song-1',position:42});
 player.sync(track({position:42}));resolve('blob:song');await flush();assert.equal(audio.currentTime,42);
});

test('a ready cached announcement can replace a pending URL without applying a later clock position',async()=>{
 const audio=new Audio(),pending=new Map();
 const player=new SpeakerPlayback(audio,source=>new Promise(r=>pending.set(source,r)),()=>{},assert.fail);
 player.sync(track({source:'/mc/clip'}));player.sync(track({source:'blob:ready-clip',position:30}));
 pending.get('blob:ready-clip')('blob:ready-clip');await flush();
 pending.get('/mc/clip')('blob:late');await flush();
 assert.equal(audio.src,'blob:ready-clip');assert.equal(audio.currentTime,0);assert.equal(audio.loads,1);
 player.sync(track({source:'/mc/clip',position:90}));assert.equal(audio.loads,1);assert.equal(player.source,'blob:ready-clip');
});

test('play waits for metadata and cannot race the browser source reset',async()=>{
 class SlowMetadata extends Audio {load(){this.loads++;this.readyState=0;this.ended=false;this.time=0;}}
 const audio=new SlowMetadata(),player=new SpeakerPlayback(audio,async()=> 'blob:song',()=>{},assert.fail);
 player.sync(track());await flush();for(let i=0;i<8;i++)player.sync(track({position:80+i}));
 assert.equal(audio.plays,0);audio.readyState=4;audio.dispatchEvent(new Event('loadedmetadata'));await flush();
 assert.equal(audio.plays,1);assert.equal(audio.currentTime,0);assert.equal(audio.loads,1);
});
test('an old aborted play promise cannot pause a newer resume of the same song',async()=>{
 class DeferredAudio extends Audio {pending=[];play(){this.plays++;this.paused=false;return new Promise((resolve,reject)=>this.pending.push({resolve,reject}));}}
 const audio=new DeferredAudio(),errors=[],player=new SpeakerPlayback(audio,async()=> 'blob:song',()=>{},e=>errors.push(e));
 player.sync(track());await flush();audio.time=32;
 player.sync(track({status:'paused'}));player.sync(track());await flush();assert.equal(audio.pending.length,2);
 audio.pending[1].resolve();audio.pending[0].reject(new DOMException('Paused old request','AbortError'));await flush();
 assert.deepEqual(errors,[]);assert.equal(audio.paused,false);assert.equal(audio.currentTime,32);assert.equal(audio.loads,1);
});
test('a transient browser AbortError retries play without reloading or seeking',async()=>{
 const audio=new Audio(),errors=[];audio.play=function(){this.plays++;if(this.plays===1)return Promise.reject(new DOMException('Interrupted start','AbortError'));this.paused=false;return Promise.resolve();};
 const player=new SpeakerPlayback(audio,async()=> 'blob:song',()=>{},e=>errors.push(e));
 player.sync(track());await new Promise(r=>setTimeout(r,90));
 assert.equal(audio.plays,2);assert.equal(audio.paused,false);assert.equal(audio.loads,1);assert.deepEqual(audio.seeks,[]);assert.deepEqual(errors,[]);
});
test('a stale outgoing announcement failure cannot pause the newly selected music',async()=>{
 let reject,server={playback_id:'mc'},pauses=0;const audio=new Audio();
 audio.play=function(){this.plays++;return new Promise((_resolve,r)=>{reject=r;});};
 let player;player=new SpeakerPlayback(audio,async()=> 'blob:mc',()=>{},()=>{if(currentSpeakerFailure(player.key,server))pauses++;});
 player.sync(track({key:'mc',source:'mc'}));await flush();
 // Accepting a server response updates the logical transport before React's
 // audio effect runs. The old browser promise may settle in that interval.
 server={playback_id:'music'};reject(Error('Late outgoing announcement failure'));await flush();assert.equal(pauses,0);
 player.stop();
});
test('stale native error events are ignored; a current decoder error is reported once',async()=>{
 const audio=new Audio(),errors=[],player=new SpeakerPlayback(audio,async()=> 'blob:song',()=>{},e=>errors.push(e));
 player.sync(track());await flush();audio.error=null;player.handleMediaError();assert.equal(errors.length,0);
 audio.currentSrc='blob:outgoing';audio.error={code:4};player.handleMediaError();assert.equal(errors.length,0);
 audio.currentSrc='blob:song';player.handleMediaError();player.handleMediaError();assert.equal(errors.length,1);assert.equal(errors[0].mediaCode,4);
 assert.match(speakerFailureMessage(errors[0]),/decode/);
});
test('Resume makes the play call inside the user gesture and preserves the playhead',async()=>{
 const audio=new Audio(),player=new SpeakerPlayback(audio,async()=> 'blob:song',()=>{},()=>{});
 player.sync(track({status:'paused'}));await flush();audio.time=43;
 assert.equal(player.resumeFromGesture(),true);assert.equal(audio.plays,1,'play must run before the handler returns');await flush();
 assert.equal(audio.currentTime,43);assert.equal(audio.loads,1);assert.deepEqual(audio.seeks,[]);
});
test('full-file fetch bypasses range caches and retries a partial response without publishing it',async()=>{
 const requests=[],published=[];
 const cache=new SpeakerAudioCache(async(_source,options)=>{requests.push(options);return new Response(new Uint8Array(4),{status:requests.length===1?206:200,headers:{'Content-Type':'audio/mpeg','Content-Length':'4',...(requests.length===1?{'Content-Range':'bytes 0-3/100'}:{})}});},blob=>{published.push(blob);return 'blob:full';});
 assert.equal(await cache.get('/song'),'blob:full');assert.equal(requests.length,2);assert(requests.every(x=>x.cache==='no-store'));assert.equal(published.length,1);cache.dispose();
});
