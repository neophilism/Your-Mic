import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {loadQueuePass,privateQueueLink,recoveryPass,rememberQueueEvent,lastQueueEvent} from '../lib/queue-pass.ts';
function browser({local=true,cookies=true}={}) {
 const data=new Map(),jar=new Map();
 return {data,jar,storage:()=>{if(!local)throw Error('Storage blocked');return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};},cookies:()=>[...jar].map(([k,v])=>`${k}=${v}`).join('; '),setCookie:value=>{if(cookies){const [key,v]=value.split(';')[0].split('=');jar.set(key,v);}},newId:randomUUID};
}
test('navigation, reload and reopening preserve the same queue identity',()=>{
 const b=browser(),event=randomUUID(),first=loadQueuePass(b,event);
 assert(first.durable);assert.equal(loadQueuePass(b,event).token,first.token);
 rememberQueueEvent(b,event);assert.equal(lastQueueEvent(b),event);
});
test('private link recovers a place on another browser without an account',()=>{
 const event=randomUUID(),first=loadQueuePass(browser(),event),url=new URL(privateQueueLink('https://your-mic.test',event,first.token));
 assert(!url.search.includes(first.token));assert.equal(url.searchParams.get('event'),event);
 const other=browser(),restored=loadQueuePass(other,event,url.hash);
 assert(restored.restored);assert.equal(restored.token,first.token);assert.equal(loadQueuePass(other,event).token,first.token);
 assert.equal(recoveryPass(url.hash,randomUUID()),null);
});
test('cookie fallback preserves identity when local storage is blocked',()=>{
 const b=browser({local:false}),event=randomUUID(),first=loadQueuePass(b,event);
 assert(first.durable);assert.equal(loadQueuePass(b,event).token,first.token);
});
test('blocked storage is detectable and the private link still restores identity',()=>{
 const b=browser({local:false,cookies:false}),event=randomUUID(),first=loadQueuePass(b,event);
 assert.equal(first.durable,false);
 assert.equal(loadQueuePass(b,event,new URL(privateQueueLink('https://your-mic.test',event,first.token)).hash).token,first.token);
});
test('existing users keep legacy places and new passes are scoped to events',()=>{
 const b=browser(),legacy=randomUUID(),event=randomUUID();b.data.set('ym-guest',legacy);
 assert.equal(loadQueuePass(b,event).token,legacy);
 const fresh=browser();assert.notEqual(loadQueuePass(fresh,event).token,loadQueuePass(fresh,randomUUID()).token);
});
test('malformed or wrong-event recovery links cannot replace a saved pass',()=>{
 const b=browser(),event=randomUUID(),saved=loadQueuePass(b,event).token;
 for(const hash of ['#queue-pass=garbage',`#queue-pass=v1:${event}:bad`,`#queue-pass=v1:${randomUUID()}:${randomUUID()}`])assert.equal(loadQueuePass(b,event,hash).token,saved);
});
