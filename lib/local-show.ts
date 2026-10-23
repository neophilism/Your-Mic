import {nextSelection} from './playback';
import {mcPlan, mcSpecialPlan, type McPlan} from './mc';

export type LocalClip = {id: string; context: string; text: string; source: string};
export type LocalCheckpoint = {session: string; controller: string; snapshot: any; completed: string[]; pending: string[]; sequence: number};
export type LocalReport = {sequence: number; state: any; completedIds: string[]};
const metadata = ['title', 'artist', 'album', 'record_label', 'location', 'mc_enabled', 'intro_enabled', 'intro_text', 'outro_enabled', 'outro_text'];

// In this opt-in mode only the local audio device advances the transport.
// A poll/ack can refresh queue and settings, but never replace its playhead.
export class LocalShow {
  snapshot: any;
  session: string;
  sequence = 0;
  remoteVersion: number;
  completed = new Set<string>();
  private pending = new Set<string>();
  private uuid: () => string;
  private now: () => number;
  constructor(snapshot: any, session: string, uuid = () => crypto.randomUUID(), now = Date.now) {
    this.snapshot = structuredClone(snapshot); this.session = session; this.uuid = uuid; this.now = now;
    this.remoteVersion = snapshot.event.version;
    this.snapshot.speakerHere = true; this.snapshot.speakerOwnedHere = true;
  }
  static restore(saved: LocalCheckpoint) {
    const show = new LocalShow(saved.snapshot, saved.session);
    show.sequence = saved.sequence; show.completed = new Set(saved.completed); show.pending = new Set(saved.pending);
    // Reloads require a tap. Never count time with the tab closed as song progress.
    if (show.snapshot.event.status === 'playing') show.snapshot.event.status = 'paused';
    show.snapshot.event.started_at = null;
    return show;
  }
  checkpoint(controller: string): LocalCheckpoint {
    return {session: this.session, controller, snapshot: structuredClone(this.snapshot), completed: [...this.completed], pending: [...this.pending], sequence: this.sequence};
  }
  setPosition(position: number) {
    if (Number.isFinite(position)) this.snapshot.event.position = Math.max(0, Math.min(7200, position));
    this.snapshot.event.started_at = this.snapshot.event.status === 'playing' ? this.now() : null;
  }
  merge(remote: any) {
    if (remote.event.id !== this.snapshot.event.id || !remote.isOwner || remote.event.version < this.remoteVersion) return this.snapshot;
    this.remoteVersion = remote.event.version;
    for (const key of metadata) this.snapshot.event[key] = remote.event[key];
    this.snapshot.tracks = remote.tracks;
    const current = this.snapshot.event.current_entry;
    const playing = this.snapshot.queue.find((q: any) => q.id === current);
    this.snapshot.queue = remote.queue.filter((q: any) => !this.completed.has(q.id) && q.id !== current).map((q: any) => ({...q, status: 'waiting'}));
    if (current && playing) this.snapshot.queue.unshift({...playing, status: 'playing'});
    Object.assign(this.snapshot, {serverNow: remote.serverNow, speechAvailable: remote.speechAvailable, mcVoice: remote.mcVoice, milesReady: remote.milesReady});
    return this.snapshot;
  }
  patch(data: any) {
    const e = this.snapshot.event;
    if (data.action === 'mode' && ['album', 'auto', 'mic'].includes(data.mode)) {
      if (e.current_track) e.pending_mode = data.mode === e.mode ? null : data.mode;
      else {e.mode = data.mode; e.pending_mode = null;}
    }
    if (data.action === 'schedule') e.mic_after_track = data.trackId || null;
    if (data.queueOpen !== undefined) e.queue_open = data.queueOpen ? 1 : 0;
    if (data.endAfterTrack !== undefined) e.end_after_track = data.endAfterTrack ? 1 : 0;
    this.snapshot.event.version++;
    return this.snapshot;
  }
  transition(action: string, position: number, clipFor: (plan: McPlan | null, pick?: any) => LocalClip | null, extra: any = {}) {
    const s = this.snapshot, e = s.event;
    this.setPosition(position);
    if (action === 'pause') {e.status = 'paused'; e.started_at = null; return s;}
    if (action === 'play' && (e.current_track || e.announcement_id)) {e.status = 'playing'; e.started_at = this.now(); return s;}
    if ((action === 'next' || action === 'finish-announcement') && e.announcement_id) {
      Object.assign(e, {announcement_id: null, announcement_kind: null, position: 0, started_at: e.current_track ? this.now() : null, status: e.current_track ? 'playing' : 'idle', playback_id: this.uuid()});
      s.announcementText = null; e.version++; return s;
    }
    let pick = nextSelection(e, s.tracks, s.queue);
    if (action === 'select') {
      const track = s.tracks.find((t: any) => t.id === extra.trackId);
      if (!track) throw Error('This track is not in the downloaded show.');
      pick = {mode: e.mode === 'auto' ? 'auto' : 'album', entry: null, track, cursor: track.id};
    }
    const ending = action === 'end' || action === 'next' && !!e.end_after_track;
    if (ending) pick = {mode: pick.mode, entry: null, track: null, cursor: e.album_cursor};
    const starting = action === 'play' && !e.current_track && !e.intro_played;
    const plan = ending ? (e.outro_enabled ? mcSpecialPlan(e, 'outro') : null) : starting ? (e.intro_enabled ? mcSpecialPlan(e, 'intro') : null) : action === 'next' ? mcPlan(e, s.tracks, pick) : null;
    const clip = clipFor(plan, pick);
    if (e.current_entry) {this.completed.add(e.current_entry); this.pending.add(e.current_entry);}
    s.queue = s.queue.filter((q: any) => !this.completed.has(q.id)).map((q: any) => ({...q, status: q.id === pick.entry?.id ? 'playing' : 'waiting'}));
    Object.assign(e, {mode: pick.mode, pending_mode: null, mic_after_track: e.mic_after_track === e.current_track ? null : e.mic_after_track,
      current_track: pick.track?.id || null, current_entry: pick.entry?.id || null, album_cursor: pick.cursor,
      status: pick.track || clip ? 'playing' : 'idle', position: 0, started_at: pick.track || clip ? this.now() : null,
      announcement_id: clip?.id || null, announcement_kind: clip ? plan!.kind : null, playback_id: this.uuid(),
      intro_played: ending ? 0 : starting ? 1 : e.intro_played, end_after_track: 0, show_ended: ending ? 1 : 0, queue_open: ending ? 0 : e.queue_open, version: e.version + 1});
    s.announcementText = clip?.text || null;
    return s;
  }
  report(position: number): LocalReport {
    this.setPosition(position);
    return {sequence: ++this.sequence, state: structuredClone(this.snapshot.event), completedIds: [...this.pending].slice(0, 100)};
  }
  acknowledge(report: LocalReport) {for (const id of report.completedIds) this.pending.delete(id);}
}
