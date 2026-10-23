export type SavedClip = {id: string; context: string; text: string; source: string};
export type AudioSpec = {source: string; label: string};
export type SavedShow = {key: string; owner: string; eventId: string; fingerprint: string; sources: AudioSpec[]; clips: SavedClip[]; voiceKey?: string; bytes: number; savedAt: number};
export interface LocalStore {
  get<T>(store: 'audio' | 'shows' | 'checkpoints', key: string): Promise<T | undefined>;
  put(store: 'audio' | 'shows' | 'checkpoints', key: string, value: any): Promise<void>;
  remove(store: 'audio' | 'shows' | 'checkpoints', key: string): Promise<void>;
}
export const showKey = (owner: string, eventId: string) => `${owner}:${eventId}`;
export const audioKey = (show: string, source: string) => `${show}:${source}`;
export const musicSource = (track: any, beat = false) => `/api/audio/${track.id}?${beat ? 'beat=1&' : ''}v=${encodeURIComponent((beat && track.hasBeat ? track.beatRevision : track.audioRevision) || '')}`;
export function showSources(tracks: any[]): AudioSpec[] {
  return tracks.flatMap(t => [{source: musicSource(t), label: t.title}, ...(t.hasBeat ? [{source: musicSource(t, true), label: `${t.title} (freestyle beat)`}] : [])]);
}
export const showFingerprint = (tracks: any[]) => JSON.stringify(showSources(tracks).map(x => x.source));

