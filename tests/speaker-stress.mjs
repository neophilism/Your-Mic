import assert from 'node:assert/strict';
import {SpeakerPlayback,SpeakerAudioCache} from '../lib/speaker-audio.ts';
import {SpeakerHeartbeat} from '../lib/speaker-session.ts';
class Audio extends EventTarget {
 src='';paused=true;ended=false;readyState=0;duration=300;time=0;loads=0;seeks=0;pauses=0;
 get currentTime(){return this.time;}set currentTime(value){this.seeks++;this.time=value;}
 pause(){if(!this.paused&&!this.ended)this.pauses++;this.paused=true;}
 play(){this.paused=false;return Promise.resolve();}
 load(){this.loads++;this.time=0;this.ended=false;this.readyState=4;this.dispatchEvent(new Event('loadedmetadata'));}
}
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
let requests=0,revoked=0,warnings=0,failures=0;
const audio=new Audio(),cache=new SpeakerAudioCache(async()=>{requests++;return new Response(new Uint8Array(32),{headers:{'Content-Type':'audio/wav','Content-Length':'32'}});},()=>`blob:complete-${requests}`,()=>{});
const player=new SpeakerPlayback(audio,source=>cache.get(source),()=>{},()=>failures++);
const heartbeat=new SpeakerHeartbeat(async()=>{throw Error('Injected network timeout');},()=>warnings++,()=>{revoked++;player.stop();});
let polls=0;
for(let song=0;song<400;song++)for(const side of ['opening','music','closing']){
 const source=`/${side}/${song}`,target={key:`${side}-${song}`,source,status:'playing',position:0};
 cache.keep([source]);player.sync(target);await flush();assert(player.ready);assert.equal(audio.currentTime,0);
 for(let poll=0;poll<100;poll++){
  audio.time+=0.25;const expected=audio.time;
  player.sync({...target,position:1000+poll*70});polls++;
  assert.equal(audio.currentTime,expected,'Polling must never move the decoded playhead');
  if(poll%20===0)await heartbeat.tick();
  player.handleMediaError(); // Stale/bare native error events are harmless.
 }
 audio.time=audio.duration;audio.ended=true;audio.paused=true;assert(player.ended);
}
assert.equal(audio.seeks,0);assert.equal(audio.pauses,0);assert.equal(failures,0);assert.equal(revoked,0);assert.equal(requests,1200);
heartbeat.stop();player.stop();cache.dispose();
console.log(JSON.stringify({result:'Speaker stress passed',musicStarts:400,mcClips:800,transportPhases:1200,pollUpdates:polls,injectedHeartbeatFailures:warnings,unexpectedSeeks:audio.seeks,unexpectedPauses:audio.pauses,playbackErrors:failures}));
