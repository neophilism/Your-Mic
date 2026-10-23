# Your Mic deployment

Recommended starting point: **Cloudflare Workers Paid + D1 + R2 Standard**, directly in your own Cloudflare account. The source already uses these runtimes and storage APIs. No Render service, separate Postgres server, Redis, music-generation API, or paid email service is needed for the live queue and playback. The AI MC uses Cloudflare Workers AI and caches generated speech in R2.

## Budget and audience

Prices checked against provider documentation on October 23, 2026. Prices exclude tax, domain registration, other apps sharing the account, and usage over the included allowances.

| Resource | Starting cost / included use | Your Mic purpose |
| --- | --- | --- |
| Workers Paid | $5/month minimum; 10 million dynamic requests and 30 million CPU milliseconds/month included | Pages, anonymous queue, artist controls, audio responses |
| D1 on Workers Paid | 5 GB storage, 25 billion rows read and 50 million rows written/month included | Events, queue, subscribers, artist login attempt counter |
| R2 Standard | 10 GB-month storage, 1 million Class A and 10 million Class B operations/month free; no internet egress charge | Audio files, streamed with byte-range seeking |

A few dozen people is a small workload. Plan for **300 simultaneously open event pages**, with one artist/speaker device. The current three-second foreground refresh means about **100 snapshot requests/second** at that audience size. A four-hour show produces about **1.44 million** snapshot requests, plus page loads, controls, audio and signups. The queue accepts up to 500 active performers; this is separate from the number of people browsing or listening.

For eight four-hour shows per month at 300 continuously open pages, snapshot traffic alone is about 11.52 million requests. Assuming 10 ms CPU per snapshot, the published Workers rates imply about **$7.16/month** for those requests and CPU including the $5 subscription, before other traffic/storage/operations. This is a planning estimate, not a measured production CPU figure or a spending cap. A **$5–10/month initial budget** is reasonable under these assumptions. Review real CPU and request metrics after the first show.

Audio bandwidth is the main reason to prefer R2. If 300 people all listen continuously at 192 kbps for four hours, audio alone is approximately **104 GB** of transfer. R2 does not bill internet egress; storage and operations still apply. Most people merely viewing the queue use much less bandwidth.

The free Workers tier's 100,000 dynamic requests/day would be consumed in about **17 minutes** by 300 continuously polling pages, before other requests. Use the paid plan for the event.

## Verified locally

- TypeScript check, eight playback/range unit tests, API integration suite, and standalone artist-authentication suite.
- Production build, Wrangler deployment dry run and an execution check of the actual built Worker, rendered pages, client assets and artist login.
- A local isolated Miniflare simulation with 300 distinct queue participants, ten 300-client snapshot bursts, duplicate joins, and 20 simultaneous advance requests. Exactly one advance won; the others safely returned conflicts.
- These checks exercise application correctness. They do **not** certify deployed capacity, browser audio, cellular reception, provider latency, or physical speaker operation. Run a hosted rehearsal before directing the crowd to the new URL.

## Quick setup: deploy through GitHub

The repository includes **Actions → Deploy Your Mic to Cloudflare**, an explicitly started workflow. It creates or reuses the named D1 database and private R2 bucket, keeps an existing account workers.dev subdomain, applies migrations, builds and publishes the Worker, configures artist secrets, and checks the live health and artist login. It does not purchase a plan, change billing, change DNS, delete storage, or deploy on ordinary source pushes.

