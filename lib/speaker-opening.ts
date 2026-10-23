import type {SpeakerTarget} from './speaker-audio';
type OpeningEvent = {playback_id: string; announcement_id: string | null; announcement_kind: string | null; current_track: string | null; current_entry: string | null; status: string};
// Confirm the already selected music while its opening is audible. Keep the
// opening decoder until its natural end, then use the downloaded song at zero.
// This never predicts a queue selection or changes the server's chosen track.
export class SpeakerOpening {
  private opening: {event: OpeningEvent; target: SpeakerTarget; ended: boolean} | null = null;
  begin(event: OpeningEvent, target: SpeakerTarget) {
    if (this.opening?.event.playback_id === event.playback_id || event.announcement_kind !== 'track-start' || !event.announcement_id || !event.current_track) return false;
    this.opening = {event: {...event}, target: {...target}, ended: false};return true;
  }
  holdingMusic(event: OpeningEvent, playerKey: string) {
    const old = this.opening;
    return !!old && playerKey === old.event.playback_id && !event.announcement_id && event.current_track === old.event.current_track && event.current_entry === old.event.current_entry;
  }
  target(event: OpeningEvent, playerKey: string, playerEnded: boolean): SpeakerTarget | null {
    const old = this.opening;if (!old) return null;
    if (event.playback_id === old.event.playback_id && playerKey === old.event.playback_id) return null;
    if (!this.holdingMusic(event, playerKey) || old.ended || playerEnded) {this.clear();return null;}
    return {...old.target, status: event.status};
  }
  finish(key: string) {if (!this.opening || this.opening.event.playback_id !== key) return false;this.opening.ended = true;return true;}
  clear() {this.opening = null;}
}
