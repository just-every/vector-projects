import type {WorkerBindings} from '../../../app/bindings';
import {createUlid} from '../../../shared/ids';
import {admitRate} from '../../auth/repository';
import {IntegrationError} from '../errors';
import {slackCall,slackToken} from '../channels/provider';
import {credentialProblem} from '../channels/settings';
import {signingIdentity} from './signing';
import type {DirectKind,SlackDirectPreferences,SlackLookup} from './schema';
import {channelPreferences} from '../../notifications/channel-preferences';
import {effectiveEmailSql} from '../../notifications/channel-sql';
import {notificationKinds} from '../../notifications/schema';
type Member={id:string;workspace:string;email:string};
type SlackUser={id?:unknown;team_id?:unknown;name?:unknown;real_name?:unknown;deleted?:unknown;is_bot?:unknown;profile?:{display_name?:unknown;real_name?:unknown}};
const text=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim().slice(0,200):null;
/** The lookup always uses the signed-in member's own sign-in email (ct, 20 Oct 19:12Z). */
async function member(env:WorkerBindings,operatorId:string):Promise<Member>{
 const row=await env.DB.prepare("SELECT o.workspace_id AS workspace,a.email FROM operators o JOIN vector_auth_operators m ON m.operator_id=o.id JOIN oa_operators a ON a.id=m.auth_id WHERE o.id=? AND o.removed_at IS NULL AND a.status='active'").bind(operatorId).first<{workspace:string;email:string}>();
 if(!row)throw new IntegrationError(401,'unauthenticated');
 return {id:operatorId,...row};
}
async function installation(env:WorkerBindings,workspace:string){
 const row=await env.DB.prepare('SELECT team_name,enabled FROM vector_slack_installations WHERE workspace_id=?').bind(workspace).first<{team_name:string;enabled:number}>();
 const connected=Boolean(row?.enabled)&&!await credentialProblem(env,'slack:'+workspace);
 return {connected,needsAttention:Boolean(row?.enabled)&&!connected,teamName:row?.team_name??'Slack workspace',actions:connected&&!await credentialProblem(env,signingIdentity(workspace))};
}
async function lookup(env:WorkerBindings,current:Member){
 if(!(await installation(env,current.workspace)).connected)throw new IntegrationError(409,'slack_unavailable','Slack direct messages are unavailable until an Admin connects Slack in Settings → Connections.');
 if(!await admitRate(env.DB,'slack-lookup:'+current.id,10,60_000))throw new IntegrationError(429,'slack_lookup_rate_limited','Too many Slack lookups. Wait a minute, then choose Link Slack again.');
 let user:SlackUser|undefined;
 try{user=(await slackCall(await slackToken(env,current.workspace),'users.lookupByEmail',{email:current.email},'GET') as unknown as {user?:SlackUser}).user;}
 catch(error){
  if(error instanceof IntegrationError&&error.code==='slack_users_not_found')return null;
  if(error instanceof IntegrationError)throw new IntegrationError(error.status===503?503:400,'slack_lookup_failed','Slack lookup failed ('+error.code.replace(/^slack_/,'')+'). Nothing was linked.');
  throw error;
 }
 if(!user||typeof user.id!=='string'||!/^[UW][A-Z0-9]{2,30}$/.test(user.id)||typeof user.team_id!=='string'||!/^[TE][A-Z0-9]{2,30}$/.test(user.team_id)||user.deleted===true||user.is_bot===true)return null;
 return {id:user.id,teamId:user.team_id,name:text(user.profile?.display_name)??text(user.profile?.real_name)??text(user.real_name)??text(user.name)??user.id,realName:text(user.profile?.real_name)??text(user.real_name)};
}
export async function lookupSlack(env:WorkerBindings,operatorId:string):Promise<SlackLookup>{
 const current=await member(env,operatorId),found=await lookup(env,current);
 if(!found)return {match:null,message:'No Slack account found for this email'};
 return {match:{slackUserId:found.id,name:found.name,realName:found.realName,teamName:(await installation(env,current.workspace)).teamName},message:null};
}
/** Confirmation repeats the lookup: only the account Slack returns for this member's email can be linked. */
export async function linkSlack(env:WorkerBindings,operatorId:string,slackUserId:string){
 const current=await member(env,operatorId),found=await lookup(env,current);
 if(!found||found.id!==slackUserId)throw new IntegrationError(409,'slack_link_changed','Slack no longer returns that account for your email. Choose Link Slack again.');
 const taken=await env.DB.prepare('SELECT 1 FROM vector_slack_member_links WHERE workspace_id=? AND slack_team_id=? AND slack_user_id=? AND operator_id<>?').bind(current.workspace,found.teamId,found.id,operatorId).first();
 if(taken)throw new IntegrationError(409,'slack_account_linked','That Slack account is already linked to another Vector member.');
 const at=new Date().toISOString();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO vector_slack_member_links(operator_id,workspace_id,slack_team_id,slack_user_id,slack_name,dm_kinds,linked_at) SELECT ?,?,?,?,?,'[]',? WHERE EXISTS(SELECT 1 FROM vector_slack_installations WHERE workspace_id=? AND enabled=1) ON CONFLICT(operator_id) DO UPDATE SET slack_team_id=excluded.slack_team_id,slack_user_id=excluded.slack_user_id,slack_name=excluded.slack_name,linked_at=excluded.linked_at").bind(operatorId,current.workspace,found.teamId,found.id,found.name,at,current.workspace),
  env.DB.prepare("INSERT INTO audit_records(id,actor_operator_id,action,subject_identifier,subject_id,created_at,updated_at) SELECT ?,?,'slack.member_linked','Slack',?,?,? WHERE EXISTS(SELECT 1 FROM vector_slack_member_links WHERE operator_id=? AND linked_at=?)").bind(createUlid(new Date()),operatorId,operatorId,at,at,operatorId,at),
 ]);
}
export async function unlinkSlack(env:WorkerBindings,operatorId:string){
 const at=new Date().toISOString();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO audit_records(id,actor_operator_id,action,subject_identifier,subject_id,created_at,updated_at) SELECT ?,?,'slack.member_unlinked','Slack',?,?,? WHERE EXISTS(SELECT 1 FROM vector_slack_member_links WHERE operator_id=?)").bind(createUlid(new Date()),operatorId,operatorId,at,at,operatorId),
  env.DB.prepare('DELETE FROM vector_slack_member_links WHERE operator_id=?').bind(operatorId),
 ]);
}
export async function chooseDirectKinds(env:WorkerBindings,operatorId:string,kinds:DirectKind[]){
 const current=await member(env,operatorId);
 if(!(await installation(env,current.workspace)).connected)throw new IntegrationError(409,'slack_unavailable','Slack direct messages are unavailable until an Admin connects Slack in Settings → Connections.');
 const [result]=await env.DB.batch([env.DB.prepare('UPDATE vector_slack_member_links SET dm_kinds=? WHERE operator_id=? AND workspace_id=?').bind(JSON.stringify(kinds),operatorId,current.workspace),
  ...notificationKinds.map(kind=>env.DB.prepare(`INSERT INTO notification_channel_overrides(operator_id,kind,email_mode,slack_enabled)
    SELECT o.id,?,${effectiveEmailSql('?', 'o.id', 'o.workspace_id')},? FROM operators o WHERE o.id=?
    AND EXISTS(SELECT 1 FROM vector_slack_member_links WHERE operator_id=o.id)
    ON CONFLICT(operator_id,kind) DO UPDATE SET slack_enabled=excluded.slack_enabled`).bind(kind,kind,kind,kind,Number(kinds.includes(kind)),operatorId))]);
 if(!result.meta.changes)throw new IntegrationError(409,'slack_link_required','Link your Slack account before choosing Slack direct messages.');
}
function deliveryReason(state:string,outcome:string|null){
 let code='';try{code=String(JSON.parse(outcome??'{}').code??'');}catch{/* fixed text below */}
 if(state==='uncertain')return 'Delivery uncertain. It will not be sent again automatically.';
 if(code==='provider_rate_limited')return 'Slack stayed busy. The limited retries have ended.';
 if(/^slack_[a-z_]{1,80}$/.test(code))return 'Slack refused this direct message ('+code.slice(6)+').';
 return 'Vector could not send this direct message. Check the Slack connection.';
}
export async function directPreferences(env:WorkerBindings,operatorId:string):Promise<SlackDirectPreferences>{
 const current=await member(env,operatorId),slack=await installation(env,current.workspace);
 const link=await env.DB.prepare('SELECT slack_team_id AS slackTeamId,slack_user_id AS slackUserId,slack_name AS name,linked_at AS linkedAt,dm_kinds AS kinds FROM vector_slack_member_links WHERE operator_id=? AND workspace_id=?').bind(operatorId,current.workspace).first<{slackTeamId:string;slackUserId:string;name:string;linkedAt:string;kinds:string}>();
 const deliveries=(await env.DB.prepare(`SELECT d.id,i.identifier,i.title,d.state,d.attempts,(SELECT a.outcome FROM integration_attempts a WHERE a.namespace=d.namespace AND a.delivery_id=d.id ORDER BY a.number DESC LIMIT 1) AS outcome
  FROM notifications n JOIN issues i ON i.id=n.issue_id JOIN teams t ON t.id=i.team_id JOIN integration_deliveries d ON d.namespace=t.workspace_id AND d.id=n.id||':slack-dm'
  WHERE n.recipient_id=? AND t.workspace_id=? AND d.state IN('rejected','uncertain') ORDER BY d.created_at DESC,d.id DESC LIMIT 50`).bind(operatorId,current.workspace).all<{id:string;identifier:string;title:string;state:'rejected'|'uncertain';attempts:number;outcome:string|null}>()).results;
 return {
  available:slack.connected,
  reason:slack.connected?null:slack.needsAttention?'Slack needs attention: an Admin must re-enter the Slack bot token in Settings → Connections.':'Slack is not connected: an Admin connects it in Settings → Connections.',
  actionsEnabled:slack.actions,email:current.email,
  link:link?{slackTeamId:link.slackTeamId,slackUserId:link.slackUserId,name:link.name,teamName:slack.teamName,linkedAt:link.linkedAt,kinds:(await channelPreferences(env.DB,operatorId)).channels.filter(row=>row.slack).map(row=>row.kind)}:null,
  deliveries:deliveries.filter(row=>!String(row.outcome).includes('"slack_dm_suppressed"')).map(({outcome,...row})=>({...row,reason:deliveryReason(row.state,outcome)})),
 };
}
