import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PlayCounter,speakerPlayReport} from '../lib/play-counts.ts';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const report=()=>({playbackId:randomUUID(),trackId:randomUUID(),kind:'live'});
test('only actual speaker music starts can produce a play report',()=>{
 const r=report(),s={isOwner:true,event:{current_track:r.trackId,playback_id:r.playbackId,announcement_id:null}},p={key:r.playbackId,ready:true};
 assert.deepEqual(speakerPlayReport(s,p,true),r);
 assert.equal(speakerPlayReport({...s,event:{...s.event,current_entry:'rapper'}},p,true).kind,'rap');
 assert.equal(speakerPlayReport(s,p,false),null);assert.equal(speakerPlayReport({...s,isOwner:false},p,true),null);
 assert.equal(speakerPlayReport({...s,event:{...s.event,announcement_id:'mc'}},p,true),null);
 assert.equal(speakerPlayReport(s,{...p,key:'outgoing'},true),null);assert.equal(speakerPlayReport(s,{...p,ready:false},true),null);
});
test('pause/resume, repeated playing events and reconnects reuse one play ID; a repeat is a new play',async()=>{
 const sent=[],r=report(),counter=new PlayCounter(async p=>sent.push(p));
 counter.record(r);counter.record(r);await tick();counter.record(r);await tick();assert.equal(sent.length,1);
 counter.record({...r,playbackId:randomUUID()});await tick();assert.equal(sent.length,2);counter.stop();
});
test('network failure is silent and retries a lost response without inventing another play',async()=>{
 const r=report(),server=new Set();let fail=true,calls=0;
 const counter=new PlayCounter(async p=>{calls++;server.add(p.playbackId);if(fail)throw Error('Lost response');});
 assert.equal(counter.record(r),undefined);await tick();assert.equal(server.size,1);
 fail=false;await counter.flush();counter.record(r);await tick();assert.equal(calls,2);assert.equal(server.size,1);counter.stop();
});
test('pending counts survive a page reload, and denied storage cannot throw into playback',async()=>{
 const r=report();let saved='[]';const outbox={read:()=>saved,write:value=>{saved=value;}};
 const offline=new PlayCounter(async()=>{throw Error('Offline');},outbox);offline.record(r);await tick();offline.stop();
 const sent=[],restored=new PlayCounter(async p=>sent.push(p),outbox);await restored.flush();assert.deepEqual(sent,[r]);assert.equal(saved,'[]');restored.stop();
 const denied=new PlayCounter(async()=>{}, {read:()=>{throw Error('Denied');},write:()=>{throw Error('Denied');}});assert.doesNotThrow(()=>denied.record(report()));await tick();denied.stop();
});
