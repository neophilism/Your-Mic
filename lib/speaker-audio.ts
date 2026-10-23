// The speaker's decoded audio clock is authoritative during a performance.
// Server polling may change the transport or source, but must never seek an
// already-loaded song to catch up with a wall clock after buffering or latency.
export type SpeakerTarget = {key: string; source: string; status: string; position: number};
type SpeakerMedia = Pick<HTMLAudioElement, 'src' | 'paused' | 'ended' | 'readyState' | 'duration' | 'currentTime' | 'pause' | 'play' | 'load' | 'addEventListener' | 'removeEventListener'>;

export class SpeakerPlayback {
  private target: SpeakerTarget | null = null;
  private generation = 0;
  private loaded = false;
  private playRequest = 0;
  private metadata: (() => void) | null = null;
  private startPosition = 0;
  private stoppedPosition: {key: string; position: number} | null = null;
  private audio: SpeakerMedia;
  private resolveSource: (source: string) => Promise<string>;
  private loading: (value: boolean) => void;
  private failed: (error: unknown) => void;
  constructor(audio: SpeakerMedia, resolveSource: (source: string) => Promise<string>, loading: (value: boolean) => void, failed: (error: unknown) => void) {
    this.audio = audio;this.resolveSource = resolveSource;this.loading = loading;this.failed = failed;
  }

  get key() {return this.target?.key || '';}
  get source() {return this.target?.source || '';}
  get ready() {return this.loaded && this.audio.readyState >= 1;}
  get position() {return this.ready ? this.audio.currentTime : this.startPosition;}
  get resumePoint() {return this.target ? {key: this.target.key, position: this.position} : this.stoppedPosition;}
  get ended() {return this.ready && this.audio.ended && Number.isFinite(this.audio.duration) && this.audio.currentTime >= this.audio.duration - 0.25;}

  sync(target: SpeakerTarget) {
    if (this.target?.key === target.key) {
      if (this.loaded || this.target.source === target.source) {
        // Retain the source that backs the active decoder, even if the same MC
        // clip becomes available through a different cached URL later.
        this.target = {...target, source: this.target.source};
        if (this.loaded) this.applyStatus();
        return;
      }
      target = {...target, position: this.startPosition};
    }
    this.clearMetadata();
    this.target = target;
    this.loaded = false;
    const generation = ++this.generation;
    this.audio.pause();
    this.loading(true);
    // Capture the explicit initial/resume position once. Download time and
    // later snapshots cannot consume the opening bars or move the playhead.
    const position = Math.max(0, target.position || 0);
    this.startPosition = position;
    void this.resolveSource(target.source).then(source => {
      if (generation !== this.generation) return;
      this.metadata = () => {
        if (generation !== this.generation) return;
        this.clearMetadata();
        if (position > 0) this.audio.currentTime = Number.isFinite(this.audio.duration) ? Math.min(position, Math.max(0, this.audio.duration - 0.05)) : position;
        this.loading(false);
      };
      this.audio.addEventListener('loadedmetadata', this.metadata);
      this.audio.src = source;
      this.audio.load();
      this.loaded = true;
      this.applyStatus();
    }).catch(error => {
      if (generation !== this.generation) return;
      this.loading(false);
      this.failed(error);
    });
  }

  private applyStatus() {
    if (!this.target || this.target.status !== 'playing') {this.audio.pause(); return;}
    if (this.audio.ended || !this.audio.paused || this.playRequest === this.generation) return;
    const generation = this.generation;
    this.playRequest = generation;
    void Promise.resolve(this.audio.play()).catch(error => {
      if (generation === this.generation && this.target?.status === 'playing') this.failed(error);
    }).finally(() => {if (this.playRequest === generation) this.playRequest = 0;});
  }

  private clearMetadata() {
    if (this.metadata) this.audio.removeEventListener('loadedmetadata', this.metadata);
    this.metadata = null;
  }
  stop() {
    if (this.target) this.stoppedPosition = {key: this.target.key, position: this.position};
    this.generation++;
    this.target = null;
    this.loaded = false;
    this.clearMetadata();
    this.audio.pause();
    this.loading(false);
  }
}

// Keep only current/next encoded files. A blob URL is published only once the
// complete response is received, so R2/network stalls cannot interrupt a verse.
export class SpeakerAudioCache {
  private files = new Map<string, string>();
  private pending = new Map<string, {promise: Promise<string>; controller: AbortController}>();
  private disposed = false;
  private fetcher: typeof fetch;
  private createURL: (blob: Blob) => string;
  private revokeURL: (url: string) => void;
  constructor(fetcher: typeof fetch = fetch, createURL = (blob: Blob) => URL.createObjectURL(blob), revokeURL = (url: string) => URL.revokeObjectURL(url)) {
    this.fetcher = fetcher;this.createURL = createURL;this.revokeURL = revokeURL;
  }

  get(source: string): Promise<string> {
    if (this.disposed) return Promise.reject(Error('Audio cache closed.'));
    if (source.startsWith('blob:') || source.startsWith('data:')) return Promise.resolve(source);
    const ready = this.files.get(source);
    if (ready) return Promise.resolve(ready);
    const pending = this.pending.get(source);
    if (pending) return pending.promise;
    const controller = new AbortController();
    const promise = (async () => {
      const response = await this.fetcher(source, {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)])});
      if (!response.ok || !(response.headers.get('content-type') || '').startsWith('audio/')) throw Error('The complete song could not be loaded. Check the connection and press Resume speaker.');
      const blob = await response.blob();
      const expected = Number(response.headers.get('content-length'));
      if (!blob.size || (expected > 0 && blob.size !== expected)) throw Error('The song download was incomplete. Press Resume speaker to retry.');
      if (controller.signal.aborted || this.disposed) throw Error('Audio download cancelled.');
      const url = this.createURL(blob);
      this.files.set(source, url);
      return url;
    })().finally(() => {if (this.pending.get(source)?.controller === controller) this.pending.delete(source);});
    this.pending.set(source, {promise, controller});
    return promise;
  }

  keep(sources: string[]) {
    const keep = new Set(sources);
    for (const [source, url] of this.files) if (!keep.has(source)) {this.revokeURL(url);this.files.delete(source);}
    for (const [source, job] of this.pending) if (!keep.has(source)) {job.controller.abort();this.pending.delete(source);}
  }
  dispose() {this.disposed = true;this.keep([]);}
}
