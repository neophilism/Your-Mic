import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {downloadShow, verifySavedShow, showFingerprint, showSources, audioKey, readLocalAudio, removeSavedShow} from '../lib/local-audio.ts';
const require = createRequire(import.meta.url), wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
const {build} = wranglerRequire('esbuild');
const built = await build({entryPoints: ['lib/local-show.ts'], bundle: true, write: false, platform: 'node', format: 'esm'});
await mkdir('work',{recursive:true});await writeFile('work/local-show-test-bundle.mjs',built.outputFiles[0].text);
const {LocalShow} = await import('../work/local-show-test-bundle.mjs');
class Store {
  values = new Map();
  async get(store, key) {return structuredClone(this.values.get(store + key));}
  async put(store, key, value) {this.values.set(store + key, structuredClone(value));}
  async remove(store, key) {this.values.delete(store + key);}
}
const tracks = [{id: 'a', title: 'A', audioRevision: 'a1', hasBeat: 1, beatRevision: 'a-beat1'}, {id: 'b', title: 'B', audioRevision: 'b1', hasBeat: 0}];
const response = () => new Response(new Blob(['complete audio'], {type: 'audio/mpeg'}), {headers: {'Content-Type': 'audio/mpeg', 'Content-Length': '14'}});
function snapshot() {return {isOwner: true, localSession: 'local', event: {id: 'event', title: 'Release', artist: 'Artist', album: 'Album', mode: 'auto', pending_mode: null, mic_after_track: null, status: 'playing', current_track: 'a', current_entry: null, album_cursor: 'a', position: 23.5, started_at: 1000, version: 4, playback_id: 'first', mc_enabled: 0, intro_enabled: 0, outro_enabled: 0, intro_played: 1, queue_open: 1, announcement_id: null}, tracks, queue: [{id: 'q1', track_id: 'b', name: 'One', status: 'waiting'}, {id: 'q2', track_id: 'a', name: 'Two', status: 'waiting'}]};}
const noClip = () => null;
test('downloads album and beats; verifies all complete files before readiness', async () => {
  const store = new Store();let calls = 0;
  const saved = await downloadShow({store, owner: 'artist', eventId: 'event', tracks, fetcher: async () => {calls++;return response();}});
  assert.equal(calls, 3);assert.equal(saved.bytes, 42);assert.equal(await verifySavedShow(store, saved, showFingerprint(tracks)), true);
  await store.remove('audio', audioKey(saved.key, saved.sources[1].source));
  assert.equal(await verifySavedShow(store, saved, saved.fingerprint), false);
});
test('failed and truncated downloads never become ready; retry reuses complete files', async () => {
  const store = new Store();let calls = 0;
  await assert.rejects(downloadShow({store, owner: 'artist', eventId: 'event', tracks, fetcher: async () => {if (++calls === 2) return new Response('short', {headers: {'Content-Type': 'audio/mpeg', 'Content-Length': '99'}});return response();}}), /incomplete/);
  const partial = await store.get('shows', 'artist:event');assert.equal(await verifySavedShow(store, partial, partial.fingerprint), false);
  let retried = 0;
  const saved = await downloadShow({store, owner: 'artist', eventId: 'event', tracks, fetcher: async () => {retried++;return response();}});
  assert.equal(retried, 2);assert.equal(await verifySavedShow(store, saved, saved.fingerprint), true);
});
test('quota and cancellation failures never publish readiness', async () => {
  const store = new Store(), original = store.put;
  store.put = async function (name, ...args) {if (name === 'audio') throw Object.assign(Error('full'), {name: 'QuotaExceededError'});return original.call(this, name, ...args);};
  await assert.rejects(downloadShow({store, owner: 'x', eventId: 'y', tracks, fetcher: async () => response()}), /full/);
  const partial = await store.get('shows', 'x:y');assert.equal(await verifySavedShow(store, partial, partial.fingerprint), false);
  const abort = new AbortController();abort.abort();
  await assert.rejects(downloadShow({store: new Store(), owner: 'x', eventId: 'y', tracks, signal: abort.signal}));
});
test('replacement beats invalidate readiness and cannot serve an older revision', async () => {
  const store = new Store(), saved = await downloadShow({store, owner: 'x', eventId: 'y', tracks, fetcher: async () => response()});
  const changed = [{...tracks[0], beatRevision: 'replacement'}, tracks[1]];
  assert.equal(await verifySavedShow(store, saved, showFingerprint(changed)), false);
  await assert.rejects(readLocalAudio(store, saved, showSources(changed)[1].source), /missing/);
});
test('local audio reads after a new store handle; no fetch fallback when a file is missing', async () => {
  const store = new Store(), saved = await downloadShow({store, owner: 'x', eventId: 'y', tracks, fetcher: async () => response()});
  const reopened = new Store();reopened.values = store.values;
  for (const spec of saved.sources) assert.equal((await readLocalAudio(reopened, saved, spec.source)).headers.get('content-length'), '14');
  await assert.rejects(readLocalAudio(reopened, saved, '/api/audio/missing'), /missing/);
  await assert.rejects(readLocalAudio(reopened, {...saved, key: 'another-artist:y'}, saved.sources[0].source), /missing/);
  await removeSavedShow(store, saved);assert.equal(store.values.size, 0);
});
test('local mode plays known queue in FIFO order, then resumes and loops the album with no server', () => {
  let sequence = 0;const show = new LocalShow(snapshot(), 'local', () => 'instance-' + ++sequence);
  show.transition('next', 120, noClip);assert.equal(show.snapshot.event.current_entry, 'q1');assert.equal(show.snapshot.event.album_cursor, 'a');
  show.transition('next', 120, noClip);assert.equal(show.snapshot.event.current_entry, 'q2');assert.equal(show.snapshot.event.current_track, 'a');
  show.transition('next', 120, noClip);assert.equal(show.snapshot.event.current_track, 'b');assert.equal(show.snapshot.event.current_entry, null);
  for (let i = 0; i < 60; i++) show.transition('next', 120, noClip);
  assert.equal(show.snapshot.event.current_track, 'b');assert.equal(show.snapshot.event.position, 0);assert.equal(sequence, 63);
});
test('stale polls and late acknowledgements cannot move the local playhead or resurrect completed turns', () => {
  const original = snapshot(), show = new LocalShow(original, 'local');
  show.transition('next', 100, noClip);show.transition('next', 100, noClip);show.setPosition(17);
  const key = show.snapshot.event.playback_id;
  for (let i = 0; i < 30; i++) {const remote = structuredClone(original);remote.event.position = 600;remote.event.version = 20 + i;show.merge(remote);}
  assert.equal(show.snapshot.event.playback_id, key);assert.equal(show.snapshot.event.position, 17);assert.equal(show.snapshot.event.current_entry, 'q2');assert(!show.snapshot.queue.some(q => q.id === 'q1'));
});
test('reconnection merges new queue requests while preserving the current song', () => {
  const show = new LocalShow(snapshot(), 'local');show.transition('next', 100, noClip);show.setPosition(19);
  const remote = snapshot();remote.event.version = 100;remote.queue.push({id: 'q3', name: 'Three', track_id: 'b', status: 'waiting'});show.merge(remote);
  assert.equal(show.snapshot.event.current_entry, 'q1');assert.equal(show.snapshot.event.position, 19);
  show.transition('next', 120, noClip);assert.equal(show.snapshot.event.current_entry, 'q2');show.transition('next', 120, noClip);assert.equal(show.snapshot.event.current_entry, 'q3');
});
test('pause/resume and checkpoint recovery preserve decoded position, not wall time', () => {
  const show = new LocalShow(snapshot(), 'local');show.transition('pause', 31.25, noClip);show.transition('play', 31.25, noClip);
  const saved = show.checkpoint('controller');saved.snapshot.event.started_at = Date.now() - 600000;
  const restored = LocalShow.restore(saved);assert.equal(restored.snapshot.event.status, 'paused');assert.equal(restored.snapshot.event.position, 31.25);
  const key = restored.snapshot.event.playback_id;restored.transition('play', restored.snapshot.event.position, noClip);assert.equal(restored.snapshot.event.position, 31.25);assert.equal(restored.snapshot.event.playback_id, key);
});
test('mode/schedule changes wait for boundary; mic mode waits offline when empty', () => {
  const show = new LocalShow({...snapshot(), queue: []}, 'local');show.patch({action: 'mode', mode: 'mic'});
  assert.equal(show.snapshot.event.mode, 'auto');show.transition('next', 120, noClip);assert.equal(show.snapshot.event.status, 'idle');assert.equal(show.snapshot.event.mode, 'mic');
});
test('downloaded closing -> actual next opening -> music never advances the queue twice', () => {
  const s = snapshot();s.event.mc_enabled = 1;const show = new LocalShow(s, 'local');
  const clip = plan => plan ? {id: plan.kind, context: plan.context, text: plan.text, source: 'saved'} : null;
  show.transition('next', 120, clip);assert.equal(show.snapshot.event.announcement_kind, 'track-end');assert.equal(show.snapshot.event.current_entry, null);assert.equal(show.snapshot.event.current_track, 'a');
  const closingKey = show.snapshot.event.playback_id;
  show.transition('finish-announcement', 4, clip);assert.equal(show.snapshot.event.announcement_kind, 'track-start');assert.equal(show.snapshot.event.current_entry, 'q1');assert.equal(show.snapshot.event.current_track, 'b');
  show.transition('finish-announcement', 4, clip);assert.equal(show.snapshot.event.announcement_id, null);assert.equal(show.snapshot.event.current_entry, 'q1');assert.notEqual(show.snapshot.event.playback_id, closingKey);
});
test('missing MC never blocks music; optional intro and early outro work locally', () => {
  const s = snapshot();s.event.intro_enabled = 1;s.event.intro_played = 0;s.event.current_track = null;s.event.album_cursor = null;s.event.outro_enabled = 1;
  const show = new LocalShow(s, 'local'), clip = plan => plan ? ({id: plan.kind, context: plan.context, text: plan.text, source: 'saved'}) : null;
  show.transition('play', 0, clip);assert.equal(show.snapshot.event.announcement_kind, 'intro');show.transition('finish-announcement', 4, noClip);assert.equal(show.snapshot.event.current_track, 'b');
  show.patch({endAfterTrack: true});show.transition('next', 120, clip);assert.equal(show.snapshot.event.announcement_kind, 'outro');show.transition('finish-announcement', 4, noClip);assert.equal(show.snapshot.event.status, 'idle');assert.equal(show.snapshot.event.show_ended, 1);
  const other = new LocalShow(snapshot(), 'local');other.snapshot.event.mc_enabled = 1;other.transition('next', 120, noClip);assert.equal(other.snapshot.event.status, 'playing');assert.equal(other.snapshot.event.announcement_id, null);
});
test('reports are monotonic, bound completed turns, and retain unacknowledged work', () => {
  const show = new LocalShow(snapshot(), 'local');show.transition('next', 100, noClip);show.transition('next', 100, noClip);
  const first = show.report(21);assert.deepEqual(first.completedIds, ['q1']);show.transition('next', 100, noClip);
  show.acknowledge(first);const second = show.report(2);assert(second.sequence > first.sequence);assert.deepEqual(second.completedIds, ['q2']);assert.equal(second.state.position, 2);
});

