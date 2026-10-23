# Your Mic deployment

Recommended starting point: **Cloudflare Workers Paid + D1 + R2 Standard**, directly in your own Cloudflare account. The source already uses these runtimes and storage APIs. No Render service, separate Postgres server, Redis, music-generation API, or paid email service is needed for the live queue and playback.

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

## Deploy independently to Cloudflare

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

## Event operation

- Keep one artist tab open, awake, connected to reliable internet and the speaker. Claim speaker control before playback; avoid deployments during the show.
- At least the upcoming audio must be fetched over the internet. The app is not a fully offline player. A physical local music copy is useful if the venue connection fails, but an offline copy does not provide online queue changes.
- On mobile, audio requires a user interaction. Queue alerts appear while the page is open; background push notifications are not implemented.
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
