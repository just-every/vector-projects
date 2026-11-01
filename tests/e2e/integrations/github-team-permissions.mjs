import {strict as assert} from 'node:assert';
import {navigate,settleReads,trackRequests} from '../collaboration-navigation.mjs';
import {confirmLink,readDevelopmentLink} from '../outbox-session.mjs';
import {openAuthenticatedPage} from '../ui-runtime-auth.mjs';
import {roleScreens} from '../role-ui-support.mjs';
import {openTeam as openTeamPage} from '../settings-pane-support.mjs';

/** The existing Git journey carries team-setting admission through native sessions. */
export async function exerciseGithubTeamPermissions({page,runtime,call,team,started,review,evidence}){
 const inspect=roleScreens(evidence),people=[];
 const request=async(person,path,method='GET',body,status=200)=>{
  const response=await person.page.request.fetch(runtime.base+'/api'+path,{method,headers:{Origin:runtime.base},...(body===undefined?{}:{data:body})});
  assert.equal(response.status(),status,method+' '+path+' '+await response.text());
  return response.json();
 };
 const invite=async(number,role,standing)=>{
  const name='synthetic-vector-'+number,email=name+'@example.test';
  await call('/settings/operators/invite','POST',{displayName:name,email,role,...(role==='guest'?{teamIds:[team.id]}:{})},202);
  const signed=await confirmLink(await readDevelopmentLink(runtime.base,null,email,runtime.state));
  assert.equal(signed.status,303);
  const cookie=signed.headers.get('set-cookie').split(';')[0];
  const actorPage=await openAuthenticatedPage(page.context().browser(),cookie,runtime.base);
  trackRequests(actorPage);await actorPage.setViewportSize({width:1440,height:1000});
  const person={page:actorPage,errors:[]};people.push(person);
  actorPage.on('pageerror',error=>person.errors.push(error.message));
  const metadata=await request(person,'/metadata');person.id=metadata.viewer.id;
  if(standing)await call(`/settings/teams/${team.id}/members/${person.id}`,'PUT',{role:standing});
  assert.equal(metadata.viewer.role,role);
  return person;
 };
 const rulesOf=person=>person.page.getByRole('region',{name:'Git automation',exact:true});
 const openTeam=async person=>{
  await openTeamPage(person.page,runtime.base,team,'automation');
  await settleReads(person.page);
  return rulesOf(person);
 };
 const openRules=async person=>{
  const rules=await openTeam(person);
  await rules.getByLabel('Draft PR opened',{exact:true}).waitFor();
  return rules;
 };
 // The choice stores as it changes: its answer is the field's own Saved, or its refusal and Retry. A choice already on
 // this status is first moved off it (it stores only when it changes), and a refused one is answered by Retry.
 const save=async(person,rules,statusId,status=200)=>{
  const field=rules.getByLabel('Draft PR opened',{exact:true});
  const patch=()=>person.page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname==='/api/settings/teams/'+team.id);
  const retry=rules.getByRole('button',{name:'Retry',exact:true});
  let response;
  if(await retry.count()){response=patch();await retry.click();}
  else{
   if(await field.inputValue()===statusId){const moved=patch();await field.selectOption('');assert.equal((await moved).status(),200);}
   response=patch();await field.selectOption(statusId);
  }
  const receipt=await response;assert.equal(receipt.status(),status);
  await settleReads(person.page);
  return receipt;
 };
 const permissions=async settings=>{
  await openTeamPage(page,runtime.base,team,'planning');
  const field=page.getByLabel('Team settings',{exact:true});
  // A choice stores only when it changes: already set, nothing is sent.
  if(await field.inputValue()===settings)return;
  const response=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname===`/api/settings/teams/${team.id}/permissions`);
  await field.selectOption(settings);
  assert.equal((await response).status(),200);await settleReads(page);
 };
 try{
  await page.setViewportSize({width:1440,height:1000});
  await permissions('team_owners');
  const lead=await invite(1730,'member','owner'),member=await invite(1731,'member','member');
  const leadRules=await openRules(lead);
  await save(lead,leadRules,started.id);
  await leadRules.getByText('Saved',{exact:true}).first().waitFor();
  console.log('Git Teams cell a: Member who owns the team saved under Team owners only');
  await inspect(lead.page,rulesOf(lead),'github-team-owner');
  assert.ok(!(await request(member,'/github/automation')).teams.some(t=>t.id===team.id));
  await request(member,'/settings/teams/'+team.id,'PATCH',{githubAutomation:{trigger:'draft',statusId:null,allowReopen:false,expectedVersion:0}},403);
  await permissions('all_members');
  const memberRules=await openRules(member);
  await save(member,memberRules,started.id);
  await memberRules.getByText('Saved',{exact:true}).first().waitFor();
  console.log('Git Teams cell b: ordinary Member saved under All team members');
  await inspect(member.page,rulesOf(member),'github-team-member');
  await member.page.setViewportSize({width:1440,height:1000});
  // A newer rule must survive an already-open editor's conflicting save.
  const current=(await call('/github/automation')).teams.find(t=>t.id===team.id).rules.find(r=>r.trigger==='draft');
  await call('/settings/teams/'+team.id,'PATCH',{githubAutomation:{trigger:'draft',statusId:started.id,allowReopen:false,expectedVersion:current.version}});
  const stale=await save(member,memberRules,review.id,409);
  assert.equal((await stale.json()).error,'stale_github_rule');
  await memberRules.getByText('Couldn’t save',{exact:false}).waitFor();await memberRules.getByText('This rule changed in the meantime. Retry to save your choice on top of the latest.',{exact:true}).waitFor();
  const newer=(await call('/github/automation')).teams.find(t=>t.id===team.id).rules.find(r=>r.trigger==='draft');
  assert.equal(newer.version,current.version+1);assert.equal(newer.statusId,started.id);
  // Permission revocation is checked before any navigation or document reload.
  await permissions('team_owners');
  assert.ok(!(await request(member,'/github/automation')).teams.some(t=>t.id===team.id),'the next GET omits the revoked team');
  await save(member,memberRules,review.id,403);
  await memberRules.getByText('You no longer have permission to change this team’s rules.',{exact:true}).waitFor();
  assert.deepEqual((await call('/github/automation')).teams.find(t=>t.id===team.id).rules.find(r=>r.trigger==='draft'),newer);
  await openTeamPage(member.page,runtime.base,team,'details');await settleReads(member.page);assert.equal(await rulesOf(member).count(),0,'revoked Member sees no rules editor');assert.equal(await member.page.getByRole('navigation',{name:'Team sections',exact:true}).getByRole('link',{name:'Automation',exact:true}).count(),0,'Automation is absent, not greyed');
  console.log('Git Teams cell c: next GET omitted the team, save refused 403 with visible error, and the next Teams screen hid the editor');
  await inspect(member.page,member.page.locator('.settings-pane'),'github-team-member-refused');
  await member.page.setViewportSize({width:1440,height:1000});
  await navigate(member.page,runtime.base+'/app/settings/developers');
  const personal=member.page.getByRole('region',{name:'Integrations',exact:true});
  await personal.getByRole('heading',{name:'API tokens',exact:true}).waitFor();
  assert.equal(await personal.getByRole('heading',{name:'GitHub pull request webhooks',exact:true}).count(),0);
  assert.equal(await personal.getByRole('region',{name:'Git automation rules',exact:true}).count(),0);
  assert.equal(await personal.getByRole('button',{name:'Register repository',exact:true}).count(),0);
  assert.equal(await personal.getByText('GitHub event received',{exact:false}).count(),0,'Members see no GitHub receipt state');
  await request(member,'/settings/integrations','GET',undefined,403);
  console.log('Git Teams cell e: Member Integrations has personal API controls and no workspace setup');
  await inspect(member.page,personal,'github-member-integrations');
  const admin=await invite(1732,'admin');
  const adminRules=await openRules(admin);await save(admin,adminRules,started.id);
  await adminRules.getByText('Saved',{exact:true}).first().waitFor();
  for(const [number,role] of [[1733,'guest'],[1734,'viewer']]){
   const person=await invite(number,role);
   await navigate(person.page,runtime.base+'/app/settings/teams');
   await person.page.getByText('You can’t open this page.').waitFor();await settleReads(person.page);
   assert.equal(await person.page.getByRole('region',{name:'Teams',exact:true}).count(),0,role+' cannot open team settings');
   assert.equal(await person.page.getByRole('region',{name:'Git automation rules',exact:true}).count(),0,role+' sees no editor');
   await request(person,'/github/automation','GET',undefined,403);
   await request(person,'/settings/teams/'+team.id,'PATCH',{githubAutomation:{trigger:'draft',statusId:null,allowReopen:false,expectedVersion:0}},403);
   console.log('Git Teams refusal: '+role+' has no editor and both native doors refuse 403');
  }
  assert.ok(people.every(person=>person.errors.length===0),'permission screens have no browser errors');
  console.log('Git Teams permissions: team owner, ordinary Member, revocation, stale save, Admin, Guest, Viewer and personal Integrations PASS');
 }finally{
  for(const person of people){await settleReads(person.page);await person.page.context().close();}
 }
}