1. Create/sign in to a [Cloudflare account](https://dash.cloudflare.com/sign-up), verify the email, enable **Workers Paid ($5/month minimum)** and **R2 Standard** billing. This app can start on the included `workers.dev` address, so buying a domain or a website Pro plan is unnecessary.
2. Copy the Cloudflare **Account ID**. Create a scoped API token for that account with **Workers Scripts: Edit**, **D1: Edit**, **Workers R2 Storage: Edit**, and **Account Settings: Read**. If using the **Edit Cloudflare Workers** template, ensure **D1: Edit** is added. Restrict account resources to the intended account. No DNS permissions or Global API key are needed for the default workers.dev deployment.
3. In the GitHub repository, open **Settings → Secrets and variables → Actions → New repository secret** and add:

   | Secret name | Value |
   | --- | --- |
   | `CLOUDFLARE_ACCOUNT_ID` | The account ID |
   | `CLOUDFLARE_API_TOKEN` | The scoped token |
   | `ARTIST_PASSWORD` | A strong password you choose, at least 16 characters, for your artist studio |

   Set secret values directly in GitHub. Do not paste passwords, tokens or payment details in chat or commit them. The workflow generates a separate `SESSION_SECRET` on the first deployment and preserves it on later deployments.
4. Open **Actions → Deploy Your Mic to Cloudflare → Run workflow**, choosing `main`. The successful run summary links to the live site and artist studio. The setup script updates the database ID within the temporary checkout; it need not write back to the repository, and later runs look up the same named resources again.
5. Log into `/admin` using your artist password, upload the album/beats, and rehearse the actual phone/speaker flow. Use the new event QR. Existing Sites data is not automatically copied.

The cloud provisioning workflow is covered by mocked resource-reuse/permission-failure tests. Its real provider operations and hosted checks cannot run until the account, plan and secrets are configured.

## Alternative: deploy from a local checkout

1. Enable **Workers Paid** and **R2 Standard** on the intended Cloudflare account. Connect the repository or deploy from a checkout. Node 22.13+ and the package-manager version pinned in `package.json` are required. Run `corepack enable` and `pnpm install --frozen-lockfile` if using Corepack.
2. Authenticate with `pnpm exec wrangler login`. Select the intended account and set `CLOUDFLARE_ACCOUNT_ID` when multiple accounts are available. For CI, use a scoped Cloudflare API token stored as a CI secret, never in Git.
3. Provision storage:

   ```sh
   pnpm exec wrangler d1 create your-mic
   pnpm exec wrangler r2 bucket create your-mic-audio
   ```

4. Replace the development `database_id` in `wrangler.cloudflare.jsonc` with the returned D1 ID. If resource names differ, update their names in the config and commands too. Keep that ID in Git; it is an identifier, not a secret. The deployment helper refuses the placeholder.
5. Initialize schema:

   ```sh
   pnpm run db:migrate:cloudflare
   ```

6. Set two strong, distinct secrets using the interactive prompts:

   ```sh
   pnpm exec wrangler secret put ARTIST_PASSWORD --config wrangler.cloudflare.jsonc
   pnpm exec wrangler secret put SESSION_SECRET --config wrangler.cloudflare.jsonc
   ```

   Use a randomly generated password of at least 16 characters and a separate random session secret of at least 32 characters. Only the artist needs the password. The audience stays anonymous. Sessions expire after 12 hours; rotating the session secret invalidates existing sessions. This initial independent deployment supports one artist owner; the Sites version retains its existing ChatGPT artist accounts. Do not share the artist password with the audience.
7. Build and publish:

   ```sh
   pnpm run typecheck
   pnpm test
   pnpm run build:cloudflare
   node --experimental-strip-types tests/smoke-build.mjs
   pnpm run deploy:cloudflare
   ```

   The deploy script uses the generated `dist/server/wrangler.json`, not the TypeScript source entry. Rebuild after changing source or configuration. To use Cloudflare Workers Builds after initial storage and secret setup, set the build command to `pnpm run build:cloudflare` and deployment command to `pnpm run deploy:cloudflare`.
8. Open the returned HTTPS URL, check `/healthz`, sign in at `/admin`, create an event, upload tracks/beats and get the **new host's** event QR code. Test an anonymous phone join and a full Playlist → Automatic → queued performance → playlist-resume cycle with the physical speaker. Confirm the release list export.

The repository contains code, schema and deployment configuration. It does not contain the existing Sites database, audio, subscriber list, credentials or browser queue passes. A fresh Cloudflare deployment starts empty. Existing Sites data and live event links are not automatically migrated; create/upload the new event or perform a separately verified data migration before changing public links. No provider account or paid hosting is created by cloning this repo.

## AI MC announcements

The Cloudflare configuration includes an `AI` binding. The MC uses Deepgram Aura-2 English (`@cf/deepgram/aura-2-en`) with the **Zeus** voice: a deep American voice. Enable Workers AI access/billing in the same Cloudflare account if prompted. There is no separate Deepgram or OpenAI signup or key for the independent Worker. Current published Aura-2 pricing is $0.03 per 1,000 input characters; for example 50 newly generated 200-character announcements cost about **$0.30**, before other usage. Repeated identical recordings are cached. Check the provider dashboard for actual charges.

In **Artist studio → Speaker control → AI MC**:

- **Play track opening and closing clips** defaults on. Each track owns a closing credit and an independent opening introduction. Closing credits never announce a successor. The actual selected track supplies its own opening; a prepared rapper-specific introduction adds their name.
- Choose **After: [song] → Custom text** to replace that song’s interstitial. Text saves after a brief typing pause and speech preparation begins immediately. `{track}`, `{album}`, and `{artist}` are supported; the automatic next-song/rapper callout is appended.
- Opening and closing announcements are independent, optional, and off by default. Each supports automatic or custom wording. Use `{artist}`, `{album}`, and `{event}` in those scripts. A ready opening announcement plays when starting a set, without repeating on pause/resume.
- Check **End show after this song** whenever you are ready to finish, even midway through the playlist. The app closes the queue, plays the optional ready outro, and stops; the playlist does not restart. Uncheck it before the boundary to keep going. In an idle, connected session, **End show now** is also available.
- Speech is generated and downloaded while music plays. Late script edits retain an earlier ready recording for that same track and clip side. Opening and closing scripts can be edited independently with Before/After selections. A changed queue never reuses a recording calling the wrong name. If no safe recording is ready, speech is skipped and the next track starts; synthesis never blocks a track boundary. Last-second queue changes or a provider/network failure can therefore omit that transition’s MC callout.
- The next music file is warmed in the browser. This does not make internet audio fully offline or promise sample-accurate, gapless music playback. Use the real speaker device for rehearsal.
- All MC controls, script saves and synthesis requests require artist ownership. The audience cannot generate billable speech or edit announcements. Draft scripts are not in public snapshots. Live announcement text is shown during the callout.

The existing ChatGPT Sites host has no speech credentials or AI binding. Its editor remains usable and clearly shows that voice activates on Cloudflare; it does not claim to have generated speech. For an optional speech-enabled Sites rehearsal using the same Cloudflare account, set the production Sites environment values `MC_CLOUDFLARE_ACCOUNT_ID` and secret `MC_CLOUDFLARE_API_TOKEN` (a token with Workers AI access). Never put the token in source or a public form. A Cloudflare deployment uses its native binding instead.

Provider documentation: [Aura-2 model and pricing](https://developers.cloudflare.com/workers-ai/models/aura-2-en/), [Workers AI bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/), [Deepgram voices](https://developers.deepgram.com/docs/tts-models).

## Event operation

- Keep one artist tab open, awake, connected to reliable internet and the speaker. Claim speaker control before playback; avoid deployments during the show.
- At least the upcoming audio must be fetched over the internet. The app is not a fully offline player. A physical local music copy is useful if the venue connection fails, but an offline copy does not provide online queue changes.
- On mobile, audio requires a user interaction. Queue membership does not depend on keeping the page open. The browser remembers an anonymous queue pass; the private pass link also recovers it on another device. The recovery token lives in the URL fragment and is not included in public event links or HTTP URLs. Keep the private link to yourself.
- The queue keeps moving while a participant is away. They can miss their turn if it passes before they return; the artist can see/call the next name. Queue alerts appear while the page is open; background push notifications are not implemented. Adding full user accounts would not by itself provide background alerts.
- `Listen along` follows approximate track position; it is not a low-latency microphone stream or sample-accurate synchronization system. The web app does not record live vocals.
- Release addresses are collected with consent and exportable. Sending album-release email still requires an email provider.
- Watch Worker errors, CPU time, D1 latency and request counts during the rehearsal and first event. The configured 100 ms per-invocation CPU ceiling is not a monthly spending cap. D1 and R2 retain their own service limits.
- Use D1 Time Travel/backups and keep original audio files. Before a migration, export the database with Wrangler and retain the export securely outside the public repository.

## Render comparison

Render's smallest paid web compute plan is **$7/month**, with 512 MB RAM and 0.5 CPU. Managed Postgres starts at **$6/month**, so a web service plus that database starts around **$13/month**, before storage and bandwidth. Its Hobby workspace currently includes 5 GB outbound bandwidth; public internet overage is $0.15/GB, shared across workspace services.

Render could host an adapted Node version, with audio served directly from R2 and a durable database. **The current application is not a drop-in Render deployment:** it imports `cloudflare:workers` and uses D1, R2 and Worker streaming APIs. It needs a real Node/runtime/storage adapter before Render deployment. Running the Wrangler development server on Render is not the proposed production architecture. Because Cloudflare already matches the app and avoids an additional running server/database bill, it is the recommended first deployment.

## Continue developing in Sites

The default `vite.config.ts`, Sites helper scripts and `.openai/hosting.json` preserve the existing Sites workflow. Independent deployment uses `vite.cloudflare.config.ts` and `wrangler.cloudflare.jsonc`. Changes pushed here do not automatically update the existing Sites project; move reviewed source changes through its normal save/publish workflow. Likewise, Sites edits need to be exported/reconciled into GitHub before the independent host receives them.

## Provider references

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Render compute pricing](https://render.com/pricing)
- [Render outbound bandwidth](https://render.com/docs/outbound-bandwidth)


## Artist playback controls

The artist studio starts with transport and playlist controls collapsed. **Show controls** unlocks track selection, speaker play/skip, playlist changes and MC settings; **Hide controls** leaves a read-only now-playing summary and locks track clicks. Playback, queue refresh and speech preparation continue while collapsed. MC drafts stay mounted and finish saving.

On the artist page, clicking a track uses the speaker player and replaces the current song. It does not start an audience headphone preview. Selecting a track before connecting claims the speaker and starts that selection. Audience-page previews remain private to their device. The active speaker lease and playback version guard still apply; an outdated advance cannot replace a newer manual selection.

## Miles voice activation

Miles belongs to **Deepgram Flux TTS**, model `flux-miles-en`, not Cloudflare's Aura-2 voice catalog. The integration uses Deepgram's batch `POST /v2/speak` endpoint and caches completed MP3 announcements in the same private R2 bucket. It uses the existing background preparation and safe late-edit behavior.

1. Create a Deepgram account at https://console.deepgram.com/ and create a project API key with **Member** permissions. Enable usage/credits if required by Deepgram.
2. In GitHub **Your-Mic → Settings → Secrets and variables → Actions**, add a repository secret named **DEEPGRAM_API_KEY**. Never commit or paste the value into chat.
3. Run **Deploy Your Mic to Cloudflare** on `main`. The workflow passes the key directly into the Worker's secret store without logging it. An empty CI secret does not delete an existing Worker key. Alternatively set the Worker secret with `wrangler secret put DEEPGRAM_API_KEY --config wrangler.cloudflare.jsonc`.
4. Reload the artist studio. **AI MC → Voice: Miles** confirms the selected provider. New recordings have distinct cache IDs from Zeus, and the browser retires the old voice cache when the profile changes.

Until the key exists, the studio shows **Zeus · Miles setup pending** and retains working Cloudflare speech. A failed configured Flux request does not silently change voices; prior safe recordings can play, or the announcement is skipped so music continues.

Reference: https://developers.deepgram.com/docs/flux-tts/voices and https://developers.deepgram.com/reference/speak/v-2/audio/generate .

## Playback continuity

The speaker uses complete, buffered audio files. Current-song downloading finishes before sound starts, and the next selection downloads in advance. Only current/next files and a file being replaced are retained; audio object URLs are released when no longer needed. Crowd headphone previews continue using streaming audio.

The speaker audio decoder is the authority for its playhead. Polling, late API replies and MC preparation never seek a running song to a server clock. A song starts at zero after download; an explicit resume/takeover position is applied once. Each track/announcement instance has a separate `playback_id`, including repeats of the same song. Old heartbeats and late media loads cannot reset a newer instance. Pause and reconnect report the actual decoded position.

A single failed heartbeat no longer pauses audio. Buffered playback continues while the app retries, up to the existing 45-second speaker lease. An explicit takeover, authentication rejection or expired lease still stops the old controller. The screen should remain awake; device output changes, Bluetooth faults and operating-system interruptions remain outside the website's control.

Regression coverage includes delayed loads, large server-clock drift, repeated snapshots, pause/resume, same-track repeat, MC boundaries, stale downloads, truncated audio, stale heartbeat positions, lease ownership and optional public record labels. When `DEEPGRAM_API_KEY` is supplied, deployment also synthesizes a short Miles sound check with the real provider and discards that test recording.

## Record label credit

**New event** and **Edit event** include an optional **Record label** field. When supplied, the label appears below the event's artist/album information for both artists and audience members. Existing events keep an empty label until edited; tracks and release signups are preserved.


## Split track clips and boundary recovery

The refreshed artist player requests the split MC protocol. A song plays its
own closing credit, then the server selects the actual next playlist/queue
entry and plays that track’s opening introduction before its music. A queue
arrival during the closing credit therefore gets the correct introduction.
Named introductions are bound to the exact queue entry and name. If a late
entry has no named recording yet, the already downloaded generic introduction
for its actual track can play; an older name is never substituted.

Generic opening and closing recordings are prepared for the full set in the
background. The current closing credit, next opening and queued callouts are
prioritized. Existing custom `mc_text` remains the closing script; the new
`mc_intro_text` field stores the independent opening script. Optional show
intro/outro remain separate. The song files are not rewritten or re-uploaded.
An unavailable recording is skipped instead of waiting for TTS at a boundary.

Older artist tabs retain their working combined protocol until refreshed.
Refresh between songs to load this player. The new player times out a stalled
control request and retries a failed transition only while the same audio
instance remains ended; version/instance checks prevent double advancement
when the server committed a request whose response was lost. It also warns
before leaving a playing tab and reacquires a screen wake lock on return.

The offline/downloaded transport remains on `development/local-show-audio`
and is not part of this production change. Main still needs internet for
server-coordinated transitions and new queue arrivals.

## Downloaded artist shows (development branch only)

`development/local-show-audio` contains opt-in local playback. It is not enabled
in the production deployment until that branch is deliberately merged/deployed.

In the artist speaker controls, choose **Download show**, wait for all audio to
be verified, then **Start local playback** while online. Album files and every
freestyle beat are stored as complete, revisioned IndexedDB blobs. The active
player keeps only current/next files in memory. A fresh readiness check runs at
start; incomplete, undecodable, replaced or missing files cannot count as ready.
The browser's protected-storage request can be denied; that status is displayed.

Local playback advances the playlist, known FIFO queue and playback modes on
the device. No audio fetch, server lease, server clock or transition request is
needed to keep the downloaded music moving. Server updates never seek this
player. Acknowledged monotonic reports publish real playhead/queue progress;
new queue arrivals merge on reconnect without replaying completed turns.
Prepared MC audio is saved too. If a needed recording is unavailable, music
continues. A new person's name or a new edit still requires speech generation
online. Only the last received queue is available during an outage.

The server reserves the show to that controller until **Finish local playback**
pauses and releases it. Normal/forced takeover and changing track files are
blocked during the reservation. Web Locks prevent another tab on the same
browser from running the show. If the original tab is lost, return in that
browser while connected to recover its checkpoint, paused for an explicit tap.
An artist may reset an abandoned reservation on another device only after
confirming the original speaker has stopped: an offline device cannot receive
remote stop commands. Offline reopening of the application shell is not included.
Keep the artist tab open, foregrounded and awake throughout the performance.

Regression coverage includes full-file persistence/retry/quota failures,
revision invalidation, offline looping and FIFO, poll/ack clock drift, resume,
announcements, server reservation privacy/ownership, expired leases, stale
reports, completion and safe release. Browser/hardware rehearsal remains
required before promoting this branch to a live event.


## High-energy Miles and audio handoffs

Miles now uses Flux `expressivity=2`, the provider's maximum expressivity.
The voice profile is part of each speech cache key, so calmer cached clips
are retired and new announcements are generated at the new setting. The
artist studio displays **Miles · Maximum energy**. Deepgram labels this
control beta; audition the generated names/scripts before the event.

The speaker waits for metadata before playing a new source. Aborted older
play attempts and stale outgoing announcement errors cannot pause a new
song; server pause requests with a stale playback ID are rejected. A transient
browser AbortError retries the same loaded audio without reloading or seeking.
Resume calls native playback directly from the button interaction when audio
is already ready. Native decoder/download failures display specific messages.

Full-file downloads bypass the browser HTTP cache, reject partial HTTP 206
responses and Content-Range, and retry once before reporting a failure. Files
are published to the speaker only after the complete response is received.
Deployment checks synthesize and decode a real maximum-energy Miles sample
and read/decode the first uploaded song when ffmpeg is available. These checks
are read-only and do not change the live show or its queue.

Reference: https://developers.deepgram.com/docs/tts-expressivity .


## Native browser downloader correction

The speaker cache binds native `fetch` to `globalThis`. Calling it as a method
of the cache without that binding throws a browser `TypeError` (Illegal
invocation) before any song request reaches the network. MC clips use their
own direct fetch, which explains why voice could play while songs failed.
The receiver regression covers both default and supplied native fetch.
Browser verification also exercises the real default downloader without a
substitute fetch function. The dedicated **Resume speaker** action always
retries/resumes; it cannot toggle to Pause when server state still says Playing.
