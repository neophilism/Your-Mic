import { env } from 'cloudflare:workers';
import QRCode from 'qrcode/lib/core/qrcode.js';
import SVG from 'qrcode/lib/renderer/svg-tag.js';
import {nextSelection,playbackPosition,parseRange} from './playback';
import {mcPlan,mcSpecialPlan,mcTrackPlan,MC_TEXT_LIMIT} from './mc';
import {prepareMc,speechAvailable,speechProfile} from './mc-storage';
const consent='Notify me by email when this album is available on streaming platforms.';
const json=(v:any,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(s:number,m:string,code?:string):never=>{throw Object.assign(new Error(m),{status:s,code});};
const text=(v:any,max=120)=>String(v??'').trim().slice(0,max);
async function hash(v:string){const a=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return Array.from(new Uint8Array(a),x=>x.toString(16).padStart(2,'0')).join('');}
const db=()=>{if(!env.DB)fail(503,'Storage is not ready. Try again shortly.');return env.DB!;};
const bucket=()=>{if(!env.BUCKET)fail(503,'Audio storage is not ready.');return env.BUCKET!;};
async function first(sql:string,...p:any[]){return db().prepare(sql).bind(...p).first<any>();}
async function all(sql:string,...p:any[]){return (await db().prepare(sql).bind(...p).all<any>()).results;}
async function run(sql:string,...p:any[]){return db().prepare(sql).bind(...p).run();}
function uid(r:Request){return r.headers.get('oai-authenticated-user-id');}
function auth(r:Request){const id=uid(r);if(!id)fail(401,'Sign in as the artist to continue.');return id!;}
async function eventFor(id:string,r?:Request){const e=await first('SELECT * FROM events WHERE id=?',id);if(!e)fail(404,'This event could not be found.');if(r&&e.owner_id!==auth(r))fail(403,'Only this event’s artist can change it.');return e;}
function originCheck(r:Request){const o=r.headers.get('origin');if(o&&o!==new URL(r.url).origin)fail(403,'Please use this app directly.');if(r.headers.get('sec-fetch-site')==='cross-site')fail(403,'Please use this app directly.');}
async function body(r:Request){if(Number(r.headers.get('content-length')||0)>16000)fail(413,'That request is too large.');try{return await r.json() as any;}catch{fail(400,'Please check the form and try again.');}}
async function guest(r:Request){const token=r.headers.get('x-guest-token')||'';if(!/^[a-f0-9-]{36}$/i.test(token))fail(400,'Refresh the page to set up your queue pass.');return hash(token);}
async function snapshot(id:string,r:Request){
  const e=await eventFor(id);const own=uid(r)===e.owner_id;
  const token=r.headers.get('x-guest-token');const gh=token?await hash(token):'';
  const tracks=await all(`SELECT id,title,position,duration,beat_duration,rap_allowed AS rapAllowed,beat_key IS NOT NULL AS hasBeat${own?',mc_text,mc_intro_text,audio_key AS audioRevision,beat_key AS beatRevision':''} FROM tracks WHERE event_id=? ORDER BY position,id`,id);
  const queue=await all("SELECT id,track_id,name,status,created_at,guest_hash FROM entries WHERE event_id=? AND status IN ('waiting','playing') ORDER BY created_at,id",id);
  const {owner_id,controller_hash,intro_text,outro_text,local_session_id,local_sequence,...event}=e;
  Object.assign(event,{local_playback:!!local_session_id});
  if(own)Object.assign(event,{intro_text,outro_text});
  const announcement=e.announcement_id?await first('SELECT text FROM mc_clips WHERE id=?',e.announcement_id):null;
  const lastTurn=gh?await first("SELECT entries.id,entries.name,tracks.title AS trackTitle FROM entries JOIN tracks ON tracks.id=entries.track_id WHERE entries.event_id=? AND entries.guest_hash=? AND entries.status='done' ORDER BY entries.created_at DESC,entries.id DESC LIMIT 1",id,gh):null;
  const speakerOwnedHere=own&&!!controller_hash&&controller_hash===await hash(r.headers.get('x-controller-token')||'');
  return {event,tracks,lastTurn,announcementText:announcement?.text||null,...(own?{artistStorageKey:await hash('artist:'+owner_id),localSession:local_session_id,localSequence:local_sequence,speechAvailable:speechAvailable(env),mcVoice:speechProfile(env).label,mcVoiceKey:speechProfile(env).key,mcExpressivity:speechProfile(env).expressivity,milesReady:!!env.DEEPGRAM_API_KEY?.trim()}:{}),queue:queue.map(({guest_hash,...q}:any)=>({...q,mine:guest_hash===gh})),isOwner:own,serverNow:Date.now(),...(own?{speakerOwnedHere}:{}),speakerHere:speakerOwnedHere};
}
async function localControl(e:any,b:any,r:Request,ch:string,now:number){
  const validId=(v:any)=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);
  if(b.action==='local-start'){
    if(!validId(b.localSession))fail(400,'A local show session is required.');
    if(e.local_session_id){if(e.controller_hash===ch&&e.local_session_id===b.localSession)return json(await snapshot(e.id,r));fail(409,'A downloaded show is reserved on another tab or device. Stop it there before switching.');}
    if(e.controller_hash&&e.controller_hash!==ch)fail(409,'Stop the current speaker device before starting local playback here.');
    const same=e.controller_hash===ch;
    const position=same&&b.playbackId===e.playback_id&&Number.isFinite(b.position)&&b.position>=0&&b.position<=7200?b.position:Math.max(0,e.position||0);
    const claimed=await run("UPDATE events SET local_session_id=?,local_sequence=0,controller_hash=?,controller_until=?,status='paused',position=?,started_at=NULL,version=version+1 WHERE id=? AND version=? AND local_session_id=''",b.localSession,ch,now+45000,position,e.id,e.version);
    if(!claimed.meta.changes)fail(409,'The show changed while starting local playback. Try again.');
    return json(await snapshot(e.id,r));
  }
  if(b.action==='local-recover'){
    if(b.confirmSpeakerStopped!==true)fail(400,'Stop audio on the original device before resetting its reservation.');
    await run("UPDATE events SET local_session_id='',local_sequence=0,controller_hash=NULL,controller_until=0,status='paused',started_at=NULL,version=version+1 WHERE id=? AND local_session_id=?",e.id,e.local_session_id);
    return json(await snapshot(e.id,r));
  }
  if(!e.local_session_id||e.local_session_id!==b.localSession||e.controller_hash!==ch)fail(409,'This device does not own the downloaded show.');
  if(b.action==='local-release'){
    const released=await run("UPDATE events SET local_session_id='',local_sequence=0,status='paused',started_at=NULL,controller_until=?,version=version+1 WHERE id=? AND local_session_id=? AND controller_hash=? AND local_sequence=?",now+45000,e.id,b.localSession,ch,b.sequence);
    if(!released.meta.changes)fail(409,'Sync the stopped show before releasing this device.');
    return json(await snapshot(e.id,r));
  }
  if(b.action!=='local-report')fail(400,'Unknown local playback action.');
  if(!Number.isSafeInteger(b.sequence)||b.sequence<=0)fail(400,'Invalid local playback sequence.');
  if(b.sequence<=e.local_sequence)return json(await snapshot(e.id,r));
  const state=b.state||{},done=b.completedIds||[];
  if(!['playing','paused','idle'].includes(state.status)||!['album','auto','mic'].includes(state.mode)||!Number.isFinite(state.position)||state.position<0||state.position>7200||!validId(state.playback_id)||!Array.isArray(done)||done.length>100||done.some(x=>!validId(x)))fail(400,'Invalid local playback state.');
  const ts=await all('SELECT id FROM tracks WHERE event_id=?',e.id),hasTrack=(id:any)=>id===null||ts.some(t=>t.id===id);
  if(!hasTrack(state.current_track)||!hasTrack(state.album_cursor)||!hasTrack(state.mic_after_track)||state.pending_mode!==null&&!['album','auto','mic'].includes(state.pending_mode))fail(400,'Local playback references an unavailable track or mode.');
  if(state.current_entry&&!await first('SELECT id FROM entries WHERE id=? AND event_id=? AND track_id=?',state.current_entry,e.id,state.current_track))fail(400,'That performer is not queued for this track.');
  if(state.announcement_id&&!await first("SELECT id FROM mc_clips WHERE id=? AND event_id=? AND state='ready'",state.announcement_id,e.id))fail(400,'That announcement is unavailable.');
  if(state.announcement_id&&!['between','intro','outro','track-start','track-end'].includes(state.announcement_kind)||!state.current_track&&!state.announcement_id&&state.status==='playing'||done.includes(state.current_entry))fail(400,'Invalid local playback transition.');
  const update=db().prepare('UPDATE events SET local_sequence=?,mode=?,pending_mode=?,mic_after_track=?,status=?,current_track=?,current_entry=?,album_cursor=?,position=?,started_at=?,controller_until=?,announcement_id=?,announcement_kind=?,intro_played=?,end_after_track=?,show_ended=?,queue_open=?,playback_id=?,version=version+1 WHERE id=? AND local_session_id=? AND controller_hash=? AND local_sequence<?').bind(b.sequence,state.mode,state.pending_mode,state.mic_after_track,state.status,state.current_track,state.current_entry,state.album_cursor,state.position,state.status==='playing'?now:null,now+45000,state.announcement_id||null,state.announcement_id?state.announcement_kind:null,state.intro_played?1:0,state.end_after_track?1:0,state.show_ended?1:0,state.queue_open?1:0,state.playback_id,e.id,b.localSession,ch,b.sequence);
  const guard='EXISTS(SELECT 1 FROM events WHERE id=? AND local_session_id=? AND local_sequence=?)';
  const statements=[update];
  if(done.length)statements.push(db().prepare(`UPDATE entries SET status='done' WHERE event_id=? AND id IN (${done.map(()=>'?').join(',')}) AND status IN ('waiting','playing') AND ${guard}`).bind(e.id,...done,e.id,b.localSession,b.sequence));
  if(state.current_entry)statements.push(db().prepare(`UPDATE entries SET status='playing' WHERE event_id=? AND id=? AND ${guard}`).bind(e.id,state.current_entry,e.id,b.localSession,b.sequence));
  await db().batch(statements);
  return json(await snapshot(e.id,r));
}
async function splitTransition(e:any,b:any,r:Request,now:number){
  if(Number(b.version)!==e.version)fail(409,'Playback changed. Refreshing the queue.');
  if(b.action==='finish-announcement'&&(!e.announcement_id||b.announcementId!==e.announcement_id))fail(409,'This announcement already changed.');
  // The opening already owns its selected track/rapper. Finishing it needs
  // neither another queue selection nor catalog/entry reads.
  if(b.action==='finish-announcement'&&e.announcement_kind==='track-start'){
    const result=await run('UPDATE events SET announcement_id=NULL,announcement_kind=NULL,status=?,position=0,started_at=?,playback_id=?,version=version+1 WHERE id=? AND version=?',e.current_track?'playing':'idle',e.current_track?now:null,crypto.randomUUID(),e.id,e.version);
    if(!result.meta.changes)fail(409,'Playback changed.');return json(await snapshot(e.id,r));
  }
  const ts=await all('SELECT * FROM tracks WHERE event_id=? ORDER BY position,id',e.id);
  const qs=await all("SELECT * FROM entries WHERE event_id=? AND status='waiting' ORDER BY created_at,id",e.id);
  const clipFor=async(id:any,plan:any)=>id&&plan?first("SELECT id FROM mc_clips WHERE id=? AND event_id=? AND context=? AND state='ready'",id,e.id,plan.context):null;
  const opening=async(track:any,entry:any)=>await clipFor(b.openingClipId,mcTrackPlan(e,track,'track-start',entry))||await clipFor(b.genericOpeningClipId,mcTrackPlan(e,track,'track-start'))||await clipFor(b.trackOpeningClips?.[track?.id],mcTrackPlan(e,track,'track-start'));
  // The outgoing credit plays before selecting a successor. A last-second
  // queue arrival during this credit therefore takes priority at the next step.
  if(!e.announcement_id&&e.current_track&&['next','end'].includes(b.action)){
    const closing=await clipFor(b.closingClipId,mcTrackPlan(e,ts.find(t=>t.id===e.current_track),'track-end'));
    if(closing){
      const result=await run("UPDATE events SET announcement_id=?,announcement_kind='track-end',position=0,status='playing',started_at=?,playback_id=?,end_after_track=?,version=version+1 WHERE id=? AND version=?",closing.id,now,crypto.randomUUID(),b.action==='end'?1:e.end_after_track,e.id,e.version);
      if(!result.meta.changes)fail(409,'Playback changed.');return json(await snapshot(e.id,r));
    }
  }
  if(e.announcement_id&&e.announcement_kind!=='track-end'&&b.action!=='select'&&b.action!=='end'){
    // Show intro -> this track's opening -> music. An opening/outro/legacy
    // announcement finishes directly into its already selected music/idle.
    const track=ts.find(t=>t.id===e.current_track);
    const entry=e.current_entry?await first('SELECT * FROM entries WHERE id=? AND event_id=?',e.current_entry,e.id):null;
    const clip=e.announcement_kind==='intro'?await opening(track,entry):null;
    const result=await run('UPDATE events SET announcement_id=?,announcement_kind=?,status=?,position=0,started_at=?,playback_id=?,version=version+1 WHERE id=? AND version=?',clip?.id||null,clip?'track-start':null,track||clip?'playing':'idle',track||clip?now:null,crypto.randomUUID(),e.id,e.version);
    if(!result.meta.changes)fail(409,'Playback changed.');return json(await snapshot(e.id,r));
  }
  let pick=nextSelection(e,ts,qs);
  if(b.action==='select'){
    const track=ts.find(t=>t.id===b.trackId);if(!track)fail(404,'Track not found.');
    pick={mode:e.mode==='auto'?'auto':'album',entry:null,track,cursor:track.id};
  }
  const ending=b.action==='end'||!!e.end_after_track&&(b.action==='next'||b.action==='finish-announcement'&&e.announcement_kind==='track-end');
  if(ending)pick={mode:pick.mode,entry:null,track:null,cursor:e.album_cursor};
  const starting=b.action==='play'&&!e.current_track&&!e.intro_played;
  const special=ending?(e.outro_enabled?mcSpecialPlan(e,'outro'):null):starting?(e.intro_enabled?mcSpecialPlan(e,'intro'):null):null;
  const specialClip=await clipFor(ending?b.outroClipId:b.introClipId,special);
  const clip=specialClip||(!ending?await opening(pick.track,pick.entry):null);
  const kind=specialClip?special!.kind:clip?'track-start':null,newVersion=e.version+1;
  const update=db().prepare("UPDATE events SET mode=?,pending_mode=NULL,mic_after_track=?,status=?,current_track=?,current_entry=?,album_cursor=?,position=0,started_at=?,controller_until=?,version=?,announcement_id=?,announcement_kind=?,end_after_track=0,show_ended=?,queue_open=?,intro_played=?,playback_id=? WHERE id=? AND version=? AND (? IS NULL OR EXISTS(SELECT 1 FROM entries WHERE id=? AND status='waiting'))").bind(pick.mode,e.mic_after_track===e.current_track?null:e.mic_after_track,pick.track||clip?'playing':'idle',pick.track?.id||null,pick.entry?.id||null,pick.cursor,pick.track||clip?now:null,now+45000,newVersion,clip?.id||null,kind,ending?1:0,ending?0:e.queue_open,ending?0:starting?1:e.intro_played,crypto.randomUUID(),e.id,e.version,pick.entry?.id||null,pick.entry?.id||null);
  const statements=[update];
  if(e.current_entry)statements.push(db().prepare("UPDATE entries SET status='done' WHERE id=? AND EXISTS(SELECT 1 FROM events WHERE id=? AND version=? AND current_entry IS NOT ?)").bind(e.current_entry,e.id,newVersion,e.current_entry));
  if(pick.entry)statements.push(db().prepare('UPDATE entries SET status=\'playing\' WHERE id=? AND EXISTS(SELECT 1 FROM events WHERE id=? AND version=? AND current_entry=?)').bind(pick.entry.id,e.id,newVersion,pick.entry.id));
  const result=await db().batch(statements);if(!result[0].meta.changes)fail(409,'Playback changed. Refreshing the queue.');
  return json(await snapshot(e.id,r));
}
async function control(e:any,b:any,r:Request){
  const token=text(b.controller,80); if(!/^[a-f0-9-]{36}$/i.test(token))fail(400,'Reconnect this speaker device.');
  const ch=await hash(token);const now=Date.now();
  if(String(b.action).startsWith('local-'))return localControl(e,b,r,ch,now);
  if(e.local_session_id)fail(409,'This show is playing from saved audio. End local playback on its reserved device before switching.');
  const reportedPosition=typeof b.position==='number'&&Number.isFinite(b.position)&&b.position>=0&&b.position<=7200&&typeof b.playbackId==='string'&&b.playbackId===e.playback_id?b.position:null;
  if(b.action==='claim'){
    if(e.controller_hash&&e.controller_hash!==ch&&b.force!==true)fail(409,'Another device controls the speaker. Use “Take over speaker” if you intend to switch devices.');
    // A new controller starts paused, so two devices never intentionally play at once.
    const switching=e.controller_hash!==ch;
    const resumePosition=!switching&&reportedPosition!==null?reportedPosition:Math.max(0,e.position||0);
    const claimed=await run('UPDATE events SET controller_hash=?,controller_until=?,status=?,position=?,started_at=?,version=version+1 WHERE id=? AND version=? AND (?=1 OR controller_hash IS NULL OR controller_hash=?)',ch,now+45000,switching&&e.status==='playing'?'paused':e.status,resumePosition,e.status==='playing'&&!switching?now:null,e.id,e.version,b.force===true?1:0,ch);
    if(!claimed.meta.changes)fail(409,'Playback changed while connecting. Try again.');
    return json(await snapshot(e.id,r));
  }
  // Controller ownership has no timeout. Only an explicit takeover can
  // replace an existing controller; heartbeat timing never revokes ownership.
  if(e.controller_hash!==ch)fail(409,'Speaker control moved to another device.','speaker_taken_over');
  if(b.action==='heartbeat'){
    // A late heartbeat may renew this controller's lease, but its playhead can
    // never overwrite a newer song or announcement instance.
    let renewed=reportedPosition!==null&&e.status==='playing'
      ?await run("UPDATE events SET controller_until=?,position=?,started_at=? WHERE id=? AND controller_hash=? AND playback_id=? AND status='playing'",now+45000,reportedPosition,now,e.id,ch,e.playback_id)
      :null;
    if(!renewed?.meta.changes)renewed=await run('UPDATE events SET controller_until=? WHERE id=? AND controller_hash=?',now+45000,e.id,ch);
    if(!renewed.meta.changes)fail(409,'Speaker control moved to another device.','speaker_taken_over');
    return json({ok:true,controllerUntil:now+45000,serverNow:now});
  }
  if(!['play','pause','next','select','finish-announcement','end'].includes(b.action))fail(400,'Unknown playback action.');
  // Existing open artist tabs retain their previous protocol until refreshed.
  // Only the new client requests split, per-track announcement stages.
  if(b.splitMc&&b.action!=='pause'&&!(b.action==='play'&&(e.current_track||e.announcement_id)))return splitTransition(e,b,r,now);
  if(b.action==='finish-announcement'||(b.action==='next'&&e.announcement_id)){
    if(!e.announcement_id||Number(b.version)!==e.version||b.action==='finish-announcement'&&b.announcementId!==e.announcement_id)fail(409,'This announcement already changed.');
    const result=await run("UPDATE events SET announcement_id=NULL,announcement_kind=NULL,status=?,position=0,started_at=?,playback_id=?,version=version+1 WHERE id=? AND version=?",e.current_track?'playing':'idle',e.current_track?now:null,crypto.randomUUID(),e.id,e.version);
    if(!result.meta.changes)fail(409,'Playback changed.');return json(await snapshot(e.id,r));
  }
  if(b.action==='play'&&b.playbackId&&b.playbackId!==e.playback_id)fail(409,'That audio already changed. Refreshing speaker state.');
  if(b.action==='pause'){
    if(b.playbackId&&b.playbackId!==e.playback_id)fail(409,'That audio already changed. Refreshing speaker state.');
    const result=await run("UPDATE events SET status='paused',position=?,started_at=NULL,version=version+1 WHERE id=? AND version=?",reportedPosition??playbackPosition(e,now),e.id,e.version);if(!result.meta.changes)fail(409,'Playback changed. Try again.');
  } else if(b.action==='play'&&(e.current_track||e.announcement_id)){
    const result=await run("UPDATE events SET status='playing',started_at=?,controller_until=?,version=version+1 WHERE id=? AND version=?",now,now+45000,e.id,e.version);if(!result.meta.changes)fail(409,'Playback changed. Try again.');
  } else {
    if(['next','end','select'].includes(b.action)&&Number(b.version)!==e.version)fail(409,'Playback changed. Refreshing the queue.');
    const ts=await all('SELECT * FROM tracks WHERE event_id=? ORDER BY position,id',e.id);
    const qs=await all("SELECT * FROM entries WHERE event_id=? AND status='waiting' ORDER BY created_at,id",e.id);
    let pick=nextSelection(e,ts,qs);
    if(b.action==='select'){
      const t=ts.find(t=>t.id===b.trackId);if(!t)fail(404,'Track not found.');
      pick={mode:e.mode==='auto'?'auto':'album',entry:null,track:t,cursor:t.id};
    }
    const ending=b.action==='end'||b.action==='next'&&!!e.end_after_track;
    if(ending)pick={mode:pick.mode,entry:null,track:null,cursor:e.album_cursor};
    const starting=b.action==='play'&&!e.current_track&&!e.intro_played;
    const plan=ending?(e.outro_enabled?mcSpecialPlan(e,'outro'):null):starting?(e.intro_enabled?mcSpecialPlan(e,'intro'):null):b.action==='next'?mcPlan(e,ts,pick):null;
    const clip=b.mcClipId&&plan?await first("SELECT id FROM mc_clips WHERE id=? AND event_id=? AND context=? AND state='ready'",b.mcClipId,e.id,plan.context):null;
    const newVersion=e.version+1;
    const update=db().prepare("UPDATE events SET mode=?,pending_mode=NULL,mic_after_track=?,status=?,current_track=?,current_entry=?,album_cursor=?,position=0,started_at=?,controller_until=?,version=?,announcement_id=?,announcement_kind=?,end_after_track=0,show_ended=?,queue_open=?,intro_played=?,playback_id=? WHERE id=? AND version=? AND (? IS NULL OR EXISTS(SELECT 1 FROM entries WHERE id=? AND status='waiting'))").bind(pick.mode,e.mic_after_track===e.current_track?null:e.mic_after_track,pick.track||clip?'playing':'idle',pick.track?.id||null,pick.entry?.id||null,pick.cursor,pick.track||clip?now:null,now+45000,newVersion,clip?.id||null,clip?plan!.kind:null,ending?1:0,ending?0:e.queue_open,ending?0:starting?1:e.intro_played,crypto.randomUUID(),e.id,e.version,pick.entry?.id||null,pick.entry?.id||null);
    const statements=[update];
    if(e.current_entry)statements.push(db().prepare("UPDATE entries SET status='done' WHERE id=? AND EXISTS(SELECT 1 FROM events WHERE id=? AND version=? AND current_entry IS NOT ?)").bind(e.current_entry,e.id,newVersion,e.current_entry));
    if(pick.entry)statements.push(db().prepare("UPDATE entries SET status='playing' WHERE id=? AND EXISTS(SELECT 1 FROM events WHERE id=? AND version=? AND current_entry=?)").bind(pick.entry.id,e.id,newVersion,pick.entry.id));
    const result=await db().batch(statements);if(!result[0].meta.changes)fail(409,'Playback changed. Refreshing the queue.');
  }
  return json(await snapshot(e.id,r));
}
export async function api(r:Request){try{
  const u=new URL(r.url);const p=u.pathname.split('/').filter(Boolean).slice(1);const method=r.method;
  if(method!=='GET'&&method!=='HEAD')originCheck(r);
  if(p[0]==='me')return json({signedIn:!!uid(r),name:r.headers.get('oai-authenticated-user-email')||''});
  if(p[0]==='events'&&p.length===1){
    if(method==='GET')return json({events:await all('SELECT id,title,artist,album,record_label,location,created_at,queue_open FROM events ORDER BY created_at DESC LIMIT 30')});
    if(method==='POST'){
      const owner=auth(r);const b=await body(r);if(!text(b.title)||!text(b.artist))fail(400,'Add an event name and artist.');
      if((await first('SELECT COUNT(*) AS n FROM events WHERE owner_id=?',owner)).n>=50)fail(400,'You have reached the 50-event limit.');
      const id=crypto.randomUUID();await run('INSERT INTO events(id,owner_id,title,artist,album,record_label,location,created_at) VALUES(?,?,?,?,?,?,?,?)',id,owner,text(b.title),text(b.artist),text(b.album),text(b.recordLabel),text(b.location),Date.now());return json({id},201);
    }
  }
  if(p[0]==='mine'){const owner=auth(r);return json({events:await all('SELECT id,title,artist,album,record_label,location,created_at FROM events WHERE owner_id=? ORDER BY created_at DESC',owner)});}
  if(p[0]==='mc-audio'&&p[1]&&['GET','HEAD'].includes(method)){
    const clip=await first("SELECT audio_key FROM mc_clips WHERE id=? AND state='ready'",p[1]);if(!clip?.audio_key)fail(404,'Announcement not found.');
    const meta=await bucket().head(clip.audio_key);if(!meta)fail(404,'Announcement not found.');
    let range=null;try{range=parseRange(r.headers.get('range'),meta!.size);}catch{return new Response(null,{status:416,headers:{'Content-Range':`bytes */${meta!.size}`}});}
    const h=new Headers({'Content-Type':'audio/mpeg','Accept-Ranges':'bytes','Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff','Content-Length':String(range?.length||meta!.size)});
    if(range)h.set('Content-Range',`bytes ${range.offset}-${range.offset+range.length-1}/${meta!.size}`);
    if(method==='HEAD')return new Response(null,{status:range?206:200,headers:h});
    const object=await bucket().get(clip.audio_key,range?{range}:undefined);return new Response(object!.body,{status:range?206:200,headers:h});
  }
  if(p[0]==='audio'&&p[1]){
    const t=await first('SELECT * FROM tracks WHERE id=?',p[1]);if(!t)fail(404,'Audio not found.');
    const isBeat=u.searchParams.get('beat')==='1'&&t.beat_key;const key=isBeat?t.beat_key:t.audio_key;
    const meta=await bucket().head(key);if(!meta)fail(404,'This audio is unavailable. Please tell the artist.');
    let range=null;try{range=parseRange(r.headers.get('range'),meta!.size);}catch{return new Response(null,{status:416,headers:{'Content-Range':`bytes */${meta!.size}`}});}
    const h=new Headers({'Content-Type':(isBeat?t.beat_mime:t.mime)||'audio/mpeg','Accept-Ranges':'bytes','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff','ETag':meta!.httpEtag,'Content-Length':String(range?.length||meta!.size)});
    if(range)h.set('Content-Range',`bytes ${range.offset}-${range.offset+range.length-1}/${meta!.size}`);
    if(method==='HEAD')return new Response(null,{status:range?206:200,headers:h});
    const object=await bucket().get(key,range?{range}:undefined);if(!object)fail(404,'Audio not found.');return new Response(object!.body,{status:range?206:200,headers:h});
  }
  if(p[0]!=='events'||!p[1])fail(404,'Not found.');
  const id=p[1];
  if(p.length===2&&method==='GET')return json(await snapshot(id,r));
  if(p[2]==='plays'&&p.length===3&&['GET','POST'].includes(method)){
    if(method==='GET'){
      await eventFor(id,r);
      const tracks=await all("SELECT t.id,t.title,SUM(CASE WHEN p.kind IN ('live','rap') THEN 1 ELSE 0 END) AS livePlays,SUM(CASE WHEN p.kind='rap' THEN 1 ELSE 0 END) AS rapPlays,SUM(CASE WHEN p.kind='preview' THEN 1 ELSE 0 END) AS privatePlays FROM tracks t LEFT JOIN track_plays p ON p.track_id=t.id AND p.event_id=t.event_id WHERE t.event_id=? GROUP BY t.id ORDER BY t.position,t.id",id);
      return json({tracks,totalLivePlays:tracks.reduce((sum,t)=>sum+Number(t.livePlays),0),totalRapPlays:tracks.reduce((sum,t)=>sum+Number(t.rapPlays),0),totalPrivatePlays:tracks.reduce((sum,t)=>sum+Number(t.privatePlays),0)});
    }
    const b=await body(r),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    if(typeof b.playbackId!=='string'||typeof b.trackId!=='string'||!uuid.test(b.playbackId)||!uuid.test(b.trackId)||!['live','rap','preview'].includes(b.kind))fail(400,'Invalid play report.');
    if(b.kind==='preview'){await eventFor(id);await guest(r);}else await eventFor(id,r);
    if(!await first('SELECT id FROM tracks WHERE id=? AND event_id=?',b.trackId,id))fail(404,'Track not found.');
    // Accept delayed reports; retries must survive a changed song or lease.
    // This isolated write never changes transport, queue, clock or speaker state.
    await run('INSERT OR IGNORE INTO track_plays(event_id,playback_id,track_id,kind,played_at) VALUES(?,?,?,?,?)',id,b.playbackId,b.trackId,b.kind,Date.now());
    return json({ok:true});
  }
  if(p[2]==='qr'&&method==='GET'){
    await eventFor(id);const link=`${u.origin}/?event=${encodeURIComponent(id)}`;
    const svg=SVG.render(QRCode.create(link,{errorCorrectionLevel:'M'}),{margin:3,width:600,color:{dark:'#10130f',light:'#ffffff'}});
    return new Response(svg,{headers:{'Content-Type':'image/svg+xml','Cache-Control':'public, max-age=3600','Content-Disposition':'inline; filename="your-mic-qr.svg"'}});
  }
  if(p[2]==='subscribe'&&method==='POST'){
    await eventFor(id);const b=await body(r);const email=text(b.email,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||b.consent!==true)fail(400,'Enter a valid email and agree to the release notification.');
    if((await first('SELECT COUNT(*) AS n FROM subscribers WHERE event_id=?',id)).n>=15000)fail(429,'This list is full. Please ask the artist.');
    await run('INSERT OR IGNORE INTO subscribers(id,event_id,email,created_at,consent) VALUES(?,?,?,?,?)',crypto.randomUUID(),id,email,Date.now(),consent);return json({ok:true});
  }
  if(p[2]==='queue'&&method==='POST'){
    const e=await eventFor(id);if(!e.queue_open)fail(400,'The artist has closed the freestyle queue.');
    const gh=await guest(r);const b=await body(r);if(!text(b.name,40))fail(400,'What should the artist call you?');
    const chosen=await first('SELECT id,rap_allowed FROM tracks WHERE id=? AND event_id=?',b.trackId,id);if(!chosen)fail(404,'Choose a track from this event.');
    if(chosen.rap_allowed===0)fail(400,'This song is for listening only. Choose another track to rap over.');
    const qid=crypto.randomUUID();
    const result=await run("INSERT INTO entries(id,event_id,track_id,name,guest_hash,status,created_at) SELECT ?,?,?,?,?,'waiting',? WHERE NOT EXISTS(SELECT 1 FROM entries WHERE event_id=? AND guest_hash=? AND status IN ('waiting','playing')) AND (SELECT COUNT(*) FROM entries WHERE event_id=? AND status IN ('waiting','playing'))<500 AND EXISTS(SELECT 1 FROM events WHERE id=? AND queue_open=1) AND EXISTS(SELECT 1 FROM tracks WHERE id=? AND event_id=? AND rap_allowed=1)",qid,id,b.trackId,text(b.name,40),gh,Date.now(),id,gh,id,id,b.trackId,id);
    if(!result.meta.changes){if((await first('SELECT rap_allowed FROM tracks WHERE id=? AND event_id=?',b.trackId,id))?.rap_allowed===0)fail(400,'This song is for listening only. Choose another track to rap over.');fail(409,'You are already queued, or this queue is full or closed.');}return json(await snapshot(id,r),201);
  }
  if(p[2]==='queue'&&p[3]&&method==='DELETE'){
    const e=await eventFor(id);const q=await first('SELECT * FROM entries WHERE id=? AND event_id=?',p[3],id);if(!q)fail(404,'Queue entry not found.');
    if(uid(r)!==e.owner_id&&q.guest_hash!==await guest(r))fail(403,'You can only remove your own place.');
    if(q.status==='playing')fail(400,'The artist can skip the current performer using “Next”.');
    await run("UPDATE entries SET status='cancelled' WHERE id=? AND status='waiting'",q.id);return json(await snapshot(id,r));
  }
  const e=await eventFor(id,r);
  if(p[2]==='mc'&&method==='PATCH'){
    const b=await body(r);
    if(b.trackId){
      if(typeof b.text!=='string'||b.text.length>MC_TEXT_LIMIT)fail(400,`Keep announcements under ${MC_TEXT_LIMIT} characters.`);
      if(!await first('SELECT id FROM tracks WHERE event_id=? AND id=?',id,b.trackId))fail(404,'Track not found.');
      if(b.part!==undefined&&!['start','end'].includes(b.part))fail(400,'Choose the opening or closing track clip.');
      await db().batch([db().prepare(`UPDATE tracks SET ${b.part==='start'?'mc_intro_text':'mc_text'}=? WHERE id=? AND event_id=?`).bind(b.text.trim(),b.trackId,id),db().prepare('UPDATE events SET version=version+1 WHERE id=?').bind(id)]);
    }else{
      for(const key of ['introText','outroText'])if(b[key]!==undefined&&(typeof b[key]!=='string'||b[key].length>MC_TEXT_LIMIT))fail(400,`Keep announcements under ${MC_TEXT_LIMIT} characters.`);
      const columns:Record<string,string>={enabled:'mc_enabled',introEnabled:'intro_enabled',introText:'intro_text',outroEnabled:'outro_enabled',outroText:'outro_text',endAfterTrack:'end_after_track'};const keys=Object.keys(columns).filter(key=>b[key]!==undefined);if(keys.length)await run(`UPDATE events SET ${keys.map(key=>columns[key]+'=?').join(',')},version=version+1 WHERE id=?`,...keys.map(key=>key.endsWith('Text')?b[key].trim():b[key]?1:0),id);
    }
    return json(await snapshot(id,r));
  }
  if(p[2]==='mc'&&method==='POST'){
    const b=await body(r);const ts=await all('SELECT * FROM tracks WHERE event_id=? ORDER BY position,id',id);
    let plan;
    if(b.kind==='track-start'||b.kind==='track-end'){
      const track=ts.find(t=>t.id===b.trackId);if(!track)fail(404,'Track not found.');
      const entry=b.entryId?await first("SELECT * FROM entries WHERE id=? AND event_id=? AND track_id=? AND status IN ('waiting','playing')",b.entryId,id,track.id):null;
      if(b.entryId&&!entry)fail(404,'Performer not found in this track’s queue.');
      plan=mcTrackPlan(e,track,b.kind,entry);
    }else if(b.kind==='intro'||b.kind==='outro')plan=mcSpecialPlan(e,b.kind);
    else{
      const qs=await all("SELECT * FROM entries WHERE event_id=? AND status='waiting' ORDER BY created_at,id",id);
      let source=e;
      if(b.trackId&&(b.offlinePlaylist||b.trackId!==e.current_track)){if(!ts.some(t=>t.id===b.trackId))fail(404,'Track not found.');source={...e,current_track:b.trackId,current_entry:null,album_cursor:b.trackId,mode:'album',pending_mode:null,mic_after_track:null,end_after_track:0};}
      plan=mcPlan(source,ts,nextSelection(source,ts,qs));
    }
    return json(plan?await prepareMc(env,id,plan):{state:'idle'});
  }
  if(p.length===2&&method==='PATCH'){
    const b=await body(r);
    if(e.local_session_id&&(b.action||b.queueOpen!==undefined))fail(409,'Use the reserved local playback device to change the show controls.');
    if(b.action==='mode'){
      if(!['album','mic','auto'].includes(b.mode))fail(400,'Choose album or Your Mic.');
      const pending=!!e.current_track;
      await run('UPDATE events SET pending_mode=?,mode=?,version=version+1 WHERE id=?',pending&&b.mode!==e.mode?b.mode:null,pending?e.mode:b.mode,id);
    }else if(b.action==='schedule'){
      if(b.trackId&&!await first('SELECT id FROM tracks WHERE id=? AND event_id=?',b.trackId,id))fail(404,'Track not found.');
      await run('UPDATE events SET mic_after_track=?,version=version+1 WHERE id=?',b.trackId||null,id);
    }else{
      await run('UPDATE events SET title=?,artist=?,album=?,record_label=?,location=?,queue_open=?,version=version+1 WHERE id=?',text(b.title)||e.title,text(b.artist)||e.artist,text(b.album??e.album),text(b.recordLabel??e.record_label),text(b.location??e.location),b.queueOpen===undefined?e.queue_open:b.queueOpen?1:0,id);
    }
    return json(await snapshot(id,r));
  }
  if(p[2]==='control'&&method==='POST')return await control(e,await body(r),r);
  if(p[2]==='tracks'&&e.local_session_id&&method!=='GET')fail(409,'End local playback before changing downloaded tracks or beats.');
  if(p[2]==='subscribers'&&method==='GET'){
    const rows=await all('SELECT email,created_at,consent FROM subscribers WHERE event_id=? ORDER BY created_at',id);
    if(u.searchParams.get('format')!=='csv')return json({count:rows.length});
    const cell=(v:any)=>'"'+(/^[=+\-@\t\r]/.test(String(v))?"'"+String(v):String(v)).replace(/"/g,'""')+'"';
    const csv='Email,Signed up (UTC),Consent\r\n'+rows.map(x=>[x.email,new Date(x.created_at).toISOString(),x.consent].map(cell).join(',')).join('\r\n');
    return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="your-mic-release-list.csv"','Cache-Control':'no-store'}});
  }
  if(p[2]==='tracks'&&method==='POST'){
    const beat=p[3]&&p[4]==='beat';const existing=beat?await first('SELECT * FROM tracks WHERE id=? AND event_id=?',p[3],id):null;
    if(beat&&!existing)fail(404,'Track not found.');
    if((await first('SELECT COUNT(*) AS n FROM tracks WHERE event_id=?',id)).n>=100&&!beat)fail(400,'An event can contain up to 100 tracks.');
    const size=Number(r.headers.get('x-audio-size')||r.headers.get('content-length')||0);if(!Number.isSafeInteger(size)||size<=0)fail(400,'The upload size is missing. Refresh and try again.');if(size>75*1024*1024)fail(413,'Use an audio file smaller than 75 MB. MP3 or M4A is best for an outdoor event.');
    const filename=text(u.searchParams.get('filename'),200);const ext=filename.split('.').pop()?.toLowerCase()||'';
    const types:Record<string,string>={mp3:'audio/mpeg',m4a:'audio/mp4',mp4:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg',aac:'audio/aac',flac:'audio/flac',webm:'audio/webm'};
    if(!types[ext]||!r.body)fail(400,'Choose an MP3, M4A, WAV, OGG, AAC, FLAC, or WebM audio file.');
    const key=`events/${id}/${crypto.randomUUID()}.${ext}`;const duration=Math.min(7200,Math.max(0,Number(u.searchParams.get('duration'))||0));
    const fixed=new FixedLengthStream(size);
    await Promise.all([bucket().put(key,fixed.readable,{httpMetadata:{contentType:types[ext]}}),r.body!.pipeTo(fixed.writable)]);
    try{
      if(beat){await run('UPDATE tracks SET beat_key=?,beat_mime=?,beat_duration=? WHERE id=? AND event_id=?',key,types[ext],duration,existing.id,id);if(existing.beat_key)await bucket().delete(existing.beat_key);}
      else{const tid=crypto.randomUUID();await run('INSERT INTO tracks(id,event_id,title,position,duration,audio_key,mime) SELECT ?,?,?,COALESCE(MAX(position),-1)+1,?,?,? FROM tracks WHERE event_id=?',tid,id,text(u.searchParams.get('title'))||filename.replace(/\.[^.]+$/,''),duration,key,types[ext],id);}
    }catch(err){await bucket().delete(key);throw err;}
    return json(await snapshot(id,r),201);
  }
  if(p[2]==='tracks'&&method==='PATCH'){
    const b=await body(r);
    if(Object.hasOwn(b,'rapAllowed')){
      if(!p[3]||p.length!==4||typeof b.rapAllowed!=='boolean')fail(400,'Choose whether this song allows rap requests.');
      const updated=await run('UPDATE tracks SET rap_allowed=? WHERE id=? AND event_id=?',b.rapAllowed?1:0,p[3],id);
      if(!updated.meta.changes)fail(404,'Track not found.');
      // Availability does not mutate transport, audio, order or existing turns.
      return json(await snapshot(id,r));
    }
    const ts=await all('SELECT id FROM tracks WHERE event_id=?',id);
    if(b.order){if(!Array.isArray(b.order)||b.order.length!==ts.length||new Set(b.order).size!==ts.length||ts.some(t=>!b.order.includes(t.id)))fail(400,'Refresh the playlist before changing its order.');await db().batch(b.order.map((tid:string,i:number)=>db().prepare('UPDATE tracks SET position=? WHERE id=? AND event_id=?').bind(i,tid,id)));}
    else if(p[3]&&text(b.title))await run('UPDATE tracks SET title=? WHERE id=? AND event_id=?',text(b.title),p[3],id);
    return json(await snapshot(id,r));
  }
  if(p[2]==='tracks'&&p[3]&&method==='DELETE'){
    const t=await first('SELECT * FROM tracks WHERE id=? AND event_id=?',p[3],id);if(!t)fail(404,'Track not found.');
    if(e.current_track===t.id||await first("SELECT id FROM entries WHERE track_id=? AND status IN ('waiting','playing')",t.id))fail(400,'This track is playing or selected by a waiting performer.');
    await db().batch([db().prepare('DELETE FROM entries WHERE track_id=?').bind(t.id),db().prepare('DELETE FROM tracks WHERE id=? AND event_id=?').bind(t.id,id)]);
    await bucket().delete([t.audio_key,...(t.beat_key?[t.beat_key]:[])]);return json(await snapshot(id,r));
  }
  fail(404,'Not found.');
}catch(error:any){if(!error.status)console.error('Your Mic API error',error);return json({error:error.status?error.message:'Something went wrong. Please try again.',...(error.code?{code:error.code}:{})},error.status||500);}}

