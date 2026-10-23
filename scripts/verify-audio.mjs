import {spawnSync} from 'node:child_process';

// Deployment-only, read-only checks. Nothing is written into the live show.
export function verifyDecodedAudio(bytes) {
  const result = spawnSync('ffmpeg', ['-hide_banner','-loglevel','error','-xerror','-i','pipe:0','-map','0:a:0','-f','null','-'], {input: Buffer.from(bytes), timeout: 120000, maxBuffer: 1024 * 1024});
  if (result.error?.code === 'ENOENT') return false;
  if (result.error || result.status !== 0) throw Error('The audio failed a full-file decoder check. Check the source file before the show.');
  return true;
}
export async function verifyHostedAudio(origin, cookie, fetcher = fetch) {
  const headers = {Cookie: cookie};
  const mine = await fetcher(origin+'/api/mine', {headers, cache: 'no-store', signal: AbortSignal.timeout(10000)});
  if (!mine.ok) throw Error('Could not read the artist events for the audio check.');
  const {events} = await mine.json();
  for (const event of events.slice(0, 10)) {
    const response = await fetcher(origin+'/api/events/'+encodeURIComponent(event.id), {headers, cache: 'no-store', signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw Error('Could not read the set for the audio check.');
    const snapshot = await response.json(), track = snapshot.tracks?.[0];
    if (!track) continue;
    const url = new URL('/api/audio/'+encodeURIComponent(track.id), origin);url.searchParams.set('v',track.audioRevision || '');
    const audio = await fetcher(url, {headers, cache: 'no-store', signal: AbortSignal.timeout(120000)});
    if (audio.status !== 200 || audio.headers.has('content-range') || !(audio.headers.get('content-type') || '').startsWith('audio/')) throw Error(`The first uploaded song did not return a complete audio file (HTTP ${audio.status}).`);
    const bytes = await audio.arrayBuffer(), expected = Number(audio.headers.get('content-length'));
    if (!bytes.byteLength || expected > 0 && bytes.byteLength !== expected) throw Error('The first uploaded song download was truncated.');
    const decoded = verifyDecodedAudio(bytes);
    console.log(`Uploaded song full-file check passed (${bytes.byteLength} bytes${decoded ? ', full decoder check passed' : ', decoder unavailable on this runner'}).`);
    return;
  }
  console.log('Uploaded song check skipped: no uploaded set yet.');
}
