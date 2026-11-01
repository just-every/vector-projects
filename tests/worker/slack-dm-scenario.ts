import {env} from 'cloudflare:workers';
import {createExecutionContext,waitOnExecutionContext} from 'cloudflare:test';
import {expect} from 'vitest';
import type {WorkerBindings} from '../../src/core/app/bindings';
import {createServerApp} from '../../src/core/app/server';
import {dispatchWebhooks} from '../../src/core/features/integrations/outbound';
import {drainNotificationDigests} from '../../src/core/features/notifications/digests';
import {scheduled} from '../../src/core/app/scheduled';
import {mutationDatabase} from '../../src/core/features/auth/mutation-database';
import {createIssueRecord} from '../../src/core/features/issues/repository';
import {createIssueInputSchema} from '../../src/core/features/issues/input';
import {mentionToken} from '../../src/core/features/notifications/mention-token';
import {channelEdge} from './channel-edge-fixture';
import type {setupIntegrations} from './integration-fixture';
import {request,invite,actor,bindings} from './base-auth-fixture';
const encoder=new TextEncoder();
async function signature(secret:string,timestamp:string,body:string){
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return 'v0='+[...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode('v0:'+timestamp+':'+body)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
/** SLACK-004 through public doors: Settings linking, delivery at the Slack network edge and the signed action door. */
export async function slackDirectMessages(f:Awaited<ReturnType<typeof setupIntegrations>>,current:WorkerBindings){
 const edge=channelEdge(),team=f.initial.teams[0],app=createServerApp(),secret=[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('');
 const suffix=crypto.randomUUID().slice(0,8),peerEmail='dm-'+suffix+'@vector.test',peerCookie=await invite(peerEmail,f.cookie),peer=await actor(peerCookie);
 const ownerEmail=(await env.DB.prepare('SELECT a.email FROM oa_operators a JOIN vector_auth_operators m ON m.auth_id=a.id WHERE m.operator_id=?').bind(f.owner).first<string>('email'))!;
 const mine=async(cookie:string)=>(await (await request('/api/settings/notifications','GET',undefined,cookie)).json() as any).slack;
 const as=(cookie:string,path:string,method:string,body?:unknown)=>request('/api'+path,method,body,cookie);
 const dms=()=>edge.calls.filter(c=>c.method==='chat.postMessage'&&/^D/.test(String(c.body.channel))&&!c.body.thread_ts);
 const mention=(id:string,name:string)=>mentionToken({id,name});
 const issueState=async(identifier:string)=>env.DB.prepare('SELECT version,assignee_operator_id AS assignee,status_id AS status FROM issues WHERE identifier=?').bind(identifier).first<{version:number;assignee:string|null;status:string}>();
 const slackDoor=async(payload:unknown,options:{secret?:string;timestamp?:number;signed?:boolean;raw?:{body:string;headers:Record<string,string>}}={})=>{
  const body=options.raw?.body??'payload='+encodeURIComponent(JSON.stringify(payload)),timestamp=String(options.timestamp??Math.floor(Date.now()/1000));
  const headers=options.raw?.headers??{'content-type':'application/x-www-form-urlencoded',...(options.signed===false?{}:{'x-slack-request-timestamp':timestamp,'x-slack-signature':await signature(options.secret??secret,timestamp,body)})};
  const execution=createExecutionContext(),response=await app.request(bindings.APP_ORIGIN+'/api/integrations/slack/interactive',{method:'POST',headers,body},bindings,execution);
  await waitOnExecutionContext(execution);return {status:response.status,body,headers};
 };
 const action=(user:string,element:{action_id:string;value?:string;selected_option?:{value:string}})=>({type:'block_actions',user:{id:user},team:{id:'TFIXTURE'},container:{type:'message',message_ts:'1700000000.000100',channel_id:'D'+user.slice(1)},actions:[element]});
 try{
  // Unavailable with its reason while the workspace has no Slack credential.
  expect((await f.call('/settings/integrations/slack','DELETE')).status).toBe(200);edge.renew();
  expect(await mine(peerCookie)).toMatchObject({available:false,link:null,actionsEnabled:false});
  expect((await mine(peerCookie)).reason).toContain('Settings → Connections');
  expect((await as(peerCookie,'/settings/notifications/slack/lookup','POST')).status).toBe(409);
  expect((await f.call('/settings/integrations/slack','POST',{botToken:edge.token})).status).toBe(200);
  expect(await mine(peerCookie)).toMatchObject({available:true,link:null,actionsEnabled:false,email:peerEmail});
  // No match: the message, nothing stored. A lookup error is shown once, never retried.
  expect(await (await as(peerCookie,'/settings/notifications/slack/lookup','POST')).json()).toEqual({match:null,message:'No Slack account found for this email'});
  edge.lookupError('missing_scope');const failed=await as(peerCookie,'/settings/notifications/slack/lookup','POST');expect(failed.status).toBe(400);expect((await failed.json() as any).message).toContain('missing_scope');edge.lookupError(null);
  const lookups=edge.calls.filter(c=>c.method==='users.lookupByEmail');expect(lookups.map(c=>c.body.email)).toEqual([peerEmail,peerEmail]);
  expect((await env.DB.prepare('SELECT count(*) AS n FROM vector_slack_member_links').first<number>('n'))).toBe(0);
  // Own email, shown, then confirmed. Only the account Slack returns for that email can be linked.
  const slackPeer='UPEER'+suffix.toUpperCase();edge.users(peerEmail,slackPeer,'Peer');
  const found=await (await as(peerCookie,'/settings/notifications/slack/lookup','POST')).json() as any;
  expect(found).toEqual({match:{slackUserId:slackPeer,name:'Peer',realName:'Peer Fixture',teamName:'Fixture workspace'},message:null});
  expect((await env.DB.prepare('SELECT count(*) AS n FROM vector_slack_member_links').first<number>('n'))).toBe(0);
  expect((await as(peerCookie,'/settings/notifications/slack/link','POST',{slackUserId:'UOTHER1'})).status).toBe(409);
  expect((await as(peerCookie,'/settings/notifications/slack/link','POST',{slackUserId:slackPeer})).status).toBe(200);
  expect(await mine(peerCookie)).toMatchObject({link:{name:'Peer',teamName:'Fixture workspace',kinds:[]}});
  expect(await env.DB.prepare("SELECT count(*) AS n FROM audit_records WHERE action='slack.member_linked' AND actor_operator_id=?").bind(peer).first<number>('n')).toBe(1);
  expect(await (await as(peerCookie,'/settings/notifications','PATCH',{slackKinds:['mention']})).json()).toMatchObject({slack:{link:{kinds:['mention']}}});
  // One member chooses independently: mentions only in Slack, followed comments in a daily email.
  const choice=await as(peerCookie,'/settings/notifications/channels','PUT',{channels:[
   {kind:'mention',emailMode:'off',slack:true},{kind:'comment',emailMode:'daily',slack:false},
  ]});
  expect(choice.status).toBe(200);
  const chosen=await choice.json() as any;
  expect(chosen.channels).toEqual(expect.arrayContaining([
   {kind:'mention',emailMode:'off',slack:true,inherited:false},{kind:'comment',emailMode:'daily',slack:false,inherited:false},
  ]));
  const ownChannels=await as(peerCookie,'/settings/notifications/channels','GET');expect(ownChannels.status).toBe(200);
  expect((await ownChannels.json() as any).channels).toEqual(chosen.channels);
  expect((await as(peerCookie,'/settings/notifications','PATCH',{emailEnabled:true})).status).toBe(200);
  // The owner (the actor) is linked too and routes mentions to Slack; acting never messages the actor.
  edge.users(ownerEmail,'UOWNER1','Owner');expect((await f.call('/settings/notifications/slack/link','POST',{slackUserId:'UOWNER1'})).status).toBe(200);
  expect((await f.call('/settings/notifications','PATCH',{slackKinds:['assignment','mention']})).status).toBe(200);
  // Without the signing secret a mention routed to Slack produces one DM carrying Open only.
  await f.create({title:'Checkout copy review',description:'Please read '+mention(peer,'Peer')+' and '+mention(f.owner,'Owner')+' PRIVATE_DM_BODY'});
  expect(dms()).toHaveLength(1);expect(dms()[0].body.channel).toBe('D'+slackPeer.slice(1));
  expect(dms()[0].body.blocks.at(-1).elements.map((e:any)=>e.action_id)).toEqual(['vector_open']);
  // Admin enters the generated signing secret beside the bot token; it is sealed and never read back.
  expect((await f.call('/settings/integrations/slack/signing-secret','POST',{signingSecret:secret})).status).toBe(200);
  const channels=await (await f.call('/settings/integrations/channels')).json() as any;expect(channels.slack).toMatchObject({signingSecret:true,interactivityUrl:bindings.APP_ORIGIN+'/api/integrations/slack/interactive'});
  expect(JSON.stringify(channels)+JSON.stringify((await env.DB.prepare('SELECT * FROM vector_integration_secret_keys').all()).results)).not.toContain(secret);
  expect(await mine(peerCookie)).toMatchObject({actionsEnabled:true});
  // A mention routed to Slack: exactly one DM with the three actions and only the allowed fields.
  const issue=await f.create({title:'Ship checkout',description:'Needs '+mention(peer,'Peer')+' PRIVATE_DM_BODY',dueDate:'2026-12-01',statusId:team.statuses.find(s=>s.category==='unstarted')!.id});
  expect((await as(peerCookie,'/issues/'+issue.identifier+'/subscription','PATCH',{following:true})).status).toBe(200);
  await f.call('/issues/'+issue.identifier+'/comments','POST',{body:'PRIVATE_COMMENT_BODY'});
  await dispatchWebhooks(current);await dispatchWebhooks(current);
  expect(dms()).toHaveLength(2);const dm=dms()[1].body,link=bindings.APP_ORIGIN+'/app/issues/'+issue.identifier;
  expect(dm).toMatchObject({channel:'D'+slackPeer.slice(1),unfurl_links:false,unfurl_media:false});expect(dm.text).toContain(issue.identifier+' · Ship checkout');
  const elements=dm.blocks.at(-1).elements;expect(elements.map((e:any)=>e.action_id)).toEqual(['vector_open','vector_assign_me','vector_change_status']);
  expect(elements[0].url).toBe(link);const notes=dm.blocks[1].elements.map((e:any)=>e.text).join('\n');expect(notes).toContain('Owner');expect(notes).toContain('2026-12-01');
  expect(elements[2].initial_option.text.text).toBe(team.statuses.find(s=>s.category==='unstarted')!.name);
  for(const hidden of ['PRIVATE_DM_BODY','PRIVATE_COMMENT_BODY',peerEmail,ownerEmail,edge.token])expect(JSON.stringify(dms())).not.toContain(hidden);
  expect(edge.calls.filter(c=>c.method==='conversations.open').map(c=>c.body.users)).toEqual([slackPeer,slackPeer]);
  // The native daily queue stays quiet until Cron; its one email is never a second Slack message.
  expect(await env.DB.prepare('SELECT count(*) n FROM notification_mail_audit WHERE subject_identifier=?').bind(issue.identifier).first<number>('n')).toBe(0);
  const mail: {personalizations:{to:{email:string}[]}[];content:{value:string}[]}[]=[];
  const mailFetch:typeof fetch=async(input,init)=>{
   expect(new URL(String(input)).origin).toBe('https://api.sendgrid.com');
   expect(init).toMatchObject({method:'POST',redirect:'manual'});mail.push(JSON.parse(String(init?.body)));
   return new Response(null,{status:202});
  };
  expect((await as(peerCookie,'/settings/personal-time','PATCH',{timezone:'UTC',workingHoursStart:'09:00',workingHoursEnd:'17:00',workingDays:[1,2,3,4,5]})).status).toBe(200);
  const digestAt=new Date();digestAt.setUTCDate(digestAt.getUTCDate()+1);digestAt.setUTCHours(9,0,0,0);
  while([0,6].includes(digestAt.getUTCDay()))digestAt.setUTCDate(digestAt.getUTCDate()+1);
  const digestEnv={...current,APP_ORIGIN:'https://vector.test',MAIL_MODE:'production',MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:'synthetic-vector-1002',NOTIFICATION_EMAIL_ENABLED:'true'};
  await drainNotificationDigests(digestEnv,{now:digestAt,dependencies:{fetch:mailFetch}});
  expect(mail).toHaveLength(1);expect(mail[0].personalizations[0].to).toEqual([{email:peerEmail}]);
  const digestText=mail[0].content.map(part=>part.value).join('\n');
  expect(digestText).toContain(issue.identifier+': Ship checkout');expect(digestText).toContain('Owner');
  for(const hidden of ['PRIVATE_DM_BODY','PRIVATE_COMMENT_BODY',peerEmail,ownerEmail,edge.token])expect(digestText).not.toContain(hidden);
  await drainNotificationDigests(digestEnv,{now:digestAt,dependencies:{fetch:mailFetch}});
  await scheduled({scheduledTime:digestAt.getTime()},current);await scheduled({scheduledTime:digestAt.getTime()},current);
  await dispatchWebhooks(current);await dispatchWebhooks(current);
  expect(mail).toHaveLength(1);expect(dms()).toHaveLength(2);
  expect(await env.DB.prepare('SELECT count(*) n FROM notification_mail_audit WHERE subject_identifier=?').bind(issue.identifier).first<number>('n')).toBe(1);
  // Slack's three actions arrive only through the signed door.
  const before=(await issueState(issue.identifier))!,assign={action_id:'vector_assign_me',value:elements[1].value};
  expect((await slackDoor(action(slackPeer,assign),{signed:false})).status).toBe(401);
  expect((await slackDoor(action(slackPeer,assign),{secret:'f'.repeat(32)})).status).toBe(401);
  expect((await slackDoor(action(slackPeer,assign),{timestamp:Math.floor(Date.now()/1000)-301})).status).toBe(401);
  expect((await slackDoor(action('UNOBODY1',assign))).status).toBe(403);
  expect(await issueState(issue.identifier)).toEqual(before);
  const assigned=await slackDoor(action(slackPeer,assign));expect(assigned.status).toBe(200);
  const afterAssign=(await issueState(issue.identifier))!;expect(afterAssign).toMatchObject({assignee:peer,version:before.version+1});
  expect((await slackDoor(undefined,{raw:assigned})).status).toBe(409);expect(await issueState(issue.identifier)).toEqual(afterAssign);
  const refreshed=edge.calls.filter(c=>c.method==='chat.update').at(-1)!.body;expect(refreshed).toMatchObject({channel:'D'+slackPeer.slice(1),ts:'1700000000.000100'});
  expect(refreshed.blocks.at(-1).elements[1].value).toBe(issue.identifier+':'+afterAssign.version);
  // The DM's version is stale now: a visible threaded reply with Open, and nothing is overwritten.
  expect((await slackDoor(action(slackPeer,{action_id:'vector_change_status',selected_option:{value:elements[2].options.find((o:any)=>o.text.text===team.statuses.find(s=>s.category==='started')!.name).value}}))).status).toBe(200);
  const stale=edge.calls.filter(c=>c.method==='chat.postMessage'&&c.body.thread_ts);expect(stale).toHaveLength(1);expect(stale[0].body).toMatchObject({channel:'D'+slackPeer.slice(1),thread_ts:'1700000000.000100'});expect(stale[0].body.blocks.at(-1).elements[0].url).toBe(link);
  expect(await issueState(issue.identifier)).toEqual(afterAssign);
  const started=team.statuses.find(s=>s.category==='started')!,option=refreshed.blocks.at(-1).elements[2].options.find((o:any)=>o.text.text===started.name);
  expect((await slackDoor(action(slackPeer,{action_id:'vector_change_status',selected_option:{value:option.value}}))).status).toBe(200);
  expect(await issueState(issue.identifier)).toMatchObject({status:started.id,assignee:peer,version:afterAssign.version+1});
  // A second click carries a new signature but the same version: refused as stale, applied once.
  expect((await slackDoor(action(slackPeer,{action_id:'vector_change_status',selected_option:{value:option.value}}),{timestamp:Math.floor(Date.now()/1000)-2})).status).toBe(200);
  expect(await issueState(issue.identifier)).toMatchObject({status:started.id,version:afterAssign.version+1});
  // Mutes, the actor's own mention, a turned-off choice, removal and suspension produce no DM.
  const count=dms().length;
  expect((await as(peerCookie,'/settings/notifications/channels','PUT',{channels:[{kind:'mention',inherit:true}]})).status).toBe(200);
  expect((await as(peerCookie,'/settings/notifications','PATCH',{mutedKinds:['mention']})).status).toBe(200);
  await f.create({description:'Muted '+mention(peer,'Peer')});expect(dms()).toHaveLength(count);
  expect((await as(peerCookie,'/settings/notifications','PATCH',{mutedKinds:[],slackKinds:[]})).status).toBe(200);
  await f.create({description:'Turned off '+mention(peer,'Peer')});expect(dms()).toHaveLength(count);
  expect((await as(peerCookie,'/settings/notifications','PATCH',{slackKinds:['mention']})).status).toBe(200);
  await f.create({description:'Self '+mention(f.owner,'Owner')});expect(dms()).toHaveLength(count);
  const queued=async()=>{const db=mutationDatabase(env.DB,f.owner);return createIssueRecord(db,{actorOperatorId:f.owner,now:new Date(),input:createIssueInputSchema.parse({title:'Queued mention',teamId:team.id,description:mention(peer,'Peer')})});};
  await queued();const nativePeer=await env.DB.prepare('SELECT auth_id FROM vector_auth_operators WHERE operator_id=?').bind(peer).first<string>('auth_id');
  await env.DB.prepare("UPDATE oa_operators SET status='inactive' WHERE id=?").bind(nativePeer).run();await dispatchWebhooks(current);expect(dms()).toHaveLength(count);
  await env.DB.prepare("UPDATE oa_operators SET status='active' WHERE id=?").bind(nativePeer).run();
  await queued();expect((await f.call('/settings/operators/'+peer,'DELETE')).status).toBe(200);await dispatchWebhooks(current);expect(dms()).toHaveLength(count);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM vector_slack_member_links WHERE operator_id=?').bind(peer).first<number>('n')).toBe(0);
  expect((await slackDoor(action(slackPeer,{action_id:'vector_assign_me',value:issue.identifier+':'+(afterAssign.version+1)}))).status).toBe(403);
  // Failures are visible to the recipient, and an uncertain send is never repeated.
  const cara=await invite('cara-'+suffix+'@vector.test',f.cookie),caraId=await actor(cara);edge.users('cara-'+suffix+'@vector.test','UCARA1','Cara');
  expect((await as(cara,'/settings/notifications/slack/link','POST',{slackUserId:'UCARA1'})).status).toBe(200);expect((await as(cara,'/settings/notifications','PATCH',{slackKinds:['assignment']})).status).toBe(200);
  edge.postMode('uncertain');const lost=await f.create({title:'Lost acknowledgement',assigneeOperatorId:caraId});const attempted=edge.calls.filter(c=>c.method==='chat.postMessage').length;
  await dispatchWebhooks(current);expect(edge.calls.filter(c=>c.method==='chat.postMessage')).toHaveLength(attempted);edge.postMode('accepted');
  expect((await mine(cara)).deliveries).toMatchObject([{identifier:lost.identifier,state:'uncertain'}]);
  const admin=await (await f.call('/settings/integrations')).json() as any;expect(JSON.stringify(admin)).not.toContain('slack.dm');
  // Removing the workspace credential unlinks everyone, drops the signing secret and stops every DM.
  expect((await f.call('/settings/integrations/slack','DELETE')).status).toBe(200);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM vector_slack_member_links').first<number>('n')).toBe(0);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM vector_integration_secret_keys WHERE identity LIKE 'slack-signing:%'").first<number>('n')).toBe(0);
  const all=edge.calls.length;await f.create({assigneeOperatorId:caraId});await dispatchWebhooks(current);expect(edge.calls.slice(all).filter(c=>c.method==='chat.postMessage')).toHaveLength(0);
  expect((await slackDoor(action('UCARA1',{action_id:'vector_assign_me',value:lost.identifier+':'+lost.version}))).status).toBe(401);
 }finally{edge.restore();}
}
/** A signed Slack action acts with its member's current role and teams: a linked Member later made a Guest
 * of another team changes nothing on an issue they no longer see, and Slack hears only a refusal. */
export async function slackActionsFollowCurrentAccess(f:Awaited<ReturnType<typeof setupIntegrations>>){
 const edge=channelEdge(),app=createServerApp(),secret=[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('');
 const suffix=crypto.randomUUID().slice(0,8),email='moved-'+suffix+'@vector.test',cookie=await invite(email,f.cookie),member=await actor(cookie),slackUser='UMOVED'+suffix.toUpperCase();
 const issueState=async(identifier:string)=>env.DB.prepare('SELECT version,assignee_operator_id AS assignee,status_id AS status FROM issues WHERE identifier=?').bind(identifier).first();
 const click=async(element:{action_id:string;value?:string;selected_option?:{value:string}})=>{
  const body='payload='+encodeURIComponent(JSON.stringify({type:'block_actions',user:{id:slackUser},team:{id:'TFIXTURE'},container:{type:'message',message_ts:'1700000000.000200',channel_id:'D'+slackUser.slice(1)},actions:[element]})),timestamp=String(Math.floor(Date.now()/1000));
  const execution=createExecutionContext(),response=await app.request(bindings.APP_ORIGIN+'/api/integrations/slack/interactive',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-slack-request-timestamp':timestamp,'x-slack-signature':await signature(secret,timestamp,body)},body},bindings,execution);
  await waitOnExecutionContext(execution);return response.status;
 };
 try{
  expect((await f.call('/settings/integrations/slack','POST',{botToken:edge.token})).status).toBe(200);
  expect((await f.call('/settings/integrations/slack/signing-secret','POST',{signingSecret:secret})).status).toBe(200);
  edge.users(email,slackUser,'Moved');
  expect((await request('/api/settings/notifications/slack/link','POST',{slackUserId:slackUser},cookie)).status).toBe(200);
  const team=f.initial.teams[0],issue=await f.create({title:'Hidden roadmap '+suffix}),started=team.statuses.find(s=>s.category==='started')!;
  const invited=(await f.mutate('/settings/teams','POST',{name:'Slack guests '+suffix,identifierPrefix:'SLKGST'})).teams.find(t=>t.name==='Slack guests '+suffix)!;
  expect((await f.call('/settings/operators/'+member+'/role','PATCH',{role:'guest',teamIds:[invited.id]})).status).toBe(200);
  expect((await request('/api/issues/'+issue.identifier,'GET',undefined,cookie)).status).toBe(404);
  // The buttons of a DM sent while they were a Member still produce fresh, validly signed requests.
  const before=await issueState(issue.identifier);
  expect(await click({action_id:'vector_assign_me',value:issue.identifier+':'+issue.version})).toBe(200);
  expect(await click({action_id:'vector_change_status',selected_option:{value:issue.identifier+':'+issue.version+':'+started.id}})).toBe(200);
  expect(await issueState(issue.identifier)).toEqual(before);
  expect(edge.calls.filter(c=>c.method==='chat.update')).toEqual([]);
  expect(edge.calls.filter(c=>c.method==='chat.postMessage'&&c.body.thread_ts==='1700000000.000200')).toHaveLength(2);
  expect(JSON.stringify(edge.calls)).not.toContain('Hidden roadmap');
 }finally{edge.restore();}
}
