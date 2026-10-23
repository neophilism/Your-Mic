// Cloudflare control-plane operations. Credentials stay in environment/memory.
export function deploymentCredentials(env) {
  const accountId=env.CLOUDFLARE_ACCOUNT_ID||'',token=env.CLOUDFLARE_API_TOKEN||'',password=env.ARTIST_PASSWORD||'';
  if(!/^[a-f0-9]{32}$/i.test(accountId))throw Error('Set CLOUDFLARE_ACCOUNT_ID to the account ID from your Cloudflare dashboard.');
  if(!token.trim())throw Error('Set CLOUDFLARE_API_TOKEN as a GitHub Actions secret.');
  if(password.length<16)throw Error('Set ARTIST_PASSWORD as a GitHub Actions secret of at least 16 characters.');
  return {accountId,token,password};
}
export function cloudflareApi({accountId,token},fetcher=fetch) {
  return async function api(path,{method='GET',body,missing=false}={}) {
    const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`,{
      method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000),
    });
    if(response.status===404&&missing)return null;
    const data=await response.json().catch(()=>null);
    if(!response.ok||data?.success!==true) {
      const codes=(data?.errors||[]).map(x=>x.code).filter(x=>Number.isInteger(x)).join(', ');
      // Do not log request headers, submitted values, raw responses or secrets.
      throw Error(`Cloudflare ${method} ${path.split('?')[0]} failed (HTTP ${response.status}${codes?'; codes '+codes:''}). Check the scoped token permissions and that Workers Paid/R2 are enabled.`);
    }
    return data.result;
  };
}
export async function provisionCloudflare(credentials,fetcher=fetch) {
  const api=cloudflareApi(credentials,fetcher);
  const databases=await api('/d1/database?name=your-mic&per_page=100');
  if(!Array.isArray(databases))throw Error('Unexpected D1 database listing. No resources were changed.');
  const matches=databases.filter(d=>d.name==='your-mic');
  if(matches.length>1)throw Error('Multiple matching D1 databases. Select the intended database before proceeding.');
  const database=matches[0]||await api('/d1/database',{method:'POST',body:{name:'your-mic',primary_location_hint:'enam'}});
  if(!/^[a-f0-9-]{36}$/i.test(database?.uuid||''))throw Error('Cloudflare did not return a valid D1 database ID.');
  let bucket=await api('/r2/buckets/your-mic-audio',{missing:true});
  if(!bucket)bucket=await api('/r2/buckets',{method:'POST',body:{name:'your-mic-audio',storageClass:'Standard',locationHint:'enam'}});
  let domain=await api('/workers/subdomain',{missing:true});
  if(!domain?.subdomain)domain=await api('/workers/subdomain',{method:'PUT',body:{subdomain:'your-mic-'+credentials.accountId.slice(0,12)}});
  if(!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(domain?.subdomain||''))throw Error('Cloudflare did not return a usable workers.dev subdomain.');
  return {databaseId:database.uuid,bucketName:bucket.name,subdomain:domain.subdomain,url:`https://your-mic.${domain.subdomain}.workers.dev`};
}