test('closing credit leaves the next selection open for late queue arrivals', () => {
 const s=snapshot();s.queue=[];s.event.mc_enabled=1;const show=new LocalShow(s,'local');
 const clip=plan=>plan?{id:plan.kind,context:plan.context,text:plan.text,source:'saved'}:null;
 show.transition('next',120,clip);assert.equal(show.snapshot.event.current_track,'a');
 const remote=snapshot();remote.event.mc_enabled=1;remote.event.version=100;show.merge(remote);
 show.transition('finish-announcement',4,clip);assert.equal(show.snapshot.event.current_entry,'q1');assert.equal(show.snapshot.event.current_track,'b');
 show.transition('finish-announcement',4,clip);show.patch({endAfterTrack:true});show.transition('next',120,clip);assert.equal(show.snapshot.event.announcement_kind,'track-end');
 show.snapshot.event.outro_enabled=1;show.transition('finish-announcement',4,clip);assert.equal(show.snapshot.event.announcement_kind,'outro');assert.equal(show.snapshot.event.show_ended,1);
});
test('a restored long-offline show accepts the first fresh queue snapshot immediately', () => {
 const s=snapshot();s.queue=[];const show=new LocalShow(s,'local');for(let i=0;i<60;i++)show.transition('next',120,noClip);
 const restored=LocalShow.restore(show.checkpoint('controller'));assert.equal(restored.remoteVersion,4);
 const remote=snapshot();remote.event.version=5;restored.merge(remote);assert(restored.snapshot.queue.some(q=>q.id==='q1'));
});
