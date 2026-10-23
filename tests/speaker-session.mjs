import {test} from 'node:test';
import assert from 'node:assert/strict';
import {releaseUnusedMediaUrls} from '../lib/media-urls.ts';
import {SpeakerHeartbeat,SpeakerResume,hasSpeakerControl} from '../lib/speaker-session.ts';
test('an expired lease keeps the current speaker; explicit ownership loss does not',()=>{
 assert.equal(hasSpeakerControl({speakerOwnedHere:true,speakerHere:false}),true);
 assert.equal(hasSpeakerControl({speakerOwnedHere:false,speakerHere:false}),false);
});
test('hundreds of heartbeat failures never revoke the buffered song and recovery is automatic',async()=>{
 let failure=Error('Offline'),lost=0,calls=0;const statuses=[];
 const h=new SpeakerHeartbeat(async()=>{calls++;if(failure)throw failure;},(...args)=>statuses.push(args),()=>lost++);
 for(let i=0;i<500;i++)await h.tick();assert.equal(lost,0);assert.equal(calls,500);assert(statuses.every(s=>s[0]===false&&s[1].includes('buffered song continues')));
 failure=null;await h.tick();assert.equal(lost,0);assert.deepEqual(statuses.at(-1),[true,'']);h.stop();await h.tick();assert.equal(calls,501);
});
test('sign-in expiry warns without cutting sound; an explicit takeover stops the old device once',async()=>{
 let failure=Object.assign(Error('Expired sign-in'),{status:401}),lost=0;const statuses=[];
 const h=new SpeakerHeartbeat(async()=>{throw failure;},(...args)=>statuses.push(args),()=>lost++);
 await h.tick();assert.equal(lost,0);assert.match(statuses[0][1],/sign-in expired/);
 failure=Object.assign(Error('Different controller'),{status:409,code:'speaker_taken_over'});await h.tick();await h.tick();assert.equal(lost,1);
});
test('heartbeat requests cannot overlap and an old reply cannot affect a stopped session',async()=>{
 let finish,calls=0,updates=0;const h=new SpeakerHeartbeat(()=>{calls++;return new Promise(resolve=>finish=resolve);},()=>updates++,assert.fail);
 const pending=h.tick();await h.tick();await h.tick();assert.equal(calls,1);h.stop();finish();await pending;assert.equal(updates,0);
});

test('generic permission/conflict errors cannot stop an already buffered song',async()=>{
 let error={status:403},stops=0;const h=new SpeakerHeartbeat(async()=>{throw error;},()=>{},()=>stops++);await h.tick();error={status:409};await h.tick();assert.equal(stops,0);h.stop();
});
test('lost Resume acknowledgements and stale paused snapshots cannot roll back native playback',async()=>{
 let fail=true,sends=0,warnings=0;const r=new SpeakerResume(async key=>{assert.equal(key,'verse');sends++;if(fail)throw Error('Offline');},()=>warnings++);
 assert.equal(r.status('','paused'),'paused');r.begin('verse');await r.confirm();for(let i=0;i<100;i++)assert.equal(r.status('verse','paused'),'playing');assert.equal(warnings,1);
 fail=false;await r.confirm();assert.equal(sends,2);assert.equal(r.status('verse','playing'),'playing');assert.equal(r.status('verse','paused'),'paused');
 r.begin('verse');r.clear();assert.equal(r.status('verse','paused'),'paused');r.begin('verse');assert.equal(r.status('next-song','paused'),'paused');await r.confirm();assert.equal(sends,2);
});

test('voice-cache cleanup preserves both playing and paused audio sources',()=>{
 const urls=new Set(['blob:playing','blob:paused','blob:resolved','blob:unused']),revoked=[];
 releaseUnusedMediaUrls(urls,[{src:'blob:playing'},{src:'blob:paused'},{src:'url',currentSrc:'blob:resolved'}],url=>revoked.push(url));
 assert.deepEqual(revoked,['blob:unused']);assert.equal(urls.size,3);
 releaseUnusedMediaUrls(urls,[],url=>revoked.push(url));assert.equal(urls.size,0);assert.equal(revoked.length,4);
});
