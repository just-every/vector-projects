import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {navigate,settleReads} from '../collaboration-navigation.mjs';
import {roleScreens} from '../role-ui-support.mjs';

/** Signed native review events reach the actual issue screen and survive reload. */
export async function exerciseGithubReviews({page,runtime,cookie,team,evidence}){
 await runtime.freshRequestWindow();
 await page.setViewportSize({width:1440,height:1000});
 const errors=[],onError=e=>errors.push(e.message),onConsole=m=>{if(/hydration|did not match|Minified React error #(418|423|425)/i.test(m.text()))errors.push(m.text());};
 page.on('pageerror',onError);page.on('console',onConsole);
 const call=async(path,method='GET',body,status=200)=>{const response=await runtime.req('/api'+path,{method,headers:{Cookie:cookie,Origin:runtime.base,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(response.status,status,await response.clone().text());return response.json();};
 const repository='synthetic-vector-5400/reviews',config=await call('/settings/integrations/github','POST',{name:'synthetic-vector-5400',repository},201);
 const issue=await call('/issues','POST',{teamId:team.id,title:'synthetic-vector-5401 review projection'},201),a='a'.repeat(40),b='b'.repeat(40);
 const date=n=>new Date(Date.UTC(2026,9,21,0,n)).toISOString();
 const pr=(sha,minute,action='opened')=>({action,number:83,repository:{full_name:repository},pull_request:{number:83,title:'Fix '+issue.identifier,body:null,state:'open',merged:false,html_url:'https://github.com/'+repository+'/pull/83',head:{ref:'synthetic-vector-5401',sha},updated_at:date(minute)}});
 const review=(id,state,minute,sha=a,reviewer=21)=>({action:state==='dismissed'?'dismissed':'submitted',repository:{full_name:repository},pull_request:pr(sha,minute).pull_request,review:{id,user:{id:reviewer,login:'synthetic-vector-'+reviewer},state,commit_id:sha,submitted_at:date(minute)}});
 const send=async(body,event='pull_request_review')=>{const text=JSON.stringify(body),response=await runtime.req(new URL(config.receiver).pathname,{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':'sha256='+createHmac('sha256',config.secret).update(text).digest('hex'),'X-GitHub-Delivery':randomUUID(),'X-GitHub-Event':event},body:text});assert.equal(response.status,200,await response.clone().text());await response.body.cancel();};
 const region=page.getByRole('region',{name:'GitHub links',exact:true}),reviews=region.locator('[aria-label="Pull request reviews"]');
 const reload=async()=>{await page.reload();await region.waitFor();await settleReads(page);};
 try{
  await send(pr(a,0),'pull_request');await send(review(201,'approved',1));
  await navigate(page,runtime.base+'/app/issues/'+issue.identifier);await reviews.getByText('Approved',{exact:true}).waitFor();
  await reviews.getByText('synthetic-vector-21 · Approved · aaaaaaa',{exact:true}).waitFor();
  await reload();await reviews.getByText('Approved',{exact:true}).waitFor();
  await send(review(202,'changes_requested',2));await reload();await reviews.getByText('Changes requested',{exact:true}).waitFor();
  await reviews.getByText('synthetic-vector-21 · Changes requested · aaaaaaa',{exact:true}).waitFor();
  await send(review(202,'dismissed',2));await reload();await reviews.getByText('Review needed',{exact:true}).waitFor();
  await reviews.getByText('synthetic-vector-21 · Review dismissed · aaaaaaa',{exact:true}).waitFor();
  await send(review(203,'approved',3));await send(pr(b,4,'synchronize'),'pull_request');await reload();
  await reviews.getByText('Review needed',{exact:true}).waitFor();assert.equal(await reviews.getByText('Approved',{exact:true}).count(),0);
  await send(review(204,'approved',3));await reload();await reviews.getByText('Review needed',{exact:true}).waitFor();
  await send(review(205,'approved',5,b));await send(review(206,'changes_requested',6,b,22));await reload();
  await reviews.getByText('Changes requested',{exact:true}).waitFor();
  await reviews.getByText('synthetic-vector-21 · Approved · bbbbbbb',{exact:true}).waitFor();
  await reviews.getByText('synthetic-vector-22 · Changes requested · bbbbbbb',{exact:true}).waitFor();
  const link=region.getByRole('link',{name:'Fix '+issue.identifier+' · '+repository+' #83',exact:true});
  await link.focus();assert.equal(await link.evaluate(e=>e===document.activeElement),true);
  assert.equal(await link.getAttribute('href'),'https://github.com/'+repository+'/pull/83');
  assert.ok(await region.evaluate(root=>[...root.querySelectorAll('strong,li,a')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=13)),'Review text is at least 13px');
  await roleScreens(evidence)(page,region,'github-review-state');
  assert.deepEqual(errors,[],'Review badges hydrate without browser errors');
  console.log('PROBE GITHUB-005 visible-review: signed webhook -> Approved with reviewer, Changes requested, Review dismissed and Review needed after head change; reload retains current reviewers; 1440 and 390 captures pass accessibility and overflow checks');
 }finally{page.off('pageerror',onError);page.off('console',onConsole);}
}
