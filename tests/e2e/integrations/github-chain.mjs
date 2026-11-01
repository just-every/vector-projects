import {openAdministrationForm} from '../ui-administration-form.mjs';
import {exerciseGithubTeamPermissions} from './github-team-permissions.mjs';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {roleScreens} from '../role-ui-support.mjs';
import {navigate,settleReads,trackRequests} from '../collaboration-navigation.mjs';
import {confirmLink,readDevelopmentLink} from '../outbox-session.mjs';
export async function exerciseGithubChain({page:shared,runtime,cookie,team,width,evidence}){
 const page=await shared.context().newPage();trackRequests(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/hydration|did not match|Minified React error #(418|423|425)/i.test(m.text()))errors.push(m.text());});
 const inspect=roleScreens(evidence),headers={Cookie:cookie,Origin:runtime.base,'Content-Type':'application/json'};
 const call=async(path,method='GET',body,status=200)=>{const res=await runtime.req('/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});assert.equal(res.status,status,await res.clone().text());return res.json();};
 try{
  const initial=await call('/settings/administration'),current=initial.teams.find(t=>t.id===team.id);
  if(!current.statuses.some(s=>s.name==='In Review'))await call('/settings/teams/'+team.id+'/statuses','POST',{name:'In Review',category:'started'});
  if(!current.statuses.some(s=>s.name==='Shipped'))await call('/settings/teams/'+team.id+'/statuses','POST',{name:'Shipped',category:'completed'});
  const state=await call('/settings/administration'),statuses=state.teams.find(t=>t.id===team.id).statuses;
  const shipped=statuses.find(s=>s.name==='Shipped'),review=statuses.find(s=>s.name==='In Review'),started=statuses.find(s=>s.category==='started'),done=statuses.find(s=>s.category==='completed');
  const fixtureRepository='synthetic-vector-1710/chain-'+width;
  const config=await call('/settings/integrations/github','POST',{name:'synthetic-vector-1710 '+width,repository:fixtureRepository},201);
  await page.setViewportSize({width,height:900});await navigate(page,runtime.base+'/app/settings/connections');
  const integrations=page.getByRole('region',{name:'Integrations',exact:true});
  await integrations.getByRole('link',{name:'Manage Git automation rules in Teams',exact:true}).waitFor();
  assert.ok((await integrations.getByRole('link',{name:'Manage Git automation rules in Teams',exact:true}).boundingBox()).height>=44,'the Git automation link is a 44px touch target');
  await inspect(page,integrations,'github-owner-integrations-'+width);
  await page.setViewportSize({width,height:900});
  await integrations.getByRole('link',{name:'Manage Git automation rules in Teams',exact:true}).click();
  const teams=page.getByRole('region',{name:'Teams',exact:true});
  await openAdministrationForm(page,'Edit '+team.name);
  const rules=teams.getByRole('region',{name:'Git automation rules',exact:true});await rules.getByText(team.name+' Git automation',{exact:true}).click();
  const saveMessages=[];
  for(const [trigger,label,status] of [['draft','Draft PR opened',review.id],['review','Review requested',review.id],['merged','PR merged',done.id],['deploy','Production deployed',shipped.id]]){
   await rules.getByLabel(team.name+' '+label+' status',{exact:true}).selectOption(status);
   const saved=page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname==='/api/settings/teams/'+team.id);
   await rules.getByRole('button',{name:'Save '+label+' rule',exact:true}).click();assert.equal((await saved).status(),200);
   await settleReads(page);
   const message=rules.getByRole('group',{name:label,exact:true}).getByRole('status');
   await message.waitFor();saveMessages.push(await message.textContent());
  }
  await rules.getByLabel(team.name+' Draft PR opened status',{exact:true}).selectOption(started.id);
  const savedAgain=page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname==='/api/settings/teams/'+team.id);
  await rules.getByRole('button',{name:'Save Draft PR opened rule',exact:true}).click();
  const second=await savedAgain;
  console.log('Git rule saves '+width+': first message='+saveMessages[0]+' second PATCH='+second.status());
  assert.equal(second.status(),200,'Owner can save the Draft PR rule twice without reloading');
  await rules.getByRole('group',{name:'Draft PR opened',exact:true}).getByRole('status').getByText('Rule saved.',{exact:true}).waitFor();
  assert.ok(saveMessages.every(message=>message==='Rule saved.'),'Every first save confirms success');
  assert.ok(!(await rules.textContent()).includes('invalid_value'),'Rule saves never expose validation JSON');
  await inspect(page,rules,'github-rules-'+width);
  const versioned=(await call('/github/automation')).teams.find(t=>t.id===team.id).rules.find(r=>r.trigger==='review');
  const staleSaves=await Promise.all([review.id,review.id].map(statusId=>runtime.req('/api/settings/teams/'+team.id,{method:'PATCH',headers,body:JSON.stringify({githubAutomation:{trigger:'review',statusId,allowReopen:false,expectedVersion:versioned.version}})})));
  assert.deepEqual(staleSaves.map(r=>r.status).sort(),[200,409],'one concurrent rule save wins and the stale version refuses');
  const staleRefusal=staleSaves.find(response=>response.status===409);
  assert.equal((await staleRefusal.clone().json()).error,'stale_github_rule');
  const afterRace=(await call('/github/automation')).teams.find(t=>t.id===team.id).rules.find(r=>r.trigger==='review');
  assert.equal(afterRace.version,versioned.version+1,'the losing save commits no rule update');
  for(const response of staleSaves)await response.body.cancel();
  console.log('Git concurrent stale saves '+width+': 200/409 PASS');
  if(width===1440)await exerciseGithubTeamPermissions({page,runtime,call,team,started,review,evidence});
  const issue=await call('/issues','POST',{teamId:team.id,title:'synthetic-vector-1711 Fix checkout '+width},201);
  await navigate(page,runtime.base+'/app/issues/'+issue.identifier);
  const branch=page.getByRole('region',{name:'Git branch',exact:true});const expected=issue.identifier.toLowerCase()+'-synthetic-vector-1711-fix-checkout-'+width;
  assert.equal(await branch.getByLabel('Branch name',{exact:true}).inputValue(),expected);
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await branch.getByRole('button',{name:'Copy branch name',exact:true}).click();await branch.getByRole('status').getByText('Branch name copied.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),expected);
  await inspect(page,branch,'github-branch-'+width);
  const send=async(body,delivery=randomUUID(),event='pull_request')=>{
   const text=JSON.stringify(body),signature=createHmac('sha256',config.secret).update(text).digest('hex');
   const response=await fetch(config.receiver,{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':'sha256='+signature,'X-GitHub-Delivery':delivery,'X-GitHub-Event':event},body:text});
   assert.equal(response.status,200,await response.clone().text());return response.json();
  };
  const receipts=[];
  for(const [action,updated_at,status] of [['opened','2026-10-10T01:00:00.000Z',started.id],['review_requested','2026-10-10T02:00:00.000Z',review.id],['closed','2026-10-10T03:00:00.000Z',done.id]]){
   const merged=action==='closed',body={action,number:71,repository:{full_name:fixtureRepository},pull_request:{number:71,title:'Fixes '+issue.identifier,body:null,head:{ref:expected},draft:!merged,merged,state:merged?'closed':'open',merge_commit_sha:merged?'a'.repeat(40):null,updated_at,html_url:'https://github.com/'+fixtureRepository+'/pull/71'}},delivery=randomUUID();
   receipts.push({body,delivery});await send(body,delivery);assert.equal((await call('/issues/'+issue.identifier)).status.id,status);
  }
  const before=await call('/issues/'+issue.identifier);
  assert.equal(before.activity.filter(a=>a.kind==='issue.status_changed'&&a.actor==='Git automation').length,3);
  for(const receipt of receipts)await send(receipt.body,receipt.delivery);
  const after=await call('/issues/'+issue.identifier);assert.equal(after.version,before.version);
  const notices=runtime.sql("SELECT actor_id,actor_name,causes_json FROM notifications WHERE issue_id='"+issue.id+"'");assert.equal(notices.length,3);assert.equal(notices.filter(n=>JSON.parse(n.causes_json).includes('completed')).length,1);assert.ok(notices.every(n=>n.actor_id===null&&n.actor_name==='Git automation'));
  await navigate(page,runtime.base+'/app/issues/'+issue.identifier);await page.getByRole('link',{name:'Fixes '+issue.identifier+' · '+fixtureRepository+' #71',exact:true}).waitFor();
  await inspect(page,page.locator('.issue-inspector'),'github-linked-issue-'+width);
  const committed=await call('/issues','POST',{teamId:team.id,title:'synthetic-vector-1725 committed checkout '+width},201);
  const commitRows=['b','c'].map((letter,index)=>({id:letter.repeat(40),message:'Fixes '+committed.identifier+' synthetic-vector-172'+index,author:{name:'synthetic-vector-172'+index},url:'https://github.com/'+fixtureRepository+'/commit/'+letter.repeat(40)}));
  const push={ref:'refs/heads/main',repository:{full_name:fixtureRepository,default_branch:'main'},commits:commitRows},pushId=randomUUID();
  await send(push,pushId,'push');const first=await call('/issues/'+committed.identifier);assert.equal(first.status.id,done.id);
  await send(push,pushId,'push');assert.equal((await call('/issues/'+committed.identifier)).version,first.version);
  await navigate(page,runtime.base+'/app/issues/'+committed.identifier);
  const git=page.getByRole('region',{name:'GitHub links',exact:true});
  for(const commit of commitRows){await git.getByRole('link',{name:commit.message,exact:true}).waitFor();await git.getByText('· '+commit.author.name+' · '+commit.id.slice(0,7),{exact:true}).waitFor();}
  await inspect(page,git,'github-commits-'+width);
  const afterSha='e'.repeat(40);
  await send({ref:'refs/heads/main',before:'c'.repeat(40),after:afterSha,forced:false,repository:push.repository,commits:[]},randomUUID(),'push');
  const deployed=(id,sha,environment)=>({repository:push.repository,deployment:{id,sha,environment},deployment_status:{state:'success',created_at:'2026-10-11T12:00:00.000Z'}});
  await send(deployed(901,'c'.repeat(40),'staging'),randomUUID(),'deployment_status');
  const prod=deployed(902,afterSha,'production'),deploymentId=randomUUID();await send(prod,deploymentId,'deployment_status');
  const deployedIssue=await call('/issues/'+committed.identifier);assert.equal(deployedIssue.status.id,shipped.id);assert.equal(deployedIssue.deployments.length,2);
  await send(prod,deploymentId,'deployment_status');assert.equal((await call('/issues/'+committed.identifier)).version,deployedIssue.version);
  await navigate(page,runtime.base+'/app/issues/'+committed.identifier);
  await git.getByRole('heading',{name:'Deployments',exact:true}).waitFor();
  await git.getByText('staging ·',{exact:false}).waitFor();await git.getByText('production ·',{exact:false}).waitFor();
  assert.equal(await git.locator('time[datetime="2026-10-11T12:00:00.000Z"]').count(),2);
  await inspect(page,git,'github-deployments-'+width);
  // Native Guest invitation and confirmation in this disposable test workspace.
  const email='synthetic-vector-1712-'+width+'@example.test';
  await call('/settings/operators/invite','POST',{displayName:'synthetic-vector-1712',email,role:'guest',teamIds:[team.id]},202);
  const link=await readDevelopmentLink(runtime.base,null,email,runtime.state),signed=await confirmLink(link);assert.equal(signed.status,303);
  const guestCookie=signed.headers.get('set-cookie').split(';')[0];
  const refused=await runtime.req('/api/settings/teams/'+team.id,{method:'PATCH',headers:{...headers,Cookie:guestCookie},body:JSON.stringify({githubAutomation:{trigger:'draft',statusId:null,allowReopen:false,expectedVersion:0}})});
  assert.equal(refused.status,403);await refused.body.cancel();
  assert.deepEqual(errors,[],'GitHub screens have no browser or hydration errors');
 }catch(error){console.error('Git rule controls:',await page.getByRole('region',{name:'Git automation rules',exact:true}).ariaSnapshot().catch(()=>''));throw error;}finally{await settleReads(page);await page.close();}
}
