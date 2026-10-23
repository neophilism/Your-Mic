// The speaker's decoded audio clock is authoritative during a performance.
// Server polling may change the transport or source, but must never seek an
// already-loaded song to catch up with a wall clock after buffering or latency.
export type SpeakerTarget = {key: string; source: string; status: string; position: number; before?: string};
export function speakerFailureMessage(error: unknown) {
  const e = error as {name?: string; message?: string; mediaCode?: number};
  if (e?.name === 'NotAllowedError') return 'The browser blocked automatic audio. Click Resume speaker to allow playback.';
  if (e?.name === 'NotSupportedError' || e?.mediaCode === 3 || e?.mediaCode === 4) return 'The browser could not decode this audio. Resume speaker will reload it. If this repeats on the same song, its audio file needs checking.';
  if (e?.name === 'AudioDownloadError') return e.message || 'The complete audio could not download. Press Resume speaker to retry.';
  return `Audio could not start${e?.name ? ` (${e.name})` : ''}. Press Resume speaker to retry.`;
}
export function currentSpeakerFailure(playerKey: string | undefined, event: {playback_id?: string} | undefined) {return !!playerKey && !!event?.playback_id && playerKey === event.playback_id;}
type SpeakerMedia = Pick<HTMLAudioElement, 'src' | 'paused' | 'ended' | 'readyState' | 'duration' | 'currentTime' | 'pause' | 'play' | 'load' | 'addEventListener' | 'removeEventListener'> & {readonly currentSrc?: string; readonly error?: {code: number; message?: string} | null};

export class SpeakerPlayback {
  private target: SpeakerTarget | null = null;
  private generation = 0;
  private loaded = false;
  private playRequest = 0;
  private playAttempt = 0;
  private failedGeneration = -1;
  private resolvedSource = '';
  private abortRetries = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
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
    this.clearRetry();
    this.target = target;
    this.loaded = false;
    this.resolvedSource = '';
    this.abortRetries = 0;
    this.playRequest = 0;this.playAttempt++;
    const generation = ++this.generation;
    this.audio.pause();
    this.loading(true);
    // Capture the explicit initial/resume position once. Download time and
    // later snapshots cannot consume the opening bars or move the playhead.
    const position = Math.max(0, target.position || 0);
    this.startPosition = position;
    const sourceReady = target.before ? this.resolveSource(target.before).then(() => this.resolveSource(target.source)) : this.resolveSource(target.source);
    void sourceReady.then(source => {
      if (generation !== this.generation) return;
      this.metadata = () => {
        if (generation !== this.generation || this.failedGeneration === generation) return;
        this.clearMetadata();
        this.loaded = true;
        if (position > 0) this.audio.currentTime = Number.isFinite(this.audio.duration) ? Math.min(position, Math.max(0, this.audio.duration - 0.05)) : position;
        this.loading(false);
        this.applyStatus();
      };
      this.audio.addEventListener('loadedmetadata', this.metadata);
      this.resolvedSource = source;
      this.audio.src = source;
      this.audio.load();
    }).catch(error => {
      if (generation !== this.generation) return;
      this.loading(false);
      this.reportFailure(error);
    });
  }

  private applyStatus() {
    if (!this.target || this.target.status !== 'playing') {this.playAttempt++;this.playRequest = 0;this.clearRetry();this.audio.pause();return;}
    if (!this.loaded || this.failedGeneration === this.generation || this.audio.ended || !this.audio.paused || this.playRequest) return;
    const generation = this.generation;
    const attempt = ++this.playAttempt;
    this.playRequest = attempt;
    // A pause/load can abort a pending browser play promise. Each attempt has
    // its own identity: a late rejection must not pause a newer successful play.
    void Promise.resolve().then(() => {
      if (generation !== this.generation || attempt !== this.playAttempt) return;
      return this.audio.play();
    }).catch(error => {
      if (generation !== this.generation || attempt !== this.playAttempt || this.target?.status !== 'playing') return;
      if (error?.name === 'AbortError' && !this.audio.error && this.abortRetries++ < 2) {
        this.retry = setTimeout(() => {this.retry = null;if (generation === this.generation) this.applyStatus();}, 50);
      } else this.reportFailure(error);
    }).finally(() => {if (this.playRequest === attempt) this.playRequest = 0;});
  }

  // Called synchronously in a real button handler to satisfy browser autoplay
  // policy. It resumes this decoder; it never resets or seeks the song.
  resumeFromGesture() {
    if (!this.target || !this.ready || this.audio.error || this.audio.ended) return false;
    this.target = {...this.target, status: 'playing'};
    this.failedGeneration = -1;this.abortRetries = 0;this.playRequest = 0;this.playAttempt++;
    this.clearRetry();
    const generation = this.generation, attempt = ++this.playAttempt;
    this.playRequest = attempt;
    try {
      void Promise.resolve(this.audio.play()).catch(error => {
        if (generation === this.generation && attempt === this.playAttempt) this.reportFailure(error);
      }).finally(() => {if (this.playRequest === attempt) this.playRequest = 0;});
    } catch (error) {this.playRequest = 0;this.reportFailure(error);}
    return true;
  }
  handleMediaError() {
    // Old-source events can arrive after a new target was selected. The media
    // element clears error on load; a bare/stale error event is not a failure.
    const error = this.audio.error;
    if (!this.target || !this.resolvedSource || !error || (this.audio.currentSrc || this.audio.src) !== this.resolvedSource) return;
    this.reportFailure(Object.assign(Error('The browser could not decode this audio.'), {name: 'MediaPlaybackError', mediaCode: error.code}));
  }
  private reportFailure(error: unknown) {
    if (this.failedGeneration === this.generation) return;
    this.failedGeneration = this.generation;this.loading(false);this.failed(error);
  }
  private clearRetry() {if (this.retry) clearTimeout(this.retry);this.retry = null;}

  private clearMetadata() {
    if (this.metadata) this.audio.removeEventListener('loadedmetadata', this.metadata);
    this.metadata = null;
  }
  stop() {
    if (this.target) this.stoppedPosition = {key: this.target.key, position: this.position};
    this.generation++;
    this.playAttempt++;this.playRequest = 0;this.clearRetry();this.resolvedSource = '';
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
    // Native browser fetch requires the Window/global receiver. Calling an
    // unbound reference as this.fetcher throws TypeError: Illegal invocation.
    this.fetcher = fetcher.bind(globalThis);this.createURL = createURL;this.revokeURL = revokeURL;
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
      for (let attempt = 0; ; attempt++) {
        try {
          // A preview may have populated the browser's byte-range HTTP cache.
          // Fetch the full file independently; 206 is never a complete song.
          const response = await this.fetcher(source, {cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)])});
          if (!response.ok || response.status === 206 || response.headers.has('content-range') || !(response.headers.get('content-type') || '').startsWith('audio/')) {
            void response.body?.cancel().catch(() => {});
            throw Object.assign(Error(`The complete audio download failed (HTTP ${response.status}). Resume speaker will retry.`), {name: 'AudioDownloadError'});
          }
          const blob = await response.blob();
          const expected = Number(response.headers.get('content-length'));
          if (!blob.size || (expected > 0 && blob.size !== expected)) throw Object.assign(Error('The audio download was incomplete. Resume speaker will retry.'), {name: 'AudioDownloadError'});
          if (controller.signal.aborted || this.disposed) throw Error('Audio download cancelled.');
          const url = this.createURL(blob);
          this.files.set(source, url);
          return url;
        } catch (error) {
          if (controller.signal.aborted || this.disposed || attempt >= 1) throw error;
        }
      }
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
