# Playback continuity review — October 23, 2026

Production target: GitHub `main`, Cloudflare `your-mic.studiohubs.workers.dev`.
The persistent offline player stays on `development/local-show-audio` and is
not part of this release.

## Removed interruption paths

- Automatic 45-second speaker expiry. It was intended to recover an abandoned
  controller, but background timers and a missed heartbeat could stop a live
  verse. Ownership now lasts until explicit takeover; claim checks are atomic.
  The old `controller_until` column remains for old-client compatibility, but
  the new server and client do not use it to expire control.
- Pausing after a failed Resume acknowledgement. Local user-requested resume
  now continues while acknowledgement retries; stale paused snapshots cannot
  roll it back. A delayed Play request cannot resume a newer track.
- Treating an anonymous snapshot or generic permission error as takeover.
  Sign-in/network problems warn while the buffered file continues. Only a
  confirmed ownership change or the typed `speaker_taken_over` response revokes
  the device. Authentication remains required for server controls.
- Sending server Pause in response to a decoder/download error. This added an
  unrelated transport mutation and another failing request. The player now
  reports the error and offers Resume. An unusable MC clip is skipped.
- Revoking a voice blob still referenced by a playing or paused audio element.
- Enabling the speaker before the initial Play response. That startup race could
  interpret an old idle snapshot as needing Next, skipping the first selection.

## Retained playback mutations

| Trigger | Audio effect | Why it remains |
| --- | --- | --- |
| Artist Pause / Resume | Pause or resume the same decoder | Required artist control; resume does not seek |
| Artist track selection / Next | Replace current audio | Explicit artist instruction; hidden controls lock selection |
| Natural music or MC completion | Advance to the selected next phase | Needed for playlist, credits and queued performers |
| End show, empty mic queue, completed outro | Stop at the intended boundary | Required show behavior; no arbitrary timer |
| Explicit takeover by another artist device | Stop former controller | Prevent simultaneous speaker playback |
| Explicit reconnect / retry after a media failure | Reload once using the captured decoded position | Recover failed or blocked media |
| Initial load or explicit reconnect position | Set position once after metadata | Resume where the decoder actually stopped |
| Event switch or component unmount | Stop and release the previous event | Avoid audio leaking between sessions; switching while playing is blocked |
| Download cleanup | Cancel/release unused files | Limit phone memory; the active player source is retained |

Only audience Listen along and the audience preview seek bar use approximate
server-clock synchronization. They cannot operate the artist speaker element.
Polling never seeks the already loaded artist decoder. Generation/attempt IDs
ignore stale downloads and outgoing browser errors. Play statistics run in a
separate best-effort queue and cannot pause, seek, advance or reload audio.

Download timeouts apply only to files being fetched, not the buffered song
already playing. MC generation/validation timeouts skip unavailable speech;
they do not wait at the music boundary. Heartbeat and control request timeouts
report connectivity problems and do not impose an audio expiry.

## Verification

- All 25 original WAV files from production event
  `2419c7ab-6369-4ebb-a316-304dfaa61766` fetched completely and fully decoded
  with ffmpeg: 1,120,873,388 bytes; no decode errors.
- The first two original files played fully in the actual artist React UI with
  native browser audio (242.886 and 252.8 seconds). A simulated 110-second API
  outage caused eight failed heartbeats. Both tracks ended naturally, with
  zero unexpected pauses, seeks or media errors.
- All 25 original files also started in the native browser player, with one
  short MP3 before and after each (75 phases): zero seeks or errors. This
  sampled the first three seconds of each song; only the two above played fully.
- A separate native browser test completed 200 consecutive MP3 clips with
  zero seeks or media errors.
- Actual artist UI fault rehearsal with two 35-second song excerpts:
  one intentional Pause, a rejected Resume request, anonymous snapshots and
  a 401 heartbeat, followed by recovery. Both tracks ended naturally with
  zero additional pauses, zero seeks and zero media errors.
- Unit/API/auth/MC regression suite: 46 unit tests plus complete integration
  suites; independent statistics-store failure leaves transport functional.
- Simulated transport stress: 400 music plays plus 800 MC clips,
  120,000 snapshot updates and 6,000 failed heartbeats; zero unexpected
  pauses, seeks or playback errors.
- Controller API stress: 120 reconnections and 80 concurrent unforced claims;
  current ownership retained until explicit takeover.
- Isolated local 300-client load test: 3,346 requests; 300 distinct queue
  entries and exactly one winner among 20 simultaneous advance requests.
  This is application/load evidence, not a production capacity certification.

## Device rehearsal and remaining limits

This release fully downloads the current song before playing it and warms the
next selection. A connection loss cannot interrupt that already buffered file;
server-mediated transitions and new queue choices still require connectivity.
The persistent offline branch is intentionally not promoted.

The artist phone must keep the tab open and the screen awake. The app requests
a screen wake lock where available, but an OS lock, browser termination,
phone call, output-route change, disconnected speaker or exhausted battery
can interrupt audio. A website cannot guarantee those away. Rehearse on the
actual phone/browser/speaker, including an MC boundary and a queued performer,
using the deployed release before leaving. Avoid deployments during the show.

## Follow-up: introduction-to-music gap

The old opening-to-music path waited for a finish-announcement response after
the voice ended. The follow-up downloads music before its opening and confirms
the selected music during speech. Early server snapshots cannot cut speech
short; native completion releases the buffered song at position zero. A fast
server path avoids unnecessary catalog and queue reads for that fixed handoff.
Heartbeat/pause positions remain zero for music that has not started, and a
pending Resume acknowledgement survives the change of playback ID.

A native browser rehearsal through the actual artist UI used a real cached
Miles clip from the production event, an injected three-second server response
and three-second song-download delay. The measured end-of-clip to music gap
was 201 ms, with no seeks, unexpected pauses or media errors. This measures
software handoff, not physical speaker latency or sample-accurate gaplessness.
A second artist UI run paused and resumed during the already confirmed opening:
112 ms handoff, one intended pause, zero seeks/errors, one finish request.
