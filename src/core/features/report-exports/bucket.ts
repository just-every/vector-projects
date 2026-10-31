import { hex, sha256 } from '../../../../vendor/base/integrations/core/crypto';
import { IntegrationError } from '../integrations/errors';
import { bucketEndpoint, type bucketConfiguration, type bucketCredentials } from './schedule-schema';
import type { z } from 'zod';

const bytes = (value:string) => new TextEncoder().encode(value);
const sign = async(key:Uint8Array,value:string) => new Uint8Array(await crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',new Uint8Array(key),{name:'HMAC',hash:'SHA-256'},false,['sign']),bytes(value)));
const encode=(value:string)=>encodeURIComponent(value).replace(/[!'()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());

/** Standard path-style S3 PutObject, signed for exactly this object and body.
 * The object name is stable for a run, so a transport replay cannot append a
 * second object. Unknown outcomes are held for explicit administrator review. */
export async function putBucket(config:z.output<typeof bucketConfiguration>,credentials:z.output<typeof bucketCredentials>,key:string,body:string,now:Date) {
  const origin=bucketEndpoint(config.endpoint),url=new URL(origin+'/'+[config.bucket,...key.split('/')].map(encode).join('/'));
  const stamp=now.toISOString().replace(/[:-]|\.\d{3}/g,''),day=stamp.slice(0,8),scope=[day,config.region,'s3','aws4_request'].join('/');
  const digest=await sha256(body),content=config.format==='csv'?'text/csv':'application/json';
  const headers={'content-type':content,host:url.host,'x-amz-content-sha256':digest,'x-amz-date':stamp};
  const names=Object.keys(headers).sort() as (keyof typeof headers)[];
  const canonical=['PUT',url.pathname,'',names.map(name=>name+':'+headers[name]+'\n').join(''),names.join(';'),digest].join('\n');
  let keyBytes=await sign(bytes('AWS4'+credentials.secretAccessKey),day);
  for(const value of [config.region,'s3','aws4_request'])keyBytes=await sign(keyBytes,value);
  const signature=hex(await sign(keyBytes,['AWS4-HMAC-SHA256',stamp,scope,await sha256(canonical)].join('\n')));
  const authorization='AWS4-HMAC-SHA256 Credential='+credentials.accessKeyId+'/'+scope+', SignedHeaders='+names.join(';')+', Signature='+signature;
  let response:Response;
  try{response=await fetch(url.href,{method:'PUT',headers:{...headers,authorization},body,redirect:'manual',signal:AbortSignal.timeout(15000)});}
  catch{throw new IntegrationError(503,'export_transport_uncertain');}
  await response.body?.cancel();
  if(response.status>=500)throw new IntegrationError(503,'export_transport_uncertain');
  if(!response.ok)throw new IntegrationError(400,response.status>=300&&response.status<400?'export_redirect_refused':'export_provider_refused');
}
