# Your Mic

A live album release playlist and first-come freestyle queue. Audience members need no account. Three modes: **Playlist**, **Your Mic**, and **Automatic**.

The existing Sites deployment uses ChatGPT artist sign-in. Independent Cloudflare hosting has its own password-protected artist studio, signed secure sessions, D1 database and R2 audio storage. See [deployment instructions, hosting costs and capacity assumptions](DEPLOYMENT.md). The recommended starting plan is Cloudflare Workers Paid at $5/month plus any metered overages. The app is prepared for a 300-person audience and accepts up to 500 queued performers; hosted capacity still needs a rehearsal.

## Run an event

1. Open `/admin`, sign in, and create an event.
2. Upload the album tracks. MP3 or M4A is recommended; each upload can be up to 75 MB. Reorder tracks using the arrows.
3. Optionally attach a freestyle instrumental to each album track with **Add freestyle beat**. Without one, the uploaded album audio is used for performances.
4. Connect this device to the physical speaker. Press play in **Speaker control** and keep the tab open, online, and awake.
5. Select **Playlist**, **Your Mic**, or **Automatic**. A change during a song applies at the next song boundary. You can also schedule Your Mic after a selected album track.
6. Use **Share event & QR** to download a QR code or copy the public event link.
7. Export the release email list from the artist studio. Email delivery is not connected; send the streaming announcement through your email service.

### Modes

- **Playlist** repeats the artist’s set in order. Audience members can still reserve a place in the queue for later.
- **Your Mic** runs waiting performers in arrival order and waits when the queue is empty.
- **Automatic** repeats the album, but at each song boundary waiting performers get priority. When the queue clears, the next unplayed album track resumes. Freestyle selections do not advance the album cursor.

The audience can privately preview any track and, if supplied, its instrumental. **Listen along** starts the currently playing track at approximately the speaker’s position; it is not sample-accurate synchronized streaming. Vocals are performed into the physical mic; the web app does not record or transmit microphone audio.

## Behavior

- Three-second foreground queue refresh, plus immediate refresh when the page returns to the foreground. A phone screen must remain open to show the turn alert; no background push notification permission is requested.
- One active queue place per browser queue pass, with up to 500 active entries per event. A stage name is sufficient. A participant may leave their own waiting place; the artist can remove waiting entries and skip the active performer.
- At the end of a performance, the participant sees **You made it yours.** and another streaming-release signup invitation.
- Speaker control uses a per-tab token and renewable lease to prevent multiple artist devices from controlling playback simultaneously. An explicit takeover transfers control.
- Playback advances use a version check so duplicate or stale next-track requests cannot skip multiple performers.
- Queue places remain on the server when someone browses another website, closes the page or locks their phone. A per-event anonymous pass is saved in local storage with a cookie fallback. Returning to the same event restores the place; a private return link can restore it in another browser/device. If storage is blocked, the app asks the person to save that link. The queue continues to advance while they are away.
- Release signup records and event state are durable in D1; uploaded audio is in R2. Email and social sign-in are not required to queue or restore a pass. Background push alerts are not enabled yet.
- Emails and browser queue secrets are not included in public event snapshots. All artist operations and subscriber exports check event ownership on the server.

## Local development and verification

Follow the Sites project helpers for dependency installation, builds, migrations, preview and publishing. Hosting bindings are `DB` and `BUCKET` in `.openai/hosting.json`. Never commit local state, access credentials, or preview seed data.

```sh
node node_modules/typescript/bin/tsc --noEmit
node --experimental-strip-types --test tests/playback.mjs
node --experimental-strip-types tests/integration.mjs
node --experimental-strip-types tests/standalone.mjs
node --experimental-strip-types --test tests/queue-pass.mjs tests/cloudflare-resources.mjs
node --experimental-strip-types tests/load.mjs
```

The integration suite runs the real API in an isolated Miniflare Worker with temporary D1 and R2. It covers event ownership, audio and beat uploads, seeking, QR generation, consent and subscriber export access, anonymous FIFO queueing, duplicate protection, all modes, mode boundaries, playlist resumption/repeat, completed turns, controller leases, stale advances and track ordering. Test data is never deployed.

## AI MC

The artist studio includes cached spoken interstitials, per-song custom text with automatic rapper callouts, optional opening/closing scripts, and an early-end control. See [deployment and show operation](DEPLOYMENT.md#ai-mc-announcements) for Cloudflare Workers AI setup and readiness/failure behavior.
