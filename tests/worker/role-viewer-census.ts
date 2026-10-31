import {jsonMediaType} from '../../src/core/features/oauth-apps/media-types';
import { bucketScheduleInput } from './warehouse-schedule-journey';
import { createSchedule, changeSchedule } from '../../src/core/features/report-exports/schedule-schema';
import {subscriptionInput} from '../../src/core/features/integrations/subscriptions';
import {exchangeInput} from '../../src/core/features/oauth-apps/schema';
import {documentInput,documentEdit,documentComment,specificationInput} from '../../src/core/features/documents/schema';
import {slackIntakeFixture} from './slack-events-scenario';
import {env} from 'cloudflare:workers';
import {expect} from 'vitest';
import * as administrationInput from '../../src/core/features/administration/schema';
import {housekeepingSchema} from '../../src/core/features/housekeeping/schema';
import {rotationInput} from '../../src/core/features/triage-responsibility/schema';
import {channelDefaultsInputSchema} from '../../src/core/features/notifications/channel-schema';
import {initiativeInput,initiativeEdit,initiativeProjects} from '../../src/core/features/initiatives/schema';
import {releaseInput,releaseEdit,releaseScope} from '../../src/core/features/releases/schema';
import {createViewSchema,updateViewSchema,duplicateViewSchema} from '../../src/core/features/views/schema';
import {Buffer} from 'node:buffer';
import {doors,apiDoors,type Door} from '../../src/core/features/roles/doors';
import {createServerApp} from '../../src/core/app/server';
import {createUlid} from '../../src/core/shared/ids';
import {invite,actor,request,bindings,origin} from './base-auth-fixture';
import {resetLimits,type roleWorkspace,type Person} from './role-fixture';
import {channelEdge} from './channel-edge-fixture';
import {seedIntakeForTeam} from './email-intake-fixture';
import {commentChecklistSchema,checklistSchema,descriptionRestoreSchema} from '../../src/core/features/description-history/schema';
import {bulkIssueInputSchema} from '../../src/core/features/bulk-edit/input';
import {bulkTeamInputSchema,bulkDuplicateInputSchema} from '../../src/core/features/bulk-commands/input';
import {dependencyInputSchema} from '../../src/core/features/dependencies/input';
import {moveManualOrderSchema} from '../../src/core/features/manual-order/schema';
import {importInputSchema,importApplySchema} from '../../src/core/features/data/import/input';

type Workspace=Awaited<ReturnType<typeof roleWorkspace>>;
type Surface='native'|'bearer';
export type CensusRequest={path:string;body?:unknown;send?:()=>Promise<Response>};
export const viewerMutations=(registry:Door[])=>registry.filter(door=>(door.method!=='GET'||door.workMutation)&&!(door.page==='account'&&!door.workMutation)&&!(typeof door.row==='string'&&['calendar.feeds','workspace.leave'].includes(door.row)));
const key=(door:Pick<Door,'method'|'path'>)=>door.method+' '+door.path;
const read=async(response:Response)=>{expect(response.ok,await response.clone().text()).toBe(true);return response.json() as Promise<any>;};

/** Every fixture identity comes from a public seed door, except the explicit
 * uncertain delivery ledger and destination-only restore context fixtures. No route may fall back to another resource. */
