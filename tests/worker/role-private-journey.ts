import {env} from 'cloudflare:workers';
import {expect} from 'vitest';
import {afterNativeStatement} from './notification-session-fixture';
import {request,bindings,origin} from './base-auth-fixture';
import {createServerApp} from '../../src/core/app/server';
import {resetLimits,type roleWorkspace} from './role-fixture';
import {resourceParityJourney} from './agent-resource-parity';
import {agentResourceClient} from './agent-resource-journey';
type Workspace=Awaited<ReturnType<typeof roleWorkspace>>;
async function json<T=any>(response:Response,status=200):Promise<T>{expect(response.status,await response.clone().text()).toBe(status);return response.json() as Promise<T>;}

/** The same open sessions cross public -> private -> membership -> withdrawal.
 * Every projection is reached through its native or bearer public door. */
export async function privateVisibilityJourney(w:Workspace) {
 await resourceParityJourney(w);
 const owner=w.people.owner,member=w.member,admin=w.admin;
 const team=(await json(await owner.call('/settings/teams','POST',{name:'synthetic-vector-960',identifierPrefix:'SYNPVT',isPrivate:true}))).teams.find((t:any)=>t.name==='synthetic-vector-960');
 const metadata=(await json(await admin.call('/settings/administration'))).teams.find((t:any)=>t.id===team.id);
 expect(metadata.canRead).toBe(false);
 expect(metadata.isPrivate).toBe(true);
 expect(metadata.members).toEqual(team.members);
 expect(metadata.issueCount).toBe(0);
 const set=(isPrivate:boolean,by=owner)=>by.call(`/settings/teams/${team.id}/privacy`,'PUT',{isPrivate});
 const project=await json(await owner.api('/projects','POST',{name:'synthetic-vector-961',leadOperatorId:owner.id}),201);
 const publicIssue=await json(await owner.call('/issues','POST',{teamId:w.team.id,projectId:project.id,title:'synthetic-vector-962'}),201);
 const issue=await json(await owner.call('/issues','POST',{teamId:team.id,projectId:project.id,title:'synthetic-vector-963',statusId:team.statuses.find((s:any)=>s.category==='started').id,dueDate:'2026-11-04',assigneeOperatorId:member.id}),201);
 const door=await agentResourceClient(member,owner),uri='vector://issue/'+issue.id;
 await door.hidden(uri,issue.title);
 const upload=await createServerApp().request(origin+'/api/issues/'+issue.identifier+'/files',{method:'POST',headers:{cookie:owner.cookie,host:new URL(origin).host,Origin:origin,'content-type':'text/plain','x-file-name':'synthetic-vector-987.txt'},body:'synthetic-vector-988'},bindings);
 const file=await json(upload,201);
 const view=await json(await owner.call('/views','POST',{name:'synthetic-vector-964',isShared:true,query:{team:team.id}}),201);
 const dashboard=await json(await owner.call('/dashboards','POST',{name:'synthetic-vector-965',isShared:true,widgets:[{name:'Visible work',kind:'list',filters:{project:project.id},chart:{}}]}),201);
 const template=await json(await owner.call('/project-templates','POST',{name:'synthetic-vector-966',teamId:team.id,issues:[{title:'synthetic-vector-967',offsetDays:null,milestonePosition:null}]}),201);
 const cycle=await json(await owner.api('/cycles','POST',{teamId:team.id,name:'synthetic-vector-968',startsLocal:'2026-11-01T00:00',endsLocal:'2026-11-08T00:00'}),201);
 const privateCycle=cycle.cycle.id;
 const reference=await json(await owner.call(`/issues/${publicIssue.identifier}`,'PATCH',{expectedVersion:publicIssue.version,description:`See ${issue.identifier}.` }));
 expect(reference.identifier).toBe(publicIssue.identifier);
 const initiative=await json(await owner.call('/initiatives','POST',{name:'synthetic-vector-969',ownerOperatorId:owner.id}),201);
 expect((await owner.call(`/initiatives/${initiative.id}/projects`,'PUT',{expectedVersion:initiative.version,projectIds:[project.id]})).status).toBe(200);
 const query='?q=synthetic-vector-963&includeCompleted=true';
 const pageBefore=await json(await member.call('/issues'));

 const scopes=['/issues'+query,'/current','/my-work','/my-work/activity','/search?q=synthetic-vector-963','/options','/mentions/options','/notifications','/calendar/events?month=2026-11','/project-templates','/dashboards',`/projects/${project.id}`,`/initiatives/${initiative.id}`,'/insights'+query,'/insights.csv'+query,`/dashboards/${dashboard.id}`];
 const hidden=async(who=member)=>{
  for(const path of scopes){await resetLimits();const response=await who.call(path);const body=await response.text();expect(response.status,path+': '+body).toBe(200);for(const secret of [issue.identifier,issue.title,'synthetic-vector-968'])expect(body,path).not.toContain(secret);}
  for(const path of [`/issues/${issue.identifier}`,`/issues/${issue.identifier}/discussion`,`/issues/${issue.identifier}/description-history`,`/issues/${issue.identifier}/references`,`/issues/${issue.identifier}/files/${file.id}`,`/cycles/${privateCycle}`,`/views/${view.id}`,`/project-templates/${template.id}`])expect((await who.call(path)).status,path).toBe(404);
  for(const path of [`/issues/${issue.identifier}`,`/cycles/${privateCycle}`])expect((await who.api(path)).status,path).toBe(404);
  expect(JSON.stringify(await json(await who.api('/issues')))).not.toContain(issue.identifier);
  expect(JSON.stringify(await json(await who.call(`/issues/${publicIssue.identifier}/references`)))).not.toContain(issue.identifier);
  expect((await who.call(`/issues/${issue.identifier}`,'PATCH',{expectedVersion:issue.version,title:'synthetic-vector-970'})).status).toBe(404);
  const progress=await json(await who.call(`/projects/${project.id}`));expect(progress.progress.total).toBe(1);
  const node=await json(await who.call(`/initiatives/${initiative.id}`));expect(node.nodes[0].projects[0].issueCount).toBe(1);
  const report=await json(await who.call('/insights'+query));expect(report.total).toBe(0);
 };
 await hidden();await hidden(admin);
 for(const [path,method,body] of [['/portability/exports','POST',{}]] as const)expect((await admin.call(path,method,body)).status).toBe(404);

 expect((await member.call('/issues?offset=1&revision='+encodeURIComponent(pageBefore.revision))).status).toBe(200); // unchanged scope stays usable

 const untouched=await env.DB.prepare('SELECT is_private FROM teams WHERE id=?').bind(team.id).first('is_private');
 for(const who of [w.member,w.lead,w.guest])for(const surface of ['call','api'] as const){expect((await who[surface](surface==='call'?`/settings/teams/${team.id}/privacy`:`/teams/${team.id}/privacy`,'PUT',{isPrivate:false})).status).toBe(403);}
 expect(await env.DB.prepare('SELECT is_private FROM teams WHERE id=?').bind(team.id).first('is_private')).toBe(untouched);
 expect((await member.call(`/teams/${team.id}/join`,'POST',{})).status).toBe(403);
 expect((await member.call(`/teams/${team.id}/requests`,'POST',{})).status).toBe(404);
 expect((await owner.call(`/settings/teams/${team.id}/members/${w.lead.id}`,'PUT',{role:'owner'})).status).toBe(200);
 // Admin membership authority sees the owner guard without content admission.
 expect((await admin.call(`/settings/teams/${team.id}/members/${w.lead.id}`,'DELETE')).status).toBe(200);
 expect((await admin.call(`/settings/teams/${team.id}/members/${w.lead.id}`,'PUT',{role:'owner'})).status).toBe(200);
 expect((await w.lead.call(`/settings/teams/${team.id}/members/${member.id}`,'PUT',{role:'member'})).status).toBe(200);
 expect((await member.call(`/issues/${issue.identifier}`)).status).toBe(200);
 expect((await member.api(`/issues/${issue.identifier}`)).status).toBe(200);
 expect(await(await member.call(`/issues/${issue.identifier}/files/${file.id}`)).text()).toBe('synthetic-vector-988');
 expect(JSON.stringify(await json(await member.call('/search?q=synthetic-vector-963')))).toContain(issue.identifier);
 expect(JSON.stringify(await json(await member.call('/current')))).toContain(issue.identifier);
 const insights=await json(await member.call('/insights'+query));expect(insights.total).toBe(1);
 const bucket=insights.rows[0].key;
 expect(await(await member.call('/insights.csv'+query+'&bucket='+encodeURIComponent(bucket))).text()).toContain(issue.identifier);
 await door.visible(uri,issue.identifier);
 const writtenUris=await door.write(team.id);
 // Capability feeds never carry private-team items, even for their permitted creator.
 const feed=await json(await member.call('/calendar/feeds','POST',{teamId:null}),201);
 expect(await(await request(new URL(feed.url).pathname)).text()).not.toContain(issue.identifier);
 expect(JSON.stringify(await json(await member.call('/calendar/events?month=2026-11')))).toContain(issue.identifier);
 const mine=await json(await member.call('/issues','POST',{teamId:team.id,title:'synthetic-vector-971'}),201);
 expect((await member.call(`/issues/${issue.identifier}/subscription`,'PATCH',{following:true})).status).toBe(200);
 expect((await member.call(`/issues/${issue.identifier}/comments`,'POST',{body:'synthetic-vector-972'})).status).toBe(201);
 for(const path of ['/issues?scope=created','/issues?scope=subscribed','/my-work/activity'])expect(JSON.stringify(await json(await member.call(path)))).toContain(path.includes('created')?mine.identifier:issue.identifier);
 expect((await owner.call(`/settings/teams/${team.id}/members/${member.id}`,'DELETE')).status).toBe(200);
 await door.hidden(uri,issue.title);
 for(const writtenUri of writtenUris)await door.hidden(writtenUri,'synthetic-vector-330');
 for(const path of ['/issues?scope=created','/issues?scope=subscribed','/my-work/activity']){const body=JSON.stringify(await json(await member.call(path)));expect(body).not.toContain(issue.identifier);expect(body).not.toContain(mine.identifier);}
 await hidden();
 // Existing definitions immediately re-evaluate when privacy changes, without data edits.
 expect((await set(false,admin)).status).toBe(200);
 const publicPage=await json(await member.call('/issues'));
 expect((await member.call(`/views/${view.id}`)).status).toBe(200);
 expect(JSON.stringify(await json(await member.call('/views')))).toContain(view.id);
 const viewStored=await env.DB.prepare('SELECT * FROM saved_views WHERE id=?').bind(view.id).first();
 expect((await member.call(`/issues/${issue.identifier}`)).status).toBe(200);
 expect((await admin.api(`/teams/${team.id}/privacy`,'PUT',{isPrivate:true})).status).toBe(200);
 expect((await member.call('/issues?offset=1&revision='+encodeURIComponent(publicPage.revision))).status).toBe(409);
 expect((await member.call(`/views/${view.id}`)).status).toBe(404);
 expect(JSON.stringify(await json(await member.call('/views')))).not.toContain(view.id);
 expect(await env.DB.prepare('SELECT * FROM saved_views WHERE id=?').bind(view.id).first()).toEqual(viewStored);
 expect((await set(true)).status).toBe(200); // idempotent: no duplicate audit.
 expect(await env.DB.prepare("SELECT count(*) n FROM audit_records WHERE action='team.privacy_changed' AND subject_id=?").bind(team.id).first('n')).toBe(2);
 expect((await admin.call(`/settings/teams/${team.id}/members/${member.id}`,'PUT',{role:'member'})).status).toBe(200);
 expect((await member.call(`/issues/${issue.identifier}`)).status).toBe(200);
 expect((await owner.call(`/settings/teams/${team.id}/members/${member.id}`,'DELETE')).status).toBe(200);
 expect((await w.lead.call(`/settings/teams/${team.id}/membership`,'PUT',{mode:'invite_only',requestsEnabled:true})).status).toBe(200);
 expect((await member.call(`/teams/${team.id}/requests`,'POST',{})).status).toBe(200);
 const pending=await env.DB.prepare("SELECT count(*) n FROM audit_records WHERE action='team.membership_requested' AND subject_id=?").bind(team.id).first('n');
 expect((await member.call(`/teams/${team.id}/requests`,'POST',{})).status).toBe(200);
 expect(await env.DB.prepare("SELECT count(*) n FROM audit_records WHERE action='team.membership_requested' AND subject_id=?").bind(team.id).first('n')).toBe(pending);
 expect((await member.call(`/issues/${issue.identifier}`)).status).toBe(404);
 expect(JSON.stringify(await json(await member.call('/search?q=synthetic-vector-963')))).not.toContain(issue.identifier);
 expect(await env.DB.prepare('SELECT role FROM team_members WHERE team_id=? AND operator_id=?').bind(team.id,member.id).first('role')).toBeNull();
 expect((await w.lead.call(`/settings/teams/${team.id}/requests/${member.id}/decision`,'POST',{decision:'approved'})).status).toBe(200);
 expect((await member.call(`/issues/${issue.identifier}`)).status).toBe(200);
 const deliveryTeam=(await json(await owner.call('/settings/teams','POST',{name:'synthetic-vector-985',identifierPrefix:'SYNMAIL'}))).teams.find((t:any)=>t.name==='synthetic-vector-985');
 const recipient=await w.fresh('member',false);
 const queued=await json(await owner.call('/issues','POST',{title:'synthetic-vector-986',teamId:deliveryTeam.id}),201);
 let changed=false;
 const db=afterNativeStatement(async sql=>{if(!changed&&sql.includes('INSERT INTO notification_delivery_attempts')){changed=true;expect((await owner.call(`/settings/teams/${deliveryTeam.id}/privacy`,'PUT',{isPrivate:true})).status).toBe(200);}});
 const sent=await request('/api/issues/'+queued.identifier,'PATCH',{expectedVersion:queued.version,assigneeOperatorId:recipient.id},owner.cookie,{DB:db});expect(sent.status).toBe(200);expect(changed).toBe(true);
 expect(await env.DB.prepare('SELECT status FROM notification_deliveries WHERE identifier=? AND recipient_id=?').bind(queued.identifier,recipient.id).first('status')).toBe('suppressed');
}
