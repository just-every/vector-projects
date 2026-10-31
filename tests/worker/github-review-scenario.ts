import {env} from 'cloudflare:workers';
import {expect} from 'vitest';
import type {setupIntegrations} from './integration-fixture';
import {bindings,invite,request} from './base-auth-fixture';
import {beforeBatch} from './administration-fixture';
import {proveGithubReviewArchive} from './github-review-archive';

type ReviewProjection={state:string;headSha:string|null;reviews:{reviewerId:number;reviewer:string;state:string;commitSha:string}[]};
/** One signed transport journey exercises native readback, ordering and refusal boundaries. */
export async function exerciseGithubReviews(f:Awaited<ReturnType<typeof setupIntegrations>>){
 const issue=await f.create({title:'synthetic-vector-5300 review work'}),repository='synthetic-vector-5300/reviews';
 const configured=await f.call('/settings/integrations/github','POST',{name:'synthetic-vector-5300',repository});expect(configured.status).toBe(201);
 const config=await configured.json() as {id:string;secret:string;receiver:string};
 const a='a'.repeat(40),b='b'.repeat(40),c='c'.repeat(40),date=(minute:number)=>new Date(Date.UTC(2026,9,20,0,minute)).toISOString();
 const pr=(head=a,minute=0,action='opened')=>({action,number:73,repository:{full_name:repository},pull_request:{number:73,title:'Fix '+issue.identifier,body:null,html_url:'https://github.com/'+repository+'/pull/73',state:'open',merged:false,head:{ref:'synthetic-vector-5300',sha:head},updated_at:date(minute)}});
 const review=(id:number,state='approved',minute=1,head=a,reviewer=11)=>({action:state==='dismissed'?'dismissed':'submitted',repository:{full_name:repository},pull_request:pr(head,minute).pull_request,review:{id,user:{id:reviewer,login:'synthetic-vector-'+reviewer},state,commit_id:head,submitted_at:date(minute)}});
 const send=async(value:unknown,event='pull_request_review',delivery=crypto.randomUUID(),tamper=false,db=env.DB)=>{
  const text=JSON.stringify(value),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(config.secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  return f.app.request(config.receiver,{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':'sha256='+signature,'X-GitHub-Delivery':delivery,'X-GitHub-Event':event},body:tamper?text+' ':text},{...bindings,DB:db});
 };
 const read=async()=>{const response=await f.call('/issues/'+issue.identifier+'/github');expect(response.status).toBe(200);return (await response.json() as {pullRequests:ReviewProjection[]}).pullRequests[0]!;};
 const states=async()=>(await read()).reviews.map(r=>[r.reviewerId,r.state]).sort((x,y)=>Number(x[0])-Number(y[0]));
 const snapshot=async()=>Promise.all(['github_reviews','vector_github_pull_requests','vector_github_deliveries','issue_activity','notifications','issues'].map(async table=>(await env.DB.prepare('SELECT * FROM '+table+' ORDER BY 1,2').all()).results));
 expect((await send(review(100))).status).toBe(200);expect((await env.DB.prepare('SELECT * FROM github_reviews').all()).results).toEqual([]);
 expect((await send(pr(),'pull_request')).status).toBe(200);
 const approval=review(101),delivery=crypto.randomUUID();expect((await send(approval,'pull_request_review',delivery)).status).toBe(200);
 expect((await read()).reviews).toEqual([{reviewerId:11,reviewer:'synthetic-vector-11',state:'approved',commitSha:a}]);
 const accepted=await snapshot();
 f.restart();expect((await send(approval,'pull_request_review',delivery)).status).toBe(200);expect(await snapshot()).toEqual(accepted);
 expect((await send(review(101,'changes_requested'),'pull_request_review',delivery)).status).toBe(409);expect(await snapshot()).toEqual(accepted);
 expect((await send(review(102),'pull_request_review',crypto.randomUUID(),true)).status).toBe(401);expect(await snapshot()).toEqual(accepted);
 expect((await send({...review(102),repository:{full_name:'synthetic-vector-5301/reviews'}})).status).toBe(400);expect(await snapshot()).toEqual(accepted);
 expect((await send(review(102,'changes_requested',2,a,12))).status).toBe(200);
 expect((await send(review(103,'changes_requested',3))).status).toBe(200);
 expect((await send(review(104,'approved',2))).status).toBe(200);
 expect(await states()).toEqual([[11,'changes_requested'],[12,'changes_requested']]);
 expect((await send(review(103,'dismissed',3))).status).toBe(200);
 expect(await states()).toEqual([[11,'dismissed'],[12,'changes_requested']]);
 expect((await send(review(105,'approved',4))).status).toBe(200);
 expect((await send(pr(b,5,'synchronize'),'pull_request')).status).toBe(200);expect((await read()).reviews).toEqual([]);
 expect((await send(review(106,'approved',4))).status).toBe(200);expect((await read()).reviews).toEqual([]);
 expect((await send(review(107,'approved',6,b))).status).toBe(200);expect(await states()).toEqual([[11,'approved']]);
 expect((await send(pr(a,4,'synchronize'),'pull_request')).status).toBe(200);expect((await read()).headSha).toBe(b);expect(await states()).toEqual([[11,'approved']]);
 expect((await send(pr(a,6,'synchronize'),'pull_request')).status).toBe(200);expect((await read()).reviews).toEqual([]);expect((await read()).headSha).toBeNull();
 expect((await send(pr(b,7,'synchronize'),'pull_request')).status).toBe(200);expect((await read()).reviews).toEqual([]);
 expect((await send(review(108,'approved',8,b))).status).toBe(200);expect(await states()).toEqual([[11,'approved']]);
 // A signed review observing a newer head also removes certainty about the older approval.
 expect((await send(review(109,'commented',9,c,13))).status).toBe(200);expect((await read()).reviews).toEqual([]);
 expect((await send(pr(b,8,'synchronize'),'pull_request')).status).toBe(200);expect((await read()).headSha).toBe(c);
 expect((await send(pr(c,9,'synchronize'),'pull_request')).status).toBe(200);
 expect((await send(review(110,'approved',10,c))).status).toBe(200);expect(await states()).toEqual([[11,'approved']]);
 expect((await send(review(111,'dismissed',11,c))).status).toBe(200);
 expect((await send(review(111,'approved',11,c))).status).toBe(200);expect(await states()).toEqual([[11,'dismissed']]);
 expect((await send(review(112,'approved',12,c))).status).toBe(200);
 expect((await send(review(112,'changes_requested',12,c))).status).toBe(200);expect(await states()).toEqual([[11,'conflicted']]);
 const mismatch=review(113,'approved',13,c);mismatch.review.commit_id=a;
 expect((await send(mismatch)).status).toBe(200);expect(await states()).toEqual([[11,'conflicted']]);
 const rollback=await snapshot();
 await env.DB.prepare("CREATE TRIGGER deny_review_receipt BEFORE INSERT ON vector_github_deliveries BEGIN SELECT RAISE(ABORT,'synthetic-vector-5302'); END").run();
 try{
  expect((await send(review(114,'approved',14,c))).status).toBe(503);expect(await snapshot()).toEqual(rollback);
  expect((await send(pr(a,15,'synchronize'),'pull_request')).status).toBe(503);expect(await snapshot()).toEqual(rollback);
  expect((await send(review(112,'dismissed',12,c))).status).toBe(503);expect(await snapshot()).toEqual(rollback);
 }finally{await env.DB.prepare('DROP TRIGGER deny_review_receipt').run();}
 await env.DB.prepare("INSERT INTO vector_restore_status(id,import_id,effects_held) VALUES(1,'synthetic-vector-5303',1)").run();
 const held=await snapshot();expect((await send(review(114,'approved',14,c))).status).toBe(401);expect(await snapshot()).toEqual(held);
 await env.DB.prepare('DELETE FROM vector_restore_status').run();
 const racing=beforeBatch(()=>env.DB.prepare('UPDATE vector_github_repositories SET enabled=0 WHERE id=?').bind(config.id).run());
 const race=await snapshot();expect((await send(review(114,'approved',14,c),'pull_request_review',crypto.randomUUID(),false,racing)).status).toBe(401);expect(await snapshot()).toEqual(race);
 await env.DB.prepare('UPDATE vector_github_repositories SET enabled=1 WHERE id=?').bind(config.id).run();
 expect((await send(review(114,'approved',14,c))).status).toBe(200);
 const raceRows=(await snapshot())[0];
 const headRace=beforeBatch(async()=>{expect((await send(pr(b,16,'synchronize'),'pull_request')).status).toBe(200);});
 expect((await send(review(115,'approved',15,c),'pull_request_review',crypto.randomUUID(),false,headRace)).status).toBe(503);
 expect((await snapshot())[0]).toEqual(raceRows);expect((await read()).reviews).toEqual([]);
 expect((await send(pr(c,18,'synchronize'),'pull_request')).status).toBe(200);
 expect((await send(review(116,'approved',19,c))).status).toBe(200);expect(await states()).toEqual([[11,'approved']]);
 // Returning to a previous commit cannot revive any earlier generation's review.
 expect((await send(pr(a,20,'synchronize'),'pull_request')).status).toBe(200);expect((await read()).reviews).toEqual([]);
 expect((await send(review(101))).status).toBe(200);expect((await read()).reviews).toEqual([]);
 expect((await send(review(117,'approved',21,a))).status).toBe(200);expect(await states()).toEqual([[11,'approved']]);
 // A later observation by another reviewer cannot discard a same-head decision.
 expect((await send(pr(b,22,'synchronize'),'pull_request')).status).toBe(200);
 expect((await send(pr(a,23,'synchronize'),'pull_request')).status).toBe(200);
 expect((await send(review(119,'approved',24,a,11))).status).toBe(200);
 expect((await send(review(120,'approved',26,a,12))).status).toBe(200);
 const delayedDecision=review(121,'changes_requested',25,a,11),delayedDelivery=crypto.randomUUID();
 expect((await send(delayedDecision,'pull_request_review',delayedDelivery)).status).toBe(200);
 f.restart();expect((await send(delayedDecision,'pull_request_review',delayedDelivery)).status).toBe(200);
 const delayedStates=await states();
 console.log('PROBE GITHUB-005 delayed-review: signed receiver then issue GitHub read -> '+JSON.stringify(delayedStates));
 expect.soft(delayedStates).toEqual([[11,'changes_requested'],[12,'approved']]);
 // A late intervening head retires old decisions while preserving a fresh return-head review.
 expect((await send(pr(b,27,'synchronize'),'pull_request')).status).toBe(200);
 expect((await send(pr(a,28,'synchronize'),'pull_request')).status).toBe(200);
 expect((await send(review(122,'approved',29,a,11))).status).toBe(200);
 expect((await send(review(123,'approved',32,a,12))).status).toBe(200);
 expect((await send(pr(b,30,'synchronize'),'pull_request')).status).toBe(200);
 expect((await send(pr(a,31,'synchronize'),'pull_request')).status).toBe(200);
 const returningStates=await states();
 console.log('PROBE GITHUB-005 delayed-head: signed receiver then issue GitHub read -> '+JSON.stringify(returningStates));
 expect.soft(returningStates).toEqual([[12,'approved']]);
 const outsider=await invite('synthetic-vector-5304'+bindings.FIRST_OWNER_EMAIL!.slice(bindings.FIRST_OWNER_EMAIL!.indexOf('@')),f.cookie);
 expect((await request('/api/issues/'+issue.identifier+'/github','GET',undefined,outsider)).status).toBe(200);
 expect((await f.call('/settings/teams/'+f.initial.teams[0]!.id+'/privacy','PUT',{isPrivate:true})).status).toBe(200);
 const privateSnapshot=await snapshot(),refused=await request('/api/issues/'+issue.identifier+'/github','GET',undefined,outsider);
 expect(refused.status).toBe(404);expect(await refused.text()).not.toContain('synthetic-vector-11');expect(await snapshot()).toEqual(privateSnapshot);
 expect((await request('/api/issues/'+issue.identifier+'/github')).status).toBe(401);
 // A review and a merge may share GitHub's second-resolution timestamp.
 expect((await send(review(118,'approved',33,a))).status).toBe(200);
 const merged={...pr(a,33,'closed'),pull_request:{...pr(a,33).pull_request,state:'closed',merged:true,merge_commit_sha:'d'.repeat(40)}};
 expect((await send(merged,'pull_request')).status).toBe(200);expect((await read()).state).toBe('merged');
 await proveGithubReviewArchive(f,config,approval,issue.identifier);
 const beforeRevoke=await snapshot();expect((await f.call('/settings/integrations/github/'+config.id,'DELETE')).status).toBe(200);
 expect((await send(review(115,'approved',15,c))).status).toBe(401);expect((await send(approval,'pull_request_review',delivery)).status).toBe(401);expect(await snapshot()).toEqual(beforeRevoke);
 expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
 console.log('PROBE GITHUB-005 signed-review: mounted signed receiver -> approval, changes requested, dismissal and reviewer identity retained; head generations, older and conflicting events, restart replay, signatures, repository, authority, rollback and private reads fenced');
}