export async function prepareViewerCensus(w:Workspace,seed:{issue:any;comment:any;project:any;label:any}){
 const owner=w.people.owner,member=w.member,{issue,comment,project,label}=seed;
 const call=async(who:Person,path:string,method='GET',body?:unknown)=>{await resetLimits();return read(await who.call(path,method,body));};
 const detail=(target:any)=>call(owner,'/issues/'+target.identifier);
 const make=(n:number)=>call(owner,'/issues','POST',{title:'synthetic-vector-'+n,teamId:w.team.id});
 const makeTeam=async(n:number,prefix:string)=>{const state=await call(owner,'/settings/teams','POST',{name:'synthetic-vector-'+n,identifierPrefix:prefix});return state.teams.find((team:any)=>team.name==='synthetic-vector-'+n);};
 const destinationTeam=await makeTeam(31001,'SYNCENS');
 const requestTeam=await makeTeam(31002,'SYNREQS');
 const requesterCookie=await invite('synthetic-vector-31003@vector.test',owner.cookie);
 const requesterId=await actor(requesterCookie);
 await call(owner,'/settings/teams/'+requestTeam.id+'/membership','PUT',{mode:'invite_only',requestsEnabled:true});
 await resetLimits();await read(await request('/api/teams/'+requestTeam.id+'/requests','POST',{},requesterCookie));
 const pending=await call(owner,'/intake','POST',{title:'synthetic-vector-31004',teamId:w.team.id});
 const deferred=await call(owner,'/intake','POST',{title:'synthetic-vector-31005',teamId:w.team.id});
 const returnAt=new Date(Date.now()+86400000).toISOString();
 await call(owner,'/issues/'+deferred.identifier+'/defer','POST',{expectedVersion:deferred.version,returnAt});
 const related=await make(31006),newRelated=await make(31007),leaf=await make(31008),canonical=await make(31009);
 let current=await detail(issue);
 await call(owner,'/issues/'+issue.identifier+'/dependencies','POST',{expectedVersion:current.version,relatedIdentifier:related.identifier,relatedVersion:related.version,direction:'related'});
 current=await detail(issue);
 await call(owner,'/issues/'+issue.identifier+'/subissues','POST',{expectedVersion:current.version,title:'synthetic-vector-31010'});
 current=await detail(issue);
 await call(owner,'/issues/'+issue.identifier+'/subissues','POST',{expectedVersion:current.version,title:'synthetic-vector-31011'});
 const namedLink=await call(owner,'/issues/'+issue.identifier+'/links','POST',{name:'synthetic-vector-31012',url:'https://synthetic-vector-31012.example.com/'});
 current=await detail(issue);
 await call(member,'/issues/'+issue.identifier,'PATCH',{expectedVersion:current.version,description:'- [ ] synthetic-vector-2034\n\nsynthetic-vector-31013'});
 const history=await call(owner,'/issues/'+issue.identifier+'/description-history');
 const revision=history.revisions.find((row:any)=>row.description==='- [ ] synthetic-vector-2034');
 expect(revision,'a real earlier description revision').toBeDefined();
 const app=createServerApp();
 await resetLimits();
 const file=await read(await app.request(origin+'/api/issues/'+issue.identifier+'/files',{method:'POST',headers:{cookie:member.cookie,host:new URL(origin).host,Origin:origin,'content-type':'text/plain','x-file-name':'synthetic-vector-31014.txt'},body:'synthetic-vector-31014'},bindings));
 const remindAt=new Date(Date.now()+172800000).toISOString();
 const reminderState=await call(member,'/issues/'+issue.identifier+'/reminders','POST',{remindAt});
 const reminder=reminderState.reminders.find((row:any)=>row.remindAt===remindAt);
 expect(reminder,'the future Viewer own reminder').toBeDefined();
 const workloadPath='/workload?from=2032-01-05&to=2032-01-12';
 let workload=await call(member,workloadPath);
 let capacity=workload.rows.find((row:any)=>row.operatorId===member.id);
 await call(member,workloadPath,'PUT',{capacity:8,expectedVersion:capacity.version});
 workload=await call(member,workloadPath);capacity=workload.rows.find((row:any)=>row.operatorId===member.id);
 const subscription=await call(member,'/subscriptions','POST',{subjectType:'label',subjectId:label.id});
 const personalToken=await call(member,'/settings/integrations/tokens','POST',{name:'synthetic-vector-31015',scopes:['issues:read']});
 const ownView=await call(member,'/views','POST',{name:'synthetic-vector-31016',isShared:true,query:{team:w.team.id}});
 const templateInput={name:'synthetic-vector-31017',teamId:w.team.id,issues:[{title:'synthetic-vector-31018',offsetDays:null,milestonePosition:null}]};
 const template=await call(member,'/project-templates','POST',templateInput);
 const dashboardInput={name:'synthetic-vector-31019',teamId:w.team.id,widgets:[{name:'synthetic-vector-31020',kind:'count',filters:{team:w.team.id},chart:{}}]};
 const dashboard=await call(member,'/dashboards','POST',dashboardInput);
 const document=await call(owner,'/documents','POST',{parentKind:'project',parentId:project.id,title:'synthetic-vector-31100',body:'synthetic-vector-31100'});
 const otherDocument=await call(owner,'/documents','POST',{parentKind:'project',parentId:project.id,title:'synthetic-vector-31101',body:'synthetic-vector-31101'});
 await call(owner,'/issues/'+issue.identifier+'/specification','PUT',{documentId:document.id});
 const initiative=await call(owner,'/initiatives','POST',{name:'synthetic-vector-31021',ownerOperatorId:owner.id});
 const release=await call(owner,'/releases','POST',{name:'synthetic-vector-31022',teamId:w.team.id});
 const otherLabelState=await call(owner,'/settings/labels','POST',{name:'synthetic-vector-31023',color:'#3355aa'});
 const otherLabel=otherLabelState.labels.find((row:any)=>row.name==='synthetic-vector-31023');
 const milestoneState=await call(owner,'/settings/projects/'+project.id+'/milestones','POST',{name:'synthetic-vector-31024'});
 const milestone=milestoneState.milestones.find((row:any)=>row.name==='synthetic-vector-31024');
 const workflowState=await call(owner,'/settings/teams/'+w.team.id+'/statuses','POST',{name:'synthetic-vector-31025',category:'unstarted'});
 const workflow=workflowState.teams.find((team:any)=>team.id===w.team.id).statuses;
 const workflowStatus=workflow.find((row:any)=>row.name==='synthetic-vector-31025');
 const source=await call(owner,'/settings/integrations/sources','POST',{sourceId:'synthetic-vector-31026',name:'synthetic-vector-31026',teamId:w.team.id});
 const errorConnectionInput={provider:'sentry',teamId:w.team.id,regressionRule:'reopen',token:'synthetic-vector-8121',secret:'synthetic-vector-8122'};
 const errorConnection=await call(owner,'/settings/integrations/errors','POST',errorConnectionInput);
 const importedName='synthetic-vector-31027';
 const importInput=importInputSchema.parse({format:'json',source:'synthetic-vector-31028',name:'synthetic-vector-31028.json',base64:Buffer.from(JSON.stringify([{id:'synthetic-vector-31029',title:'synthetic-vector-31029',team:w.team.name,status:w.team.statuses.find(row=>row.category==='backlog')!.name,assignee:importedName,created:'2026-09-01T01:02:03.000Z',updated:'2026-09-02T04:05:06.000Z'}])).toString('base64'),mapping:{sourceId:'id',title:'title',team:'team',status:'status',assignee:'assignee',createdAt:'created',updatedAt:'updated'}});
 const review=await call(owner,'/data/import/preview','POST',importInput);
 expect(review.ready,JSON.stringify(review.errors)).toBe(true);
 const applyBody=importApplySchema.parse({input:{...importInput,effectiveAt:review.effectiveAt},reviewedFingerprint:review.fingerprint,operationKey:'synthetic-vector-31030',acknowledgeOmissions:true});
 const run=await call(owner,'/data/import/apply','POST',applyBody);
 await call(owner,'/data/import/runs/'+run.id+'/resume','POST',{});
 const subject={names:[importedName]};
 const erasure=await call(owner,'/data/erasure/preview','POST',subject);
 const email=await seedIntakeForTeam(w.team.id,owner.cookie);
 const signingPair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']) as CryptoKeyPair;
 const eventKey=Buffer.from(await crypto.subtle.exportKey('spki',signingPair.publicKey)).toString('base64');
 await call(owner,'/settings/teams/'+w.team.id+'/email-intake/event-key','PUT',{key:eventKey});
 await call(member,'/issues/'+issue.identifier+'/reactions','PUT',{targetId:'',emoji:'🎉'});
 current=await detail(issue);
 await resetLimits();
 const undoResponse=await member.call('/issues/bulk','POST',bulkIssueInputSchema.parse({issues:[{identifier:issue.identifier,expectedVersion:current.version}],changes:{priority:'high'}}));
 await read(undoResponse);
 const undoHeader=undoResponse.headers.get('x-vector-undo');expect(undoHeader,'the real native member undo receipt').not.toBeNull();
 const undo=JSON.parse(undoHeader!);
 current=await detail(issue);issue.version=current.version;
 const [relatedNow,newRelatedNow,leafNow,canonicalNow,deferredNow]=await Promise.all([related,newRelated,leaf,canonical,deferred].map(detail));
 const children=await call(owner,'/issues/'+issue.identifier+'/subissues');
 const commentDetail=await read(await owner.api('/comments/'+comment.id));
 const order=await call(member,'/issues/order?teamId='+w.team.id);
 const destination=await call(owner,'/settings/integrations/destinations','POST',{name:'synthetic-vector-31031',url:'https://synthetic-vector-31031.example.com/events'});
 const fixtureRepository='synthetic-vector-31032/synthetic-vector-31033',github=await call(owner,'/settings/integrations/github','POST',{name:'synthetic-vector-31032',repository:fixtureRepository});
 const workspace=await env.DB.prepare('SELECT workspace_id FROM operators WHERE id=?').bind(owner.id).first<string>('workspace_id');
 const deliveryId='synthetic-vector-31034',envelope=JSON.stringify({id:deliveryId,tenant:workspace,destinationId:destination.id,event:'issue.created',protocol:'webhook',body:'{}'});
 const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
 await env.DB.prepare('INSERT INTO integration_deliveries(namespace,id,fingerprint,destination_hash,envelope,state,attempts,created_at,next_at,max_attempts,retry_delays) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(workspace,deliveryId,await digest(envelope),await digest('https://synthetic-vector-31031.example.com/events'),envelope,'uncertain',1,Date.now(),Date.now(),1,'[]').run();
 const edge=channelEdge(slackIntakeFixture.team),channelId='CSYNTHETIC31035',slackUserId='USYNTHETIC31036';
 try{
  await call(owner,'/settings/integrations/slack','POST',{botToken:edge.token});
  await call(owner,'/settings/integrations/channels/allowed','POST',{channelId,channelName:'synthetic-vector-31035'});
  const binding=await call(owner,'/settings/integrations/channels','POST',{scope:'project',objectId:project.id,provider:'slack',channelId,channelName:'synthetic-vector-31035',events:['issue.created']});
  const emailAddress=await env.DB.prepare('SELECT a.email FROM oa_operators a JOIN vector_auth_operators m ON m.auth_id=a.id WHERE m.operator_id=?').bind(member.id).first<string>('email');
  edge.users(emailAddress!,slackUserId,'synthetic-vector-31036');
  await call(member,'/settings/notifications/slack/lookup','POST',{});
  await call(member,'/settings/notifications/slack/link','POST',{slackUserId});
  const appProfile={appId:'synthetic-vector-31076',clientId:'synthetic-vector-31077',clientSecret:'synthetic-vector-31078-'+crypto.randomUUID(),signingSecret:'synthetic-vector-31079-'+crypto.randomUUID()};
  edge.app(appProfile);
  await call(owner,'/settings/operators/'+member.id+'/role','PATCH',{role:'admin'});
  await call(member,'/settings/integrations/slack/app','POST',appProfile);
  const installUrl=new URL((await call(member,'/settings/integrations/slack/app/install','POST')).url);
  await call(owner,'/settings/operators/'+member.id+'/role','PATCH',{role:'member'});
  const oauthPath='/integrations/slack/oauth/callback?state='+encodeURIComponent(installUrl.searchParams.get('state')!)+'&code=synthetic-vector-31080';
  const signingSecret=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
  const plans={native:new Map<string,CensusRequest>(),bearer:new Map<string,CensusRequest>()};
  const bind=(route:string,params:Record<string,string>)=>route.replace(/:([A-Za-z]+)/g,(_,name)=>{expect(params[name],route+' parameter '+name).toBeTruthy();return params[name];});
  const add=(surface:Surface,method:Door['method'],route:string,body:unknown,params:Record<string,string>={},path?:string)=>{const id=method+' '+route;expect(plans[surface].has(id),id+' duplicate fixture').toBe(false);plans[surface].set(id,{path:path??bind(route,params),body});};
  const native=(method:Door['method'],route:string,body:unknown,params:Record<string,string>={},path?:string)=>add('native',method,route,body,params,path);
  const reportExport=await call(owner,'/settings/report-exports','POST',bucketScheduleInput);
  native('POST','/settings/report-exports',bucketScheduleInput);
  native('PATCH','/settings/report-exports/:id',{expectedVersion:1,enabled:true,consent:true},{id:reportExport.id});
  native('DELETE','/settings/report-exports/:id',undefined,{id:reportExport.id});
  const both=(method:Door['method'],nativePath:string,bearerPath:string,body:unknown,params:Record<string,string>={})=>{add('native',method,nativePath,body,params);add('bearer',method,bearerPath,body,params);};
  native('PATCH','/data/aliases/prefixes/:prefix',{active:false},{prefix:importInput.source});
  native('POST','/settings/integrations/slack/app/members',{operatorId:member.id,slackTeamId:slackIntakeFixture.team,slackUserId:slackIntakeFixture.user});native('DELETE','/settings/integrations/slack/app/members/:operatorId',undefined,{operatorId:member.id});native('POST','/settings/integrations/slack/app',appProfile);native('POST','/settings/integrations/slack/app/create',{configurationToken:'synthetic-vector-31081-token'});native('POST','/settings/integrations/slack/app/install',undefined);native('GET','/integrations/slack/oauth/callback',undefined,{},oauthPath);
  const ip={identifier:issue.identifier},cp={...ip,itemId:comment.id},pp={id:project.id},tp={id:w.team.id},teamId={teamId:w.team.id};
  for(const method of ['POST','PATCH','PUT'] as const){
   const path=method==='POST'?'/initiatives':method==='PATCH'?'/initiatives/:id':'/initiatives/:id/projects';
   both(method,path,path,method==='POST'?{name:'synthetic-vector-31037',ownerOperatorId:member.id}:method==='PATCH'?{expectedVersion:initiative.version,description:'synthetic-vector-31038'}:{expectedVersion:initiative.version,projectIds:[project.id]},{id:initiative.id});
   const releasePath=method==='POST'?'/releases':method==='PATCH'?'/releases/:id':'/releases/:id/scope';
   both(method,releasePath,releasePath,method==='POST'?{name:'synthetic-vector-31039',teamId:w.team.id}:method==='PATCH'?{expectedVersion:release.version,description:'synthetic-vector-31040'}:{expectedVersion:release.version,issueIdentifiers:[issue.identifier],projectIds:[project.id]},{id:release.id});
  }
  native('POST','/documents',{parentKind:'project',parentId:project.id,title:'synthetic-vector-31102',body:'synthetic-vector-31102'});
  native('PATCH','/documents/:documentId',{expectedVersion:document.version,body:'synthetic-vector-31103'},{documentId:document.id});
  native('POST','/documents/:documentId/comments',{body:'synthetic-vector-31104'},{documentId:document.id});
  native('PUT','/issues/:identifier/specification',{documentId:otherDocument.id},ip);
  native('DELETE','/issues/:identifier/specification',undefined,ip);
  native('POST','/subscriptions',{subjectType:'label',subjectId:label.id});native('DELETE','/subscriptions/:id',undefined,{id:subscription.id});
  native('POST','/project-templates',templateInput);native('PUT','/project-templates/:id',{...templateInput,expectedVersion:template.version},{id:template.id});native('DELETE','/project-templates/:id',{expectedVersion:template.version},{id:template.id});native('POST','/project-templates/:id/apply',{name:'synthetic-vector-31041',startDate:'2032-01-05',teamId:w.team.id,expectedVersion:template.version},{id:template.id});native('POST','/project-templates/from-project/:id',{name:'synthetic-vector-31042',teamId:w.team.id,referenceDate:'2032-01-05'},pp);
  native('POST','/dashboards',dashboardInput);native('PUT','/dashboards/:id',{...dashboardInput,expectedVersion:dashboard.version},{id:dashboard.id});native('DELETE','/dashboards/:id',{expectedVersion:dashboard.version},{id:dashboard.id});
  native('PUT','/initiatives/:id/channel-binding',{provider:'slack',channelId,events:['initiative.updated'],expectedVersion:null},{id:initiative.id});native('DELETE','/initiatives/:id/channel-binding',{expectedVersion:binding.id},{id:initiative.id});
  native('POST','/settings/integrations/channels/initiative-approvals',{provider:'slack',initiativeId:initiative.id,channelId,audience:'workspace'});native('DELETE','/settings/integrations/channels/initiative-approvals/:id',undefined,{id:binding.id});
  native('POST','/projects/:id/slack-channel',{channelId},pp);native('POST','/settings/integrations/channels/allowed',{channelId,channelName:'synthetic-vector-31035'});native('DELETE','/settings/integrations/channels/allowed/:channelId',undefined,{channelId});
  native('POST','/settings/operators/invite',{email:'synthetic-vector-31043@vector.test',displayName:'synthetic-vector-31043',role:'member'});native('POST','/settings/operators/confirm-identity',undefined);native('PATCH','/settings/operators/:operatorId/role',{role:'member'},{operatorId:w.lead.id});native('DELETE','/settings/operators/:operatorId',undefined,{operatorId:w.lead.id});
  native('PATCH','/settings',{timezone:'UTC'});native('PUT','/settings/notifications/channel-defaults',{channels:[{kind:'status',emailMode:'immediate',slack:false}]});native('POST','/setup/complete',{confirmed:true});native('POST','/data/restore/operators/:id',undefined,{id:w.lead.id});native('POST','/data/restore/review-effects',undefined);
  native('PATCH','/issues/:identifier/subscription',{following:true},ip);native('POST','/issues/:identifier/reminders',{remindAt},ip);native('DELETE','/issues/:identifier/reminders/:id',undefined,{...ip,id:reminder.id});native('PUT','/workload',{capacity:13,expectedVersion:capacity.version},{},workloadPath);
  native('POST','/settings/notifications/slack/lookup',undefined);native('POST','/settings/notifications/slack/link',{slackUserId});
  native('PUT','/settings/teams/creation',{membersMayCreate:false});both('POST','/settings/teams','/teams',{name:'synthetic-vector-31044',identifierPrefix:'SYNNEW'});both('PUT','/settings/teams/:id/privacy','/teams/:id/privacy',{isPrivate:false},tp);
  native('POST','/teams/:teamId/join',undefined,{teamId:destinationTeam.id});native('POST','/teams/:teamId/leave',undefined,teamId);native('PUT','/settings/teams/:id/members/:operatorId',{role:'member'},{...tp,operatorId:w.lead.id});native('DELETE','/settings/teams/:id/members/:operatorId',undefined,{...tp,operatorId:w.lead.id});native('PUT','/settings/teams/:id/membership',{mode:'invite_only',requestsEnabled:true},tp);native('POST','/settings/teams/:id/requests/:requesterId/decision',{decision:'approved'},{id:requestTeam.id,requesterId});native('POST','/teams/:teamId/requests',undefined,{teamId:requestTeam.id});
  native('PUT','/settings/teams/:id/permissions',{settings:'team_owners',planning:'all_members'},tp);native('PATCH','/settings/teams/:id',{name:'synthetic-vector-31045'},tp);
  const housekeeping={closeAfterDays:30,archiveAfterDays:60,exemptBugs:true};native('PUT','/settings/teams/:id/housekeeping',housekeeping,tp);native('POST','/settings/teams/:id/housekeeping/preview',housekeeping,tp);
  native('PUT','/settings/teams/:teamId/email-intake',{...email.settings,enabled:false},teamId);native('PUT','/settings/teams/:teamId/email-intake/event-key',{key:eventKey},teamId);native('PATCH','/teams/:teamId/subissue-rule',{expectedVersion:children.rule.version,enabled:true},teamId);
  native('POST','/settings/teams/:id/statuses',{name:'synthetic-vector-31046',category:'started'},tp);native('PUT','/settings/teams/:id/statuses/order',{statusIds:workflow.map((row:any)=>row.id)},tp);native('PATCH','/settings/teams/:id/statuses/:statusId',{name:'synthetic-vector-31047'},{...tp,statusId:workflowStatus.id});native('DELETE','/settings/teams/:id/statuses/:statusId',{destinationStatusId:w.team.statuses.find(row=>row.category==='unstarted')!.id},{...tp,statusId:workflowStatus.id});
  both('POST','/issues','/issues',{title:'synthetic-vector-31048',teamId:w.team.id,projectId:project.id,labelIds:[label.id]});both('PATCH','/issues/:identifier','/issues/:identifier',{expectedVersion:current.version,title:'synthetic-vector-31049',labelIds:[otherLabel.id]},ip);
  for(const method of ['POST','DELETE'] as const){const target=method==='POST'?newRelatedNow:relatedNow;native(method,'/issues/:identifier/dependencies',dependencyInputSchema.parse({expectedVersion:current.version,relatedIdentifier:target.identifier,relatedVersion:target.version,direction:'related'}),ip);}
  native('POST','/issues/:identifier/links',{name:'synthetic-vector-31050',url:'https://synthetic-vector-31050.example.com/'},ip);native('DELETE','/issues/:identifier/links/:linkId',undefined,{...ip,linkId:namedLink.id});
  native('POST','/issues/:identifier/subissues',{expectedVersion:current.version,title:'synthetic-vector-31051'},ip);native('PATCH','/issues/:identifier/subissues',{expectedVersion:current.version,identifiers:children.children.map((row:any)=>row.identifier).reverse()},ip);native('PATCH','/issues/:identifier/parent',{expectedVersion:leafNow.version,parentIdentifier:issue.identifier},{identifier:leaf.identifier});
  native('POST','/issues/:identifier/duplicate',{expectedVersion:leafNow.version,canonicalIdentifier:canonical.identifier},{identifier:leaf.identifier});both('POST','/issues/:identifier/description-restore','/issues/:identifier/description-restore',descriptionRestoreSchema.parse({expectedVersion:current.version,revisionId:revision.id}),ip);
  const targetStatus=destinationTeam.statuses.find((row:any)=>row.category==='backlog').id;
  native('POST','/issues/:identifier/team',{expectedVersion:leafNow.version,teamId:destinationTeam.id,statusId:targetStatus},{identifier:leaf.identifier});native('POST','/issues/bulk',bulkIssueInputSchema.parse({issues:[{identifier:issue.identifier,expectedVersion:current.version}],changes:{priority:'urgent'}}));native('POST','/issues/bulk/team',bulkTeamInputSchema.parse({issues:[{identifier:leaf.identifier,expectedVersion:leafNow.version,statusId:targetStatus}],teamId:destinationTeam.id}));native('POST','/issues/bulk/duplicate',bulkDuplicateInputSchema.parse({issues:[{identifier:leaf.identifier,expectedVersion:leafNow.version}],canonicalIdentifier:canonicalNow.identifier}));
  native('POST','/issues/order',moveManualOrderSchema.parse({teamId:w.team.id,identifier:issue.identifier,action:'top',expectedVersion:order.version}));native('POST','/issues/undo',{actionId:undo.actionId});
  both('POST','/issues/:identifier/comments','/issues/:identifier/comments',{body:'synthetic-vector-31052'},ip);native('PUT','/issues/:identifier/reactions',{targetId:'',emoji:'👍'},ip);native('DELETE','/issues/:identifier/reactions',{targetId:'',emoji:'🎉'},ip);native('POST','/issues/:identifier/email-replies',{body:'synthetic-vector-31053',requestId:createUlid(new Date())},{identifier:email.identifier});
  native('PATCH','/issues/:identifier/comments/:itemId',{body:'synthetic-vector-31054'},cp);native('DELETE','/issues/:identifier/comments/:itemId',undefined,cp);native('POST','/issues/:identifier/comments/:itemId/resolution',{resolved:true},cp);both('POST','/issues/:identifier/comments/:itemId/checklist','/issues/:identifier/comments/:itemId/checklist',commentChecklistSchema.parse({expectedBody:commentDetail.body,index:0,text:'synthetic-vector-1723',checked:true}),cp);both('POST','/issues/:identifier/checklist','/issues/:identifier/checklist',checklistSchema.parse({expectedVersion:current.version,index:0,text:'synthetic-vector-2034',checked:true}),ip);
  add('bearer','PATCH','/comments/:id',{expectedVersion:commentDetail.version,body:'synthetic-vector-31054'},{id:comment.id});add('bearer','DELETE','/comments/:id',{expectedVersion:commentDetail.version},{id:comment.id});
  native('POST','/issues/:identifier/files',undefined,ip);plans.native.get('POST /issues/:identifier/files')!.send=()=>app.request(origin+'/api/issues/'+issue.identifier+'/files',{method:'POST',headers:{cookie:member.cookie,host:new URL(origin).host,Origin:origin,'content-type':'text/plain','x-file-name':'synthetic-vector-31055.txt'},body:'synthetic-vector-31055'},bindings);
  native('DELETE','/issues/:identifier/files/:itemId',undefined,{...ip,itemId:file.id});both('POST','/issues/:identifier/copy','/issues/:identifier/copy',{expectedVersion:current.version,teamId:w.team.id},ip);native('DELETE','/issues/:identifier',{expectedVersion:current.version,confirmed:true},ip);
  native('PUT','/settings/labels/creation',{membersMayCreate:false});both('POST','/settings/labels','/labels',{name:'synthetic-vector-31056',color:'#3355aa'});native('POST','/settings/labels/:id/merge',{destinationLabelId:otherLabel.id},{id:label.id});native('PATCH','/settings/labels/:id',{name:'synthetic-vector-31057'},{id:label.id});native('DELETE','/settings/labels/:id',undefined,{id:label.id});
  native('POST','/intake',{title:'synthetic-vector-31058',teamId:w.team.id});for(const action of ['accept','defer','decline','return'] as const){const target=action==='return'?deferredNow:pending;const body=action==='defer'?{expectedVersion:target.version,returnAt}:action==='decline'?{expectedVersion:target.version,reason:'synthetic-vector-31059'}:{expectedVersion:target.version};native('POST','/issues/:identifier/'+action,body,{identifier:target.identifier});}
  native('POST','/settings/integrations/errors',errorConnectionInput);native('DELETE','/settings/integrations/errors/:id',undefined,{id:errorConnection.id});native('POST','/settings/integrations/errors/:id/link',{identifier:issue.identifier,recordId:'8121'},{id:errorConnection.id});native('POST','/settings/integrations/errors/:id/resolve',{identifier:issue.identifier,recordId:'8121'},{id:errorConnection.id});
  native('POST','/settings/integrations/sources',{sourceId:'synthetic-vector-31060',name:'synthetic-vector-31060',teamId:w.team.id});native('POST','/settings/integrations/sources/:id/rotate',{overlapHours:1},{id:source.id});native('POST','/settings/integrations/sources/:id/webhook-url',undefined,{id:source.id});native('DELETE','/settings/integrations/sources/:id',undefined,{id:source.id});
  both('POST','/settings/projects','/projects',{name:'synthetic-vector-31061',leadOperatorId:member.id});both('PATCH','/settings/projects/:id','/projects/:id',{name:'synthetic-vector-31062'},pp);both('DELETE','/settings/projects/:id','/projects/:id',undefined,pp);both('POST','/settings/projects/:id/milestones','/projects/:id/milestones',{name:'synthetic-vector-31063'},pp);both('PATCH','/settings/projects/:id/milestones/:milestoneId','/projects/:id/milestones/:milestoneId',{name:'synthetic-vector-31064'},{...pp,milestoneId:milestone.id});both('PUT','/settings/projects/:id/milestones/order','/projects/:id/milestones/order',{milestoneIds:[milestone.id]},pp);both('DELETE','/settings/projects/:id/milestones/:milestoneId','/projects/:id/milestones/:milestoneId',undefined,{...pp,milestoneId:milestone.id});
  both('POST','/settings/cycles','/cycles',{teamId:w.team.id,name:'synthetic-vector-31065',startsLocal:'2032-01-05T09:00',endsLocal:'2032-01-12T09:00',capacity:null});native('PUT','/settings/teams/:id/cycle-schedule',{weeks:2,startWeekday:1,cooldownWeeks:0,upcomingCount:2},tp);
  native('PUT','/settings/teams/:id/triage-rotation',{startsLocal:'2032-01-05T09:00',operatorIds:[owner.id,w.lead.id]},tp);
  native('POST','/views',{name:'synthetic-vector-31066',isShared:true,query:{team:w.team.id}});native('PATCH','/views/:id',{name:'synthetic-vector-31067'},{id:ownView.id});native('DELETE','/views/:id',undefined,{id:ownView.id});native('POST','/views/:id/duplicate',{name:'synthetic-vector-31068'},{id:ownView.id});
  native('POST','/settings/integrations/delivery',{accountId:Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join(''),apiToken:'synthetic-vector-31069-token'});native('POST','/settings/integrations/destinations',{name:'synthetic-vector-31070',url:'https://synthetic-vector-31070.example.com/events'});for(const action of ['test','reenter'])native('POST','/settings/integrations/destinations/:id/'+action,undefined,{id:destination.id});native('DELETE','/settings/integrations/destinations/:id',undefined,{id:destination.id});
  native('PUT','/settings/integrations/destinations/:id/subscriptions',subscriptionInput.parse({events:['comment.created'],teamIds:[w.team.id]}),{id:destination.id});
  const requestRepository='synthetic-vector-31071/synthetic-vector-31072';native('POST','/settings/integrations/github',{name:'synthetic-vector-31071',repository:requestRepository});native('POST','/settings/integrations/github/:id/reenter',undefined,{id:github.id});native('DELETE','/settings/integrations/github/:id',undefined,{id:github.id});native('POST','/settings/integrations/deliveries/:id/resolve',{kind:'accepted',evidenceCode:'synthetic-vector-31073'},{id:deliveryId});native('POST','/settings/integrations/slack',{botToken:edge.token});native('DELETE','/settings/integrations/slack',undefined);native('POST','/settings/integrations/slack/signing-secret',{signingSecret});native('POST','/settings/integrations/channels',{scope:'project',objectId:project.id,provider:'slack',channelId,channelName:'synthetic-vector-31035',events:['issue.created']});native('DELETE','/settings/integrations/channels/:id',undefined,{id:binding.id});
  const oauthApp=await call(owner,'/settings/oauth-apps','POST',{name:'synthetic-vector-4531',redirectUris:['https://synthetic-vector-4531.example.test/callback'],scopes:['issues:read']});
  const oauthRequest={response_type:'code',client_id:oauthApp.id,redirect_uri:'https://synthetic-vector-4531.example.test/callback',scope:'issues:read',state:'synthetic-vector-4532'};
  const oauthConsent=await call(member,'/oauth/consent','POST',{request:oauthRequest,decision:'approve'});
  const oauthGrant=await read(await app.request(origin+'/api/oauth/token',{method:'POST',headers:{'Content-Type':jsonMediaType},body:JSON.stringify({grant_type:'authorization_code',client_id:oauthApp.id,client_secret:oauthApp.secret,code:new URL(oauthConsent.redirect).searchParams.get('code'),redirect_uri:oauthRequest.redirect_uri})},bindings));
  // Keep a fresh Member consent unused until the same person becomes a Viewer.
  // The public token exchange must recheck the consenting person's current role.
  const pendingConsent=await call(member,'/oauth/consent','POST',{request:oauthRequest,decision:'approve'});
  const pendingCode=new URL(pendingConsent.redirect).searchParams.get('code');
  expect(pendingCode).toBeTruthy();
  native('POST','/oauth/token',exchangeInput.parse({grant_type:'authorization_code',client_id:oauthApp.id,client_secret:oauthApp.secret,code:pendingCode,redirect_uri:oauthRequest.redirect_uri}));
  native('POST','/settings/oauth-apps',{name:'synthetic-vector-4533',redirectUris:[oauthRequest.redirect_uri],scopes:['issues:read']});
  native('DELETE','/settings/oauth-apps/grants/:id',undefined,{id:oauthGrant.grant_id});
  native('POST','/oauth/consent',{request:oauthRequest,decision:'approve'});
  native('POST','/settings/integrations/tokens',{name:'synthetic-vector-31074',scopes:['issues:read']});native('DELETE','/settings/integrations/tokens/:id',undefined,{id:personalToken.credential.id});native('ALL','/portability/*',{}, {},'/portability/exports');
  native('POST','/data/import/preview',importInput);native('POST','/data/import/apply',applyBody);native('POST','/data/import/runs/:id/resume',{}, {id:run.id});native('POST','/data/import/runs/:id/rollback',{confirmed:true},{id:run.id});native('POST','/data/erasure/preview',subject);native('POST','/data/erasure',{subject,confirmation:erasure.confirmation});
  // Validate the administration/resource family bodies with the same schemas
  // their handlers use, independently of the role gate's early refusal.
  const schemas:Record<string,{parse(input:unknown):unknown}>={
   'POST /settings/report-exports':createSchedule,
   'PATCH /settings/report-exports/:id':changeSchedule,
   'PUT /settings/teams/creation':administrationInput.teamCreationPermissionSchema,
   'POST /settings/teams':administrationInput.teamCreateSchema,
   'PUT /settings/teams/:id/privacy':administrationInput.teamPrivacySchema,
   'PATCH /settings/teams/:id':administrationInput.teamUpdateSchema,
   'POST /settings/teams/:id/statuses':administrationInput.statusCreateSchema,
   'PUT /settings/teams/:id/statuses/order':administrationInput.statusReorderSchema,
   'PATCH /settings/teams/:id/statuses/:statusId':administrationInput.statusRenameSchema,
   'DELETE /settings/teams/:id/statuses/:statusId':administrationInput.statusRemoveSchema,
   'PUT /settings/labels/creation':administrationInput.labelCreationPermissionSchema,
   'POST /settings/labels':administrationInput.labelCreateSchema,
   'PATCH /settings/labels/:id':administrationInput.labelUpdateSchema,
   'POST /settings/labels/:id/merge':administrationInput.labelMergeSchema,
   'POST /settings/projects':administrationInput.projectCreateSchema,
   'PATCH /settings/projects/:id':administrationInput.projectUpdateSchema,
   'POST /settings/projects/:id/milestones':administrationInput.projectMilestoneCreateSchema,
   'PATCH /settings/projects/:id/milestones/:milestoneId':administrationInput.projectMilestoneUpdateSchema,
   'PUT /settings/projects/:id/milestones/order':administrationInput.projectMilestoneOrderSchema,
   'POST /settings/cycles':administrationInput.cycleCreateSchema,
   'PUT /settings/teams/:id/cycle-schedule':administrationInput.cycleScheduleSchema,
   'PUT /settings/teams/:id/triage-rotation':rotationInput,
   'PUT /settings/teams/:id/housekeeping':housekeepingSchema,
   'POST /settings/teams/:id/housekeeping/preview':housekeepingSchema,
   'PUT /settings/notifications/channel-defaults':channelDefaultsInputSchema,
   'POST /documents':documentInput,'PATCH /documents/:documentId':documentEdit,'POST /documents/:documentId/comments':documentComment,'PUT /issues/:identifier/specification':specificationInput,
   'POST /initiatives':initiativeInput,'PATCH /initiatives/:id':initiativeEdit,'PUT /initiatives/:id/projects':initiativeProjects,
   'POST /releases':releaseInput,'PATCH /releases/:id':releaseEdit,'PUT /releases/:id/scope':releaseScope,
   'POST /views':createViewSchema,'PATCH /views/:id':updateViewSchema,'POST /views/:id/duplicate':duplicateViewSchema,
  };
  for(const [route,schema] of Object.entries(schemas))schema.parse(plans.native.get(route)!.body);
  for(const surface of ['native','bearer'] as const){const expected=viewerMutations(surface==='native'?doors:apiDoors).map(key).sort();expect([...plans[surface].keys()].sort(),surface+' fixture coverage from src/core/features/roles/doors.ts').toEqual(expected);}
  // A completed destination restore is a seed precondition for the two
  // destination-review doors. Exercise their Owner control publicly before
  // comparing the Viewer's request, rather than accepting an unavailable 409.
  const restoreHash=await digest('synthetic-vector-31075');let restoreJob='';
  let restoreActive=false;
  const beforeRequest=async(surface:Surface,door:Door)=>{
   if(surface!=='native'||!door.path.startsWith('/data/restore/'))return;
   restoreJob=createUlid(new Date());
   expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM vector_restore_status').first('n')).toBe(0);
   expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM vector_restore_operator_grants').first('n')).toBe(0);
   await env.DB.batch([
    env.DB.prepare("INSERT INTO rer_portability_jobs(id,kind,actor,phase,completed,metadata) VALUES(?,'import',?,'complete',1,?)").bind(restoreJob,owner.id,JSON.stringify({contentHash:restoreHash})),
    env.DB.prepare('INSERT INTO vector_restore_status(id,import_id,effects_held) VALUES(1,?,1)').bind(restoreJob),
    env.DB.prepare("INSERT INTO vector_restore_operator_grants(auth_id,approved_at) SELECT auth_id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM vector_auth_operators WHERE operator_id IN (?,?)").bind(owner.id,member.id),
   ]);
   restoreActive=true;
   const state=await call(owner,'/data/restore');expect(state).toMatchObject({restored:true,status:{effectsHeld:1,importId:restoreJob,phase:'complete'}});
   expect(state.operators).toContainEqual(expect.objectContaining({id:w.lead.id,approved:0,eligible:1}));
   const prepared=plans.native.get(key(door))!;
   await call(owner,prepared.path,'POST',prepared.body);
   if(door.path.includes('/operators/')){
    expect(await env.DB.prepare('SELECT 1 FROM vector_restore_operator_grants g JOIN vector_auth_operators m ON m.auth_id=g.auth_id WHERE m.operator_id=?').bind(w.lead.id).first()).not.toBeNull();
    await env.DB.prepare('DELETE FROM vector_restore_operator_grants WHERE auth_id IN(SELECT auth_id FROM vector_auth_operators WHERE operator_id=?)').bind(w.lead.id).run();
   }else{
    expect(await env.DB.prepare('SELECT effects_held FROM vector_restore_status WHERE id=1').first('effects_held')).toBe(0);
    await env.DB.prepare('UPDATE vector_restore_status SET effects_held=1,reviewed_at=NULL WHERE id=1').run();
   }
  };
  const afterRequest=async()=>{
   if(!restoreActive)return;
   await env.DB.batch([env.DB.prepare('DELETE FROM vector_restore_status WHERE id=1'),env.DB.prepare('DELETE FROM vector_restore_operator_grants'),env.DB.prepare('DELETE FROM rer_portability_jobs WHERE id=?').bind(restoreJob)]);
   restoreActive=false;
  };
  return {edge,plans,beforeRequest,afterRequest,request(surface:Surface,door:Door){const prepared=plans[surface].get(key(door));expect(prepared,key(door)+' needs a valid fixture').toBeDefined();return prepared!;},afterRoleChange:async()=>{await call(owner,'/settings/teams/'+w.team.id+'/members/'+member.id,'PUT',{role:'member'});},dispose:()=>edge.restore()};
 }catch(error){edge.restore();throw error;}
}
