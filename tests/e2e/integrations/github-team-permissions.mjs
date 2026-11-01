import {strict as assert} from 'node:assert';
import {navigate,settleReads,trackRequests} from '../collaboration-navigation.mjs';
import {confirmLink,readDevelopmentLink} from '../outbox-session.mjs';
import {openAuthenticatedPage} from '../ui-runtime-auth.mjs';
import {roleScreens} from '../role-ui-support.mjs';
import {openAdministrationForm} from '../ui-administration-form.mjs';

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
 const openTeam=async person=>{
  await navigate(person.page,runtime.base+'/app/settings/teams');
  const teams=person.page.getByRole('region',{name:'Teams',exact:true});await teams.waitFor();
  await openAdministrationForm(person.page,'Edit '+team.name);
  await settleReads(person.page);
  return teams.getByRole('region',{name:'Git automation rules',exact:true});
 };
 const openRules=async person=>{
  const rules=await openTeam(person);
  await rules.getByText(team.name+' Git automation',{exact:true}).click();
  await rules.getByLabel(team.name+' Draft PR opened status',{exact:true}).waitFor();
  return rules;
 };
 const save=async(person,rules,statusId,status=200)=>{
  await rules.getByLabel(team.name+' Draft PR opened status',{exact:true}).selectOption(statusId);
  const response=person.page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname==='/api/settings/teams/'+team.id);
  await rules.getByRole('button',{name:'Save Draft PR opened rule',exact:true}).click();
  const receipt=await response;assert.equal(receipt.status(),status);
  await settleReads(person.page);
  return receipt;
 };
 const permissions=async settings=>{
  const teams=page.getByRole('region',{name:'Teams',exact:true});
  const form=teams.getByRole('form',{name:'Permissions for '+team.name,exact:true});
  await form.getByRole('combobox',{name:'Who manages team settings',exact:true}).selectOption(settings);
  const response=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname===`/api/settings/teams/${team.id}/permissions`);
  await form.getByRole('button',{name:'Save permissions',exact:true}).click();
  assert.equal((await response).status(),200);await settleReads(page);
 };
 try{
  await page.setViewportSize({width:1440,height:1000});
  await navigate(page,runtime.base+'/app/settings/teams');
  await openAdministrationForm(page,'Permissions for '+team.name);
  await permissions('team_owners');
  const lead=await invite(1730,'member','owner'),member=await invite(1731,'member','member');
  const leadRules=await openRules(lead);
  await save(lead,leadRules,started.id);
  await leadRules.getByRole('status').getByText('Rule saved.',{exact:true}).waitFor();
  console.log('Git Teams cell a: Member who owns the team saved under Team owners only');
  await inspect(lead.page,lead.page.getByRole('region',{name:'Teams',exact:true}),'github-team-owner');
  assert.ok(!(await request(member,'/github/automation')).teams.some(t=>t.id===team.id));
  await request(member,'/settings/teams/'+team.id,'PATCH',{githubAutomation:{trigger:'draft',statusId:null,allowReopen:false,expectedVersion:0}},403);
  await permissions('all_members');
  const memberRules=await openRules(member);
  await save(member,memberRules,started.id);
  await memberRules.getByRole('status').getByText('Rule saved.',{exact:true}).waitFor();
  console.log('Git Teams cell b: ordinary Member saved under All team members');
  await inspect(member.page,member.page.getByRole('region',{name:'Teams',exact:true}),'github-team-member');
  await member.page.setViewportSize({width:1440,height:1000});
  // A newer rule must survive an already-open editor's conflicting save.
  const current=(await call('/github/automation')).teams.find(t=>t.id===team.id).rules.find(r=>r.trigger==='draft');
  await call('/settings/teams/'+team.id,'PATCH',{githubAutomation:{trigger:'draft',statusId:started.id,allowReopen:false,expectedVersion:current.version}});
  const stale=await save(member,memberRules,review.id,409);
  assert.equal((await stale.json()).error,'stale_github_rule');
  await memberRules.getByRole('status').getByText('This rule changed. Reload the page before saving again.',{exact:true}).waitFor();
  const newer=(await call('/github/automation')).teams.find(t=>t.id===team.id).rules.find(r=>r.trigger==='draft');
  assert.equal(newer.version,current.version+1);assert.equal(newer.statusId,started.id);
  // Permission revocation is checked before any navigation or document reload.
  await permissions('team_owners');
  assert.ok(!(await request(member,'/github/automation')).teams.some(t=>t.id===team.id),'the next GET omits the revoked team');
  await save(member,memberRules,review.id,403);
  await memberRules.getByRole('status').getByText('You no longer have permission to change this team’s rules.',{exact:true}).waitFor();
  assert.deepEqual((await call('/github/automation')).teams.find(t=>t.id===team.id).rules.find(r=>r.trigger==='draft'),newer);
  assert.equal(await (await openTeam(member)).count(),0,'revoked Member sees no rules editor');
  console.log('Git Teams cell c: next GET omitted the team, save refused 403 with visible error, and the next Teams screen hid the editor');
  await inspect(member.page,member.page.getByRole('region',{name:'Teams',exact:true}),'github-team-member-refused');
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
  await adminRules.getByRole('status').getByText('Rule saved.',{exact:true}).waitFor();
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
