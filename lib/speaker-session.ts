type Ownership = {speakerOwnedHere?: boolean; speakerHere?: boolean};
export const hasSpeakerControl = (snapshot: Ownership) => snapshot.speakerOwnedHere === true || snapshot.speakerHere === true;

// A missed heartbeat is a connectivity warning, never a command to stop a verse.
// Only an explicit server ownership rejection revokes this speaker device.
export class SpeakerHeartbeat {
  private active = true;
  private pending = false;
  private send: () => Promise<unknown>;
  private status: (connected: boolean, message: string) => void;
  private revoked: () => void;
  constructor(send: () => Promise<unknown>, status: (connected: boolean, message: string) => void, revoked: () => void) {
    this.send = send;this.status = status;this.revoked = revoked;
  }
  async tick() {
    if (!this.active || this.pending) return;
    this.pending = true;
    try {
      await this.send();if (this.active) this.status(true, '');
    } catch (error: any) {
      if (!this.active) return;
      if (error?.status === 409 && error?.code === 'speaker_taken_over') {this.active = false;this.revoked();}
      else this.status(false, error?.status === 401
        ? 'Artist sign-in expired. The buffered song continues; sign in again before the next track.'
        : 'Connection interrupted. The buffered song continues while speaker control reconnects.');
    } finally {this.pending = false;}
  }
  stop() {this.active = false;}
}

// Keep a user-requested native resume playing while its server acknowledgement
// is delayed or lost. Old paused snapshots cannot roll it back mid-verse.
export class SpeakerResume {
  private wanted = '';
  private confirming = false;
  private send: (key: string) => Promise<unknown>;
  private failed: (error: unknown) => void;
  constructor(send: (key: string) => Promise<unknown>, failed: (error: unknown) => void) {this.send = send;this.failed = failed;}
  begin(key: string) {this.wanted = key;}
  clear() {this.wanted = '';}
  transfer(from: string, to: string) {if (this.wanted === from) this.wanted = to;}
  status(key: string, status: string) {
    if (this.wanted && this.wanted !== key) this.clear();
    return this.wanted && this.wanted === key ? 'playing' : status;
  }
  async confirm() {
    if (!this.wanted || this.confirming) return;
    const key = this.wanted;this.confirming = true;
    try {await this.send(key);if (this.wanted === key) this.clear();}
    catch (error) {if (this.wanted === key) this.failed(error);}
    finally {this.confirming = false;}
  }
}
