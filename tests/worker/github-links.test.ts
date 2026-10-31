import {exerciseGithubReviews} from './github-review-scenario';
import {env} from 'cloudflare:workers';
import {it,expect,vi} from 'vitest';
import {setupIntegrations} from './integration-fixture';
import {exerciseGithubAutomation,exerciseGithubCommits,exerciseGithubDeployments} from './github-automation-scenario';
import {bindings} from './base-auth-fixture';
import {exerciseGithubHealthAccess} from './github-health-scenario';
it('[GITHUB-001 GITHUB-002 GITHUB-003 GITHUB-004 RELEASE-002] signed deliveries preserve links, automate team statuses and notify followers exactly once',async()=>{
 const f=await setupIntegrations(),issue=await f.create(),second=await f.create({title:'Second referenced work'}),res=await f.call('/settings/integrations/github','POST',{name:'Owned repository',repository:'octocat/test-repo1'});expect(res.status).toBe(201);
 expect(await (await f.call('/issues/'+issue.identifier)).json()).toMatchObject({branchName:issue.identifier.toLowerCase()+'-authored-work'});
 const config=await res.json() as {id:string;secret:string;receiver:string};
 const otherResponse=await f.call('/settings/integrations/github','POST',{name:'Quiet repository',repository:'octocat/linguist'});expect(otherResponse.status).toBe(201);
 const other=await otherResponse.json() as {id:string};
 const health=async()=>{const response=await f.call('/settings/integrations');expect(response.status).toBe(200);return (await response.json() as {github:{id:string;lastReceivedEventAt:string|null}[]}).github;};
 const receiptTime=async(id=config.id)=>(await health()).find(row=>row.id===id)!.lastReceivedEventAt;
 expect(await receiptTime()).toBeNull();expect(await receiptTime(other.id)).toBeNull();
 const payload=(action='opened',state='open',at='2026-10-01T00:00:00.000Z',merged=false)=>({action,number:42,repository:{full_name:'octocat/test-repo1'},pull_request:{number:42,title:'Fix '+issue.identifier,body:'Also '+second.identifier+' and UNKNOWN-77',html_url:'https://github.com/octocat/test-repo1/pull/42',state,merged,updated_at:at}});
 const send=async(value:unknown,delivery=crypto.randomUUID(),tamper=false,event='pull_request')=>{const text=JSON.stringify(value),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(config.secret),{name:'HMAC',hash:'SHA-256'},false,['sign']),signed=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text))),signature=[...signed].map(byte=>byte.toString(16).padStart(2,'0')).join('');return f.app.request(config.receiver,{method:'POST',headers:{'X-Hub-Signature-256':'sha256='+signature,'X-GitHub-Delivery':delivery,'X-GitHub-Event':event,'Content-Type':'application/json'},body:tamper?text+' ':text},bindings);};
 expect((await send({repository:{full_name:'octocat/test-repo1'}},crypto.randomUUID(),false,'ping')).status).toBe(200);
 expect((await send({repository:{full_name:'octocat/wrong'}},crypto.randomUUID(),false,'ping')).status).toBe(400);
 expect((await send({repository:{full_name:'octocat/test-repo1'}},crypto.randomUUID(),true,'ping')).status).toBe(401);
 expect(await receiptTime()).toBeNull();
 const before=(await env.DB.prepare('SELECT * FROM issues ORDER BY id').all()).results;
 expect((await send(payload(),crypto.randomUUID(),true)).status).toBe(401);expect((await send({...payload(),repository:{full_name:'octocat/git-consortium'}})).status).toBe(400);
 expect(await receiptTime()).toBeNull();
 const delivery=crypto.randomUUID(),clock=Date.now();
 vi.useFakeTimers({toFake:['Date']});
 try{
  vi.setSystemTime(clock);
  expect((await send(payload(),delivery)).status).toBe(200);
  const firstReceipt=await receiptTime();expect(firstReceipt).toBe(new Date(clock).toISOString());
  expect(firstReceipt).toBe(await env.DB.prepare('SELECT received_at FROM vector_github_deliveries WHERE repository_id=? AND delivery_id=?').bind(config.id,delivery).first('received_at'));
  expect(await receiptTime(other.id)).toBeNull();
  vi.setSystemTime(clock+1000);
  expect((await send(payload(),delivery)).status).toBe(200);expect((await send(payload('edited'),delivery)).status).toBe(409);
  expect(await receiptTime()).toBe(firstReceipt);
  f.restart();expect((await send(payload(),delivery)).status).toBe(200);expect(await receiptTime()).toBe(firstReceipt);
  expect((await send(payload('edited'),crypto.randomUUID(),true)).status).toBe(401);expect(await receiptTime()).toBe(firstReceipt);
  await env.DB.prepare("CREATE TRIGGER deny_health_receipt BEFORE INSERT ON vector_github_deliveries BEGIN SELECT RAISE(ABORT,'synthetic-vector-5200'); END").run();
  try{expect((await send(payload('edited'))).status).toBe(503);}finally{await env.DB.prepare('DROP TRIGGER deny_health_receipt').run();}
  expect(await receiptTime()).toBe(firstReceipt);
  vi.setSystemTime(clock+2000);
  expect((await send(payload('edited'))).status).toBe(200);expect(await receiptTime()).toBe(new Date(clock+2000).toISOString());expect(await receiptTime(other.id)).toBeNull();
 }finally{vi.useRealTimers();}
 expect((await env.DB.prepare('SELECT count(*) n FROM vector_github_issue_links').first())?.n).toBe(2);expect((await env.DB.prepare('SELECT * FROM issues ORDER BY id').all()).results).toEqual(before);
 for(const [action,state,at] of [['edited','open','2026-10-01T01:00:00.000Z'],['closed','closed','2026-10-01T02:00:00.000Z'],['reopened','open','2026-10-01T03:00:00.000Z']]){
  expect((await send(payload(action,state,at))).status).toBe(200);expect(await env.DB.prepare('SELECT state FROM vector_github_pull_requests WHERE number=42').first<string>('state')).toBe(state);
 }
 expect((await send(payload('closed','closed','2026-10-03T00:00:00.000Z',true))).status).toBe(200);
 expect((await send(payload('reopened','open','2026-10-02T00:00:00.000Z'))).status).toBe(200);
 expect(await env.DB.prepare('SELECT state FROM vector_github_pull_requests WHERE number=42').first<string>('state')).toBe('merged');
 const links=await f.call('/issues/'+issue.identifier+'/github');expect(links.status).toBe(200);expect((await links.json() as {pullRequests:{state:string;url:string}[]}).pullRequests[0]).toMatchObject({state:'merged',url:'https://github.com/octocat/test-repo1/pull/42'});
 await exerciseGithubAutomation(f,send);
 await exerciseGithubCommits(f,send);
 await exerciseGithubDeployments(f,send);
 await exerciseGithubReviews(f);
 await exerciseGithubHealthAccess(f,config.id);
 const lastReceipt=await receiptTime();
 expect((await f.call('/settings/integrations/github/'+config.id,'DELETE')).status).toBe(200);expect((await send(payload())).status).toBe(401);expect(await receiptTime()).toBe(lastReceipt);expect(await receiptTime(other.id)).toBeNull();
 expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
},180000);
