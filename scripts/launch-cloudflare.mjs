import {readFile,writeFile,appendFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {deploymentCredentials,provisionCloudflare,cloudflareApi} from './cloudflare-resources.mjs';

const credentials=deploymentCredentials(process.env);
const resources=await provisionCloudflare(credentials);
const configPath=new URL('../wrangler.cloudflare.jsonc',import.meta.url);
const config=await readFile(configPath,'utf8');
if(!/"database_id"\s*:\s*"[^"]+"/.test(config))throw Error('Missing D1 configuration.');
await writeFile(configPath,config.replace(/("database_id"\s*:\s*")[^"]+(")/,(_match,before,after)=>before+resources.databaseId+after));
console.log('Cloudflare storage is ready. Applying migrations and building Your Mic.');

async function command(args,input) {
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,args,{cwd:new URL('..',import.meta.url),env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},stdio:[input?'pipe':'ignore','inherit','inherit']});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`Deployment step ${args[0]} failed with exit ${code}.`)));
    if(input)child.stdin.end(input);
  });
}
await command(['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','your-mic','--remote','--config','wrangler.cloudflare.jsonc']);
await command(['node_modules/vite/bin/vite.js','build','--config','vite.cloudflare.config.ts']);
await command(['scripts/deploy-cloudflare.mjs']);
const secrets=await cloudflareApi(credentials)('/workers/scripts/your-mic/secrets');
if(!Array.isArray(secrets))throw Error('Could not confirm the existing Worker secret names.');
const values={ARTIST_PASSWORD:credentials.password};
if(!secrets.some(s=>s.name==='SESSION_SECRET'))values.SESSION_SECRET=randomBytes(48).toString('base64url');
await command(['node_modules/wrangler/bin/wrangler.js','secret','bulk','--config','wrangler.cloudflare.jsonc'],JSON.stringify(values));

// Check the exact origin returned from this account's subdomain configuration.
let healthy=false;
for(let attempt=0;attempt<5;attempt++) {
  try {
    const response=await fetch(resources.url+'/healthz',{signal:AbortSignal.timeout(10000)});
    healthy=response.ok&&(await response.json()).ok===true;
  }catch{}
  if(healthy)break;
  await new Promise(resolve=>setTimeout(resolve,2000));
}
if(!healthy)throw Error('Deployment finished but the new host did not pass its health check. Inspect the Cloudflare deploy before sharing the URL.');
const login=await fetch(resources.url+'/artist/sign-in',{method:'POST',redirect:'manual',headers:{Origin:resources.url,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:credentials.password}),signal:AbortSignal.timeout(10000)});
if(login.status!==303)throw Error(`The deployed artist sign-in check returned HTTP ${login.status}.`);
const cookie=login.headers.get('set-cookie')?.split(';')[0];
if(!cookie)throw Error('The artist sign-in did not return a session cookie.');
const me=await fetch(resources.url+'/api/me',{headers:{Cookie:cookie},signal:AbortSignal.timeout(10000)});
if(!me.ok||(await me.json()).signedIn!==true)throw Error('The deployed artist session check failed.');
console.log(`Your Mic is live and its health and artist sign-in checks passed: ${resources.url}`);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## Your Mic deployed\n\n[Open Your Mic](${resources.url}) · [Artist studio](${resources.url}/admin)\n\nHealth and artist-session checks passed. Create/upload the event and rehearse with phones and the speaker before sharing its new QR code.\n`);
