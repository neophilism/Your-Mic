import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deploymentCredentials,provisionCloudflare} from '../scripts/cloudflare-resources.mjs';
const credentials={accountId:'a'.repeat(32),token:'test-only-token',password:'test-only-password'};
const database={name:'your-mic',uuid:'11111111-1111-4111-8111-111111111111'};
const response=result=>Response.json({success:true,result});
test('resource setup reuses an existing database, bucket and account subdomain',async()=>{
 const writes=[];const result=await provisionCloudflare(credentials,async(url,init)=>{
  assert.equal(init.method,'GET');writes.push(url);
  if(url.includes('/d1/database?'))return response([database]);
  if(url.endsWith('/r2/buckets/your-mic-audio'))return response({name:'your-mic-audio'});
  if(url.endsWith('/workers/subdomain'))return response({subdomain:'existing-account'});
  throw Error('Unexpected request');
 });
 assert.equal(writes.length,3);assert.equal(result.databaseId,database.uuid);assert.equal(result.url,'https://your-mic.existing-account.workers.dev');
});
test('resource setup creates only missing named resources',async()=>{
 const writes=[];const result=await provisionCloudflare(credentials,async(url,init)=>{
  if(init.method!=='GET'){writes.push([init.method,url,JSON.parse(init.body)]);if(url.endsWith('/d1/database'))return response(database);if(url.endsWith('/r2/buckets'))return response({name:'your-mic-audio'});return response({subdomain:'your-mic-'+credentials.accountId.slice(0,12)});}
  return url.includes('/d1/database?')?response([]):new Response(null,{status:404});
 });
 assert.equal(writes.length,3);assert.equal(writes[0][2].name,'your-mic');assert.equal(writes[1][2].storageClass,'Standard');assert.equal(result.bucketName,'your-mic-audio');
});
test('permission failures stop setup instead of replacing resources',async()=>{
 let calls=0;
 await assert.rejects(provisionCloudflare(credentials,async()=>{calls++;return Response.json({success:false,errors:[{code:10000,message:'Authentication error'}]},{status:403});}),/HTTP 403/);
 assert.equal(calls,1);
});
test('credentials are required before provisioning',()=>{
 assert.throws(()=>deploymentCredentials({}),/CLOUDFLARE_ACCOUNT_ID/);
 assert.throws(()=>deploymentCredentials({CLOUDFLARE_ACCOUNT_ID:credentials.accountId}),/CLOUDFLARE_API_TOKEN/);
 assert.throws(()=>deploymentCredentials({CLOUDFLARE_ACCOUNT_ID:credentials.accountId,CLOUDFLARE_API_TOKEN:'test'}),/ARTIST_PASSWORD/);
});
