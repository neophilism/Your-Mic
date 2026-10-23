export function nextSelection(event: any, tracks: any[], queue: any[]) {
  const scheduled = event.mic_after_track && event.current_track === event.mic_after_track;
  const mode = event.pending_mode || (scheduled ? 'mic' : event.mode);
  if (mode === 'mic' || (mode === 'auto' && queue.some(q=>q.status==='waiting'))) {
    const entry = queue.find(q=>q.status==='waiting');
    return {mode, entry:entry||null, track:entry ? tracks.find(t=>t.id===entry.track_id)||null : null, cursor:event.album_cursor};
  }
  const index = tracks.findIndex(t=>t.id===event.album_cursor);
  const track = tracks.length ? tracks[(index+1)%tracks.length] : null;
  return {mode, entry:null, track, cursor:track?.id||event.album_cursor};
}
export function playbackPosition(event:any, now=Date.now()) {
  return Math.max(0,(event.position||0)+(event.status==='playing'&&event.started_at ? (now-event.started_at)/1000 : 0));
}
export function parseRange(header:string|null,size:number) {
  if (!header) return null;
  const m=/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!m||(!m[1]&&!m[2])||size<=0) throw new Error('range');
  let start:number,end:number;
  if(!m[1]) { const n=Number(m[2]); if(n<=0)throw new Error('range'); start=Math.max(0,size-n); end=size-1; }
  else {start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),size-1):size-1;}
  if(start>=size||start>end||!Number.isSafeInteger(start)||!Number.isSafeInteger(end))throw new Error('range');
  return {offset:start,length:end-start+1};
}
