import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

// Refuse the local-development ID before making any remote deployment request.
const config = readFileSync(new URL('../wrangler.cloudflare.jsonc',import.meta.url),'utf8');
if (config.includes('00000000-0000-4000-8000-000000000000')) {
  throw new Error('Create the Cloudflare D1 database and replace database_id in wrangler.cloudflare.jsonc before deployment. See DEPLOYMENT.md.');
}
const generated = JSON.parse(readFileSync(new URL('../dist/server/wrangler.json',import.meta.url),'utf8'));
const sourceDatabaseId = /"database_id"\s*:\s*"([^"]+)"/.exec(config)?.[1];
if (!sourceDatabaseId || generated.d1_databases?.[0]?.database_id !== sourceDatabaseId) {
  throw new Error('The generated build has stale storage configuration. Run pnpm run build:cloudflare before deployment.');
}
const result = spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','dist/server/wrangler.json'],{stdio:'inherit'});
if (result.error) throw result.error;
process.exit(result.status??1);
