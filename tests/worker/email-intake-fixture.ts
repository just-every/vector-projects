import { expect, vi } from 'vitest';
import worker from './entry';
import { bindings, request } from './base-auth-fixture';
import { createUlid } from '../../src/core/shared/ids';

export const mailBindings = {...bindings,MAIL_MODE:'local-outbox',MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:'synthetic-vector-711'};
export function inboundFixture(address: string, messageId: string, options: {from?:string;replyTo?:string;attachments?:boolean;body?:string} = {}) {
  const from = options.from ?? 'synthetic-vector-712@example.test';
  const lines = [`From: ${from}`,`To: ${address}`,'Cc: synthetic-vector-713@example.test',`Message-ID: ${messageId}`,'Subject: A delivery problem',...(options.replyTo ? [`In-Reply-To: ${options.replyTo}`,`References: ${options.replyTo}`] : []),'MIME-Version: 1.0',
    ...(options.attachments ? ['Content-Type: multipart/mixed; boundary="synthetic-vector-714"','','--synthetic-vector-714','Content-Type: text/plain','','The delivery is delayed.','--synthetic-vector-714','Content-Type: image/png','Content-Disposition: inline; filename="delivery.png"','Content-ID: <delivery-image>','Content-Transfer-Encoding: base64','','iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','--synthetic-vector-714','Content-Type: text/plain','Content-Disposition: attachment; filename="delivery.txt"','','Delivery details','--synthetic-vector-714--',''] : ['Content-Type: text/plain','',options.body ?? 'The requester replies.'])];
  const raw = new TextEncoder().encode(lines.join('\r\n'));
  const headers = new Headers();
  for (const line of lines) { if (!line) break; const colon=line.indexOf(':'); if(colon>0)headers.append(line.slice(0,colon),line.slice(colon+1).trim()); }
  let rejected: string | undefined;
  return {message:{from,to:address,headers,raw:new ReadableStream<Uint8Array>({start(c){c.enqueue(raw);c.close();}}),rawSize:raw.length,setReject(reason:string){rejected=reason;}},rejected:()=>rejected};
}
export async function seedIntakeForTeam(teamId:string,cookie:string,attachments=false,body?:string) {
  const address = `synthetic-vector-${createUlid(new Date()).toLowerCase()}@example.test`;
  const settings={enabled:true,address,allowedSenders:['synthetic-vector-712@example.test','synthetic-vector-713@example.test'],acknowledgement:false};
  const configured=await request(`/api/settings/teams/${teamId}/email-intake`,'PUT',settings,cookie);
  expect(configured.status,await configured.clone().text()).toBe(200);
  const messageId=`<synthetic-vector-${createUlid(new Date())}@example.test>`;
  const receipt=inboundFixture(address,messageId,{attachments,body});
  const result=await worker.email(receipt.message,mailBindings);
  expect(result.status).toBe('received');expect(receipt.rejected()).toBeUndefined();
  return {address,messageId,settings,identifier:result.identifier!};
}
export async function recordSendGrid<T>(operation:()=>Promise<T>) {
  const calls: {url:string;body:any}[]=[];
  vi.stubGlobal('fetch',async (input:RequestInfo|URL,init?:RequestInit)=>{calls.push({url:String(input),body:JSON.parse(String(init?.body))});return new Response(null,{status:202,headers:{'X-Message-Id':'synthetic-vector-'+createUlid(new Date())}});});
  try {return {result:await operation(),calls};}
  finally {vi.unstubAllGlobals();}
}
export async function recordedReply(cookie:string,identifier:string,body:string,requestId=createUlid(new Date())) {
  const {result:response,calls}=await recordSendGrid(()=>request(`/api/issues/${identifier}/email-replies`,'POST',{body,requestId},cookie,mailBindings));
  return {response,calls,requestId};
}
