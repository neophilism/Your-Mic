export type PlayReport = {playbackId: string; trackId: string; kind: 'live' | 'rap' | 'preview'};
type Outbox = {read: () => string | null; write: (value: string) => void};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function speakerPlayReport(snapshot: any, player: {key: string; ready: boolean} | null, enabled: boolean): PlayReport | null {
  const e = snapshot?.event;
  if (!enabled || !snapshot?.isOwner || !player?.ready || !e?.current_track || e.announcement_id || player.key !== e.playback_id) return null;
  return {playbackId: e.playback_id, trackId: e.current_track, kind: e.current_entry ? 'rap' : 'live'};
}

// Separate from transport: reporting never waits on or changes the audio player.
// The server deduplicates playback IDs, including retries after a lost response.
export class PlayCounter {
  private pending = new Map<string, PlayReport>();
  private delivered = new Set<string>();
  private flushing = false;
  private stopped = false;
  private send: (report: PlayReport) => Promise<unknown>;
  private outbox?: Outbox;
  constructor(send: (report: PlayReport) => Promise<unknown>, outbox?: Outbox) {
    this.send = send;this.outbox = outbox;
    try {
      const saved = JSON.parse(outbox?.read() || '[]');
      if (Array.isArray(saved)) for (const report of saved.slice(0, 500)) if (uuid.test(report?.playbackId) && uuid.test(report?.trackId) && ['live','rap','preview'].includes(report?.kind)) this.pending.set(report.playbackId, report);
    } catch {} // Denied browser storage cannot affect sound.
  }
  record(report: PlayReport) {
    if (this.stopped || this.delivered.has(report.playbackId) || this.pending.has(report.playbackId)) return;
    this.pending.set(report.playbackId, report);this.save();void this.flush();
  }
  private save() {try {this.outbox?.write(JSON.stringify([...this.pending.values()]));} catch {}}
  async flush() {
    if (this.flushing || this.stopped) return;
    this.flushing = true;
    try {
      for (const [id, report] of this.pending) {
        if (this.stopped) break;
        try {await this.send(report);} catch (error: any) {
          if (error?.status !== 400 && error?.status !== 404) break;
          // A deleted track or invalid saved report cannot block later counts.
        }
        this.pending.delete(id);this.delivered.add(id);this.save();
      }
    } finally {this.flushing = false;}
  }
  stop() {this.stopped = true;}
}
