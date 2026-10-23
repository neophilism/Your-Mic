import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SpeakerOpening} from '../lib/speaker-opening.ts';
import {SpeakerResume} from '../lib/speaker-session.ts';
import {SpeakerPlayback} from '../lib/speaker-audio.ts';
const opening={playback_id:'opening',announcement_id:'clip',announcement_kind:'track-start',current_track:'song',current_entry:'rapper',status:'playing'};
const target={key:'opening',source:'blob:voice',position:0,status:'playing'};
const music={...opening,playback_id:'music',announcement_id:null,announcement_kind:null};
test('early server music confirmation cannot cut off or restart the audible opening',()=>{
 const handoff=new SpeakerOpening();assert(handoff.begin(opening,target));assert(!handoff.begin(opening,target));
 assert.equal(handoff.target(opening,'opening',false),null);
 for(let i=0;i<100;i++)assert.deepEqual(handoff.target(music,'opening',false),target);
 assert(handoff.holdingMusic(music,'opening'));assert(handoff.finish('opening'));
 assert.equal(handoff.target(music,'opening',true),null);assert(!handoff.holdingMusic(music,'opening'));
});
test('pause/resume during an already confirmed opening retains the MC decoder and reports music position zero',()=>{
 const handoff=new SpeakerOpening();handoff.begin(opening,target);
 assert.equal(handoff.target({...music,status:'paused'},'opening',false).status,'paused');
 assert.equal(handoff.target(music,'opening',false).status,'playing');
 assert(handoff.holdingMusic(music,'opening'));assert(!handoff.holdingMusic(music,'different'));
});
test('explicit selection, a different rapper, and teardown discard an old held opening',()=>{
 for(const changed of [{...music,current_track:'other'},{...music,current_entry:'other'},{...opening,playback_id:'new-opening'}]){
  const handoff=new SpeakerOpening();handoff.begin(opening,target);assert.equal(handoff.target(changed,'opening',false),null);assert(!handoff.finish('opening'));
 }
 const handoff=new SpeakerOpening();handoff.begin(opening,target);handoff.clear();assert.equal(handoff.target(music,'opening',false),null);
});
test('a late or failed server confirmation does not restart an ended opening',()=>{
 const handoff=new SpeakerOpening();handoff.begin(opening,target);assert(handoff.finish('opening'));
 assert.equal(handoff.target(opening,'opening',true),null);assert.equal(handoff.target(music,'opening',true),null);
});
test('the full song download finishes before an opening can start, with no repeat download at the handoff',async()=>{
 class Audio extends EventTarget {src='';paused=true;ended=false;readyState=0;duration=5;currentTime=0;load(){this.readyState=4;this.dispatchEvent(new Event('loadedmetadata'));}pause(){this.paused=true;}play(){this.paused=false;return Promise.resolve();}}
 const audio=new Audio(),calls=[];let finishMusic;const musicReady=new Promise(r=>finishMusic=r);
 const player=new SpeakerPlayback(audio,async source=>{calls.push(source);if(source==='song')await musicReady;return 'blob:'+source;},()=>{},assert.fail);
 player.sync({...target,source:'voice',before:'song'});await new Promise(r=>setTimeout(r,0));assert(audio.paused);assert.equal(audio.src,'');assert.deepEqual(calls,['song']);
 finishMusic();await new Promise(r=>setTimeout(r,0));assert.equal(audio.src,'blob:voice');assert.equal(audio.paused,false);assert.deepEqual(calls,['song','voice']);
});

test('a lost Resume acknowledgement remains pending across the opening-to-music boundary',async()=>{
 let fail=true;const sent=[];const intent=new SpeakerResume(async key=>{sent.push(key);if(fail)throw Error('Network');},()=>{});
 intent.begin('opening');await intent.confirm();intent.transfer('opening','music');assert.equal(intent.status('music','paused'),'playing');
 fail=false;await intent.confirm();assert.deepEqual(sent,['opening','music']);assert.equal(intent.status('music','paused'),'paused');
});
