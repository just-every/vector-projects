import {githubAliasIssues,aliasReferenceKind,githubAliasGuard} from '../../data/aliases/github';
import { sha256 } from '../../../../../vendor/base/integrations/core/crypto';
import type { WorkerBindings } from '../../../app/bindings';
import { createUlid } from '../../../shared/ids';
import { IntegrationError } from '../errors';
import { openSecret } from '../secrets';
import { rawIntegrationBody } from '../raw-body';
import { recordPushProof,receiveDeployment } from './deployments';
import { receiveReview } from './reviews';
import { prHeadStatements } from './review-head';
import { receivePush } from './push';
import { gitMove } from './rules';
import { githubPayload,githubReferences } from './input';
import { admitted } from '../authority';
const encoder=new TextEncoder();
type Repository={id:string;workspace_id:string;repository:string;enabled:number;revoked_at:string|null};
async function signature(secret:string,header:string|null,body:Uint8Array){
 if(!header||!/^sha256=[a-f0-9]{64}$/.test(header))return false;
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 return crypto.subtle.verify('HMAC',key,new Uint8Array(header.slice(7).match(/../g)!.map(pair=>parseInt(pair,16))),new Uint8Array(body));
}
export async function receiveGithub(env:WorkerBindings,request:Request,id:string){
 if(!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(id))throw new IntegrationError(401,'invalid_github_receiver');
 const repository=await env.DB.prepare('SELECT * FROM vector_github_repositories WHERE id=? AND enabled=1 AND revoked_at IS NULL').bind(id).first<Repository>();
 const key=await env.DB.prepare("SELECT encrypted FROM vector_integration_secret_keys WHERE identity=? AND slot='current'").bind('github:'+id).first<{encrypted:string}>();
 if(!repository||!key)throw new IntegrationError(401,'invalid_github_receiver');
 const authority=`EXISTS(SELECT 1 FROM vector_github_repositories r JOIN vector_integration_secret_keys k ON k.identity='github:'||r.id AND k.slot='current' WHERE r.id=? AND r.workspace_id=? AND r.repository=? AND r.enabled=1 AND r.revoked_at IS NULL AND k.encrypted=?) AND (NOT EXISTS(SELECT 1 FROM vector_restore_status) OR EXISTS(SELECT 1 FROM vector_restore_status WHERE effects_held=0))`;
 const authValues=[id,repository.workspace_id,repository.repository,key.encrypted];
 const requireAuthority=async()=>{if(!await admitted(env.DB,{sql:authority,params:authValues}))throw new IntegrationError(401,'invalid_github_receiver');};
 const bytes=await rawIntegrationBody(request),secret=await openSecret(env,'github:'+id,key.encrypted);
 if(!await signature(secret,request.headers.get('X-Hub-Signature-256'),bytes))throw new IntegrationError(401,'invalid_github_signature');
 const delivery=request.headers.get('X-GitHub-Delivery');if(!['pull_request','pull_request_review','push','deployment_status','ping'].includes(request.headers.get('X-GitHub-Event')??'')||!delivery||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(delivery))throw new IntegrationError(400,'invalid_github_delivery');
 let raw;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new IntegrationError(400,'invalid_github_payload');}
 if(request.headers.get('X-GitHub-Event')==='ping'){
  if(raw?.repository?.full_name?.toLowerCase()!==repository.repository)throw new IntegrationError(400,'github_repository_mismatch');
  await requireAuthority();return {diagnostic:'connected'};
 }
 const context={db:env.DB,id,workspace:repository.workspace_id,repository:repository.repository,delivery,bytes,authority,authValues,requireAuthority};
 if(request.headers.get('X-GitHub-Event')==='pull_request_review')return receiveReview(raw,context);
 if(request.headers.get('X-GitHub-Event')==='push')return receivePush(raw,context,(input,at)=>recordPushProof(context,input,at));
 if(request.headers.get('X-GitHub-Event')==='deployment_status')return receiveDeployment(raw,context);
 const parsed=githubPayload.safeParse(raw);if(!parsed.success)throw new IntegrationError(400,'invalid_github_payload');
 const input=parsed.data,pr=input.pull_request;if(input.repository.full_name.toLowerCase()!==repository.repository||input.number!==pr.number)throw new IntegrationError(400,'github_repository_mismatch');
 let url;try{url=new URL(pr.html_url);}catch{throw new IntegrationError(400,'invalid_pull_request_url');}
 if(url.origin!=='https://github.com'||url.username||url.password||url.search||url.hash||url.pathname.toLowerCase()!=='/'+repository.repository+'/pull/'+pr.number)throw new IntegrationError(400,'invalid_pull_request_url');
 if((['opened','reopened'].includes(input.action)&&pr.state!=='open')||(input.action==='closed'&&pr.state!=='closed')||(pr.merged&&pr.state!=='closed'))throw new IntegrationError(400,'invalid_pull_request_state');
 const hash=await sha256(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));
 const prior=async()=>env.DB.prepare('SELECT payload_hash,diagnostic FROM vector_github_deliveries WHERE repository_id=? AND delivery_id=?').bind(id,delivery).first<{payload_hash:string;diagnostic:string}>();
 await requireAuthority();
 const retained=await prior();if(retained){await requireAuthority();if(retained.payload_hash!==hash)throw new IntegrationError(409,'github_delivery_conflict');return {reused:true,diagnostic:retained.diagnostic};}
 const at=new Date().toISOString(),updatedAt=new Date(pr.updated_at).toISOString(),state=pr.merged?'merged':pr.state;
 const current=await env.DB.prepare('SELECT updated_at,state,title,head_sha,head_version,head_changed_at,head_conflicted,head_observed_at FROM vector_github_pull_requests WHERE repository_id=? AND number=?').bind(id,pr.number).first<{updated_at:string;state:string;title:string;head_sha:string|null;head_version:number;head_changed_at:string|null;head_conflicted:number;head_observed_at:string|null}>();
 const refs=githubReferences(pr.title,pr.body,pr.head?.ref);if(refs.length>20)throw new IntegrationError(413,'github_reference_limit');
 const issues=await githubAliasIssues(env.DB,repository.workspace_id,refs);
 const stale=current&&updatedAt<current.updated_at,ambiguous=current&&updatedAt===current.updated_at&&(state!==current.state||pr.title!==current.title),terminal=current?.state==='merged'&&state!=='merged';
 const diagnostic=stale?'older_pull_request_state':ambiguous?'same_time_state_conflict':terminal?'merged_state_retained':!refs.length?'no_issue_reference':issues.reduce((count,issue)=>count+issue.matchedKeys.length,0)!==refs.length?'unknown_issue_reference':'linked';
 const guard=(sql:string,...params:(string|number|null)[])=>env.DB.prepare(`SELECT CASE WHEN (${sql}) THEN 1 ELSE json('github transaction denied') END`).bind(...params);
 const statements=[guard(authority,...authValues),guard('NOT EXISTS(SELECT 1 FROM vector_github_deliveries WHERE repository_id=? AND delivery_id=?)',id,delivery),
 current?guard('EXISTS(SELECT 1 FROM vector_github_pull_requests WHERE repository_id=? AND number=? AND updated_at=? AND state=? AND title=? AND head_version=? AND head_conflicted=? AND head_observed_at IS ?)',id,pr.number,current.updated_at,current.state,current.title,current.head_version,current.head_conflicted,current.head_observed_at):guard('NOT EXISTS(SELECT 1 FROM vector_github_pull_requests WHERE repository_id=? AND number=?)',id,pr.number)];
 if(!stale&&!ambiguous&&!terminal){
  for(const issue of issues)statements.push(githubAliasGuard(env.DB,repository.workspace_id,issue.matchedKeys,issue.id),guard('EXISTS(SELECT 1 FROM issues i JOIN teams t ON t.id=i.team_id WHERE i.id=? AND i.version=? AND t.workspace_id=?)',issue.id,issue.version,repository.workspace_id));
  statements.push(env.DB.prepare(`INSERT INTO vector_github_pull_requests(repository_id,number,title,url,state,updated_at,received_at,merge_sha) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(repository_id,number) DO UPDATE SET title=excluded.title,url=excluded.url,state=excluded.state,updated_at=excluded.updated_at,received_at=excluded.received_at,merge_sha=COALESCE(excluded.merge_sha,vector_github_pull_requests.merge_sha)`).bind(id,pr.number,pr.title,url.href,state,updatedAt,at,pr.merged?pr.merge_commit_sha?.toLowerCase()??null:null));
  for(const issue of issues){statements.push(env.DB.prepare(`INSERT INTO issue_activity(id,issue_id,actor_operator_id,actor_name,kind,previous_value_json,next_value_json,created_at,updated_at) SELECT ?,?,NULL,?,'github.pr_linked',NULL,?,?,? WHERE NOT EXISTS(SELECT 1 FROM vector_github_issue_links WHERE repository_id=? AND number=? AND issue_id=?)`).bind(createUlid(new Date(at)),issue.id,'GitHub '+repository.repository,JSON.stringify({repository:repository.repository,number:pr.number,state}),at,at,id,pr.number,issue.id),env.DB.prepare('INSERT INTO vector_github_issue_links(repository_id,number,issue_id,created_at,relation) VALUES(?,?,?,?,?) ON CONFLICT(repository_id,number,issue_id) DO UPDATE SET relation=excluded.relation').bind(id,pr.number,issue.id,at,aliasReferenceKind(issue.matchedKeys,pr.title,pr.body)));}
  const trigger=input.action==='opened'&&pr.draft?'draft':input.action==='review_requested'?'review':input.action==='closed'&&pr.merged?'merged':null;
  if(trigger)for(const issue of issues){
   if(trigger==='merged'&&aliasReferenceKind(issue.matchedKeys,pr.title,pr.body)==='contributes')continue;
   statements.push(...await gitMove(env.DB,issue.id,trigger,at));
  }
 }
 if(!stale&&!terminal)statements.push(...prHeadStatements(env.DB,id,pr.number,updatedAt,pr.head?.sha,current));
 statements.push(env.DB.prepare('INSERT INTO vector_github_deliveries(repository_id,delivery_id,payload_hash,received_at,diagnostic) VALUES(?,?,?,?,?)').bind(id,delivery,hash,at,diagnostic),guard(authority,...authValues));
 try{await env.DB.batch(statements);}catch{await requireAuthority();const committed=await prior();if(committed){await requireAuthority();if(committed.payload_hash!==hash)throw new IntegrationError(409,'github_delivery_conflict');return {reused:true,diagnostic:committed.diagnostic};}throw new IntegrationError(503,'github_durability_unavailable');}
 await requireAuthority();
 return {reused:false,diagnostic,linked:stale||ambiguous||terminal?0:issues.length};
}