// Blobs live in IndexedDB, not localStorage or the HTTP cache. Transactions
// resolve only on commit, so a quota failure cannot mark a partial file ready.
export class BrowserLocalStore implements LocalStore {
  private connection: Promise<IDBDatabase> | null = null;
  private open() {
    if (!this.connection) this.connection = new Promise<IDBDatabase>((resolve, reject) => {
      if (!globalThis.indexedDB) {reject(Error('This browser cannot save a show. Use a regular browser window.')); return;}
      const request = indexedDB.open('your-mic-artist-audio-v1', 1);
      request.onupgradeneeded = () => {for (const name of ['audio', 'shows', 'checkpoints']) request.result.createObjectStore(name);};
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('Close other Your Mic artist tabs and try again.'));
    });
    return this.connection;
  }
  private async operation<T>(store: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest) {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(store, mode), request = action(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request.result as T);
      transaction.onerror = () => reject(transaction.error || request.error);
      transaction.onabort = () => reject(transaction.error || Error('Saving the show was interrupted.'));
    });
  }
  get<T>(store: 'audio' | 'shows' | 'checkpoints', key: string) {return this.operation<T | undefined>(store, 'readonly', s => s.get(key));}
  async put(store: 'audio' | 'shows' | 'checkpoints', key: string, value: any) {await this.operation(store, 'readwrite', s => s.put(value, key));}
  async remove(store: 'audio' | 'shows' | 'checkpoints', key: string) {await this.operation(store, 'readwrite', s => s.delete(key));}
}
export async function completeAudio(response: Response) {
  if (!response.ok || response.status === 206 || !(response.headers.get('content-type') || '').startsWith('audio/')) throw Error('The server did not return a complete audio file.');
  const blob = await response.blob(), expected = Number(response.headers.get('content-length'));
  if (!blob.size || expected > 0 && blob.size !== expected) throw Error('An audio download was incomplete. Retry the download.');
  return blob;
}
export async function verifySavedShow(store: LocalStore, saved: SavedShow, fingerprint: string) {
  if (saved.fingerprint !== fingerprint) return false;
  for (const spec of saved.sources) {const blob = await store.get<Blob>('audio', audioKey(saved.key, spec.source)); if (!blob?.size || !blob.type.startsWith('audio/')) return false;}
  return saved.sources.length > 0;
}
export async function downloadShow(options: {store: LocalStore; owner: string; eventId: string; tracks: any[]; fetcher?: typeof fetch; signal?: AbortSignal; progress?: (done: number, total: number, label: string) => void; validate?: (blob: Blob) => Promise<void>}) {
  const {store, owner, eventId, tracks, signal, progress, validate} = options, fetcher = options.fetcher || fetch;
  const key = showKey(owner, eventId), sources = showSources(tracks);
  if (!sources.length) throw Error('Upload the set before downloading it.');
  const previous = await store.get<SavedShow>('shows', key);
  const draft: SavedShow = {key, owner, eventId, fingerprint: showFingerprint(tracks), sources, clips: previous?.clips || [], voiceKey: previous?.voiceKey, bytes: 0, savedAt: Date.now()};
  await store.put('shows', key, draft);
  let bytes = 0;
  for (let index = 0; index < sources.length; index++) {
    signal?.throwIfAborted();
    const spec = sources[index], storageKey = audioKey(key, spec.source);
    progress?.(index, sources.length, spec.label);
    let blob = await store.get<Blob>('audio', storageKey);
    if (!blob?.size || !blob.type.startsWith('audio/')) {
      blob = await completeAudio(await fetcher(spec.source, {cache: 'reload', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000)}));
      signal?.throwIfAborted(); await validate?.(blob); signal?.throwIfAborted();
      await store.put('audio', storageKey, blob);
    } else await validate?.(blob);
    bytes += blob.size;
  }
  signal?.throwIfAborted();
  const saved: SavedShow = {key, owner, eventId, fingerprint: showFingerprint(tracks), sources, clips: previous?.clips || [], voiceKey: previous?.voiceKey, bytes, savedAt: Date.now()};
  await store.put('shows', key, saved);
  // Replacements cannot reuse old revisions. Clean up only after the complete
  // new manifest committed, leaving retriable downloads safe on cancellation.
  for (const spec of previous?.sources || []) if (!sources.some(s => s.source === spec.source)) await store.remove('audio', audioKey(key, spec.source));
  progress?.(sources.length, sources.length, 'Audio downloaded');
  return saved;
}
export async function readLocalAudio(store: LocalStore, manifest: SavedShow | null, source: string) {
  const blob = manifest && await store.get<Blob>('audio', audioKey(manifest.key, source));
  if (!blob?.size || !blob.type.startsWith('audio/')) throw Error('This audio is missing from the saved show. Pause and download the show again.');
  return new Response(blob, {headers: {'Content-Type': blob.type, 'Content-Length': String(blob.size)}});
}
export async function removeSavedShow(store: LocalStore, saved: SavedShow) {
  await store.remove('shows', saved.key);
  for (const source of [...saved.sources.map(s => s.source), ...saved.clips.map(c => c.source)]) await store.remove('audio', audioKey(saved.key, source));
  await store.remove('checkpoints', saved.key);
}
export async function validateDeviceAudio(blob: Blob) {
  await new Promise<void>((resolve, reject) => {
    const audio = new Audio(), url = URL.createObjectURL(blob);
    const finish = (ok: boolean) => {clearTimeout(timer); audio.onloadedmetadata = null; audio.onerror = null; audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); ok ? resolve() : reject(Error('This device cannot decode one of the audio files. Replace it with MP3 or M4A.'));};
    const timer = setTimeout(() => finish(false), 15000);
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration > 0);
    audio.onerror = () => finish(false); audio.preload = 'metadata'; audio.src = url;
  });
}

// A permanent server reservation protects against other devices; Web Locks
// also prevents two tabs on this device from running that reserved show.
export function lockLocalShow(eventId: string): Promise<() => void> {
  if (!navigator.locks) return Promise.reject(Error('Local playback needs a browser with device locks. Update your browser or use normal playback.'));
  return new Promise((resolve, reject) => {
    navigator.locks.request(`your-mic-local-${eventId}`, {ifAvailable: true}, async lock => {
      if (!lock) {reject(Error('This show is already open for local playback in another tab.')); return;}
      await new Promise<void>(release => resolve(release));
    }).catch(reject);
  });
}
