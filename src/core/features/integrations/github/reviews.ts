import {z} from 'zod';
import {IntegrationError} from '../errors';
import {gitSha} from './push';
import {githubDelivery,type GithubDelivery} from './delivery';
import {reviewHead,type PrHead} from './review-head';
import {gitGuard} from './rules';
const payload=z.object({
 action:z.enum(['submitted','dismissed']),
 repository:z.object({full_name:z.string().min(1).max(200)}),
 pull_request:z.object({number:z.number().int().positive().safe(),head:z.object({sha:gitSha}),updated_at:z.string().datetime({offset:true})}),
 review:z.object({id:z.number().int().positive().safe(),user:z.object({id:z.number().int().positive().safe(),login:z.string().min(1).max(100)}),commit_id:gitSha,
  state:z.enum(['approved','changes_requested','commented','dismissed']),submitted_at:z.string().datetime({offset:true})}),
});
type Review={reviewer_id:number;reviewer_login:string;commit_sha:string;head_version:number;state:string;submitted_at:string};
export async function receiveReview(raw:unknown,context:GithubDelivery){
 const parsed=payload.safeParse(raw);if(!parsed.success)throw new IntegrationError(400,'invalid_github_review');
 const input=parsed.data,{review,pull_request:pr}=input,{db,id,repository}=context;
 if(input.repository.full_name.toLowerCase()!==repository)throw new IntegrationError(400,'github_repository_mismatch');
 if((input.action==='dismissed')!==(review.state==='dismissed'))throw new IntegrationError(400,'invalid_github_review_state');
 return githubDelivery(context,async()=>{
  const current=await db.prepare('SELECT head_sha,head_version,head_changed_at,head_conflicted,head_observed_at,updated_at FROM vector_github_pull_requests WHERE repository_id=? AND number=? AND EXISTS(SELECT 1 FROM vector_github_issue_links l WHERE l.repository_id=? AND l.number=?)').bind(id,pr.number,id,pr.number).first<PrHead>();
  if(!current)return {statements:[],linked:0,diagnostic:'review_pr_not_linked'};
  const previous=await db.prepare('SELECT reviewer_id,reviewer_login,commit_sha,head_version,state,submitted_at FROM github_reviews WHERE repository_id=? AND number=? AND review_id=?').bind(id,pr.number,review.id).first<Review>();
  const submitted=new Date(review.submitted_at).toISOString(),at=new Date().toISOString();
  if(previous&&(previous.reviewer_id!==review.user.id||previous.commit_sha!==review.commit_id||previous.submitted_at!==submitted))throw new IntegrationError(409,'github_review_identity_conflict');
  // Dismissal is terminal for this review identity, regardless of arrival order.
  const conflict=previous&&previous.state!==review.state&&input.action!=='dismissed'&&previous.state!=='dismissed';
  const state=previous?.state==='dismissed'||input.action==='dismissed'?'dismissed':conflict?'conflicted':review.state;
  const observedAt=new Date(pr.updated_at).toISOString(),observed=reviewHead(db,id,pr.number,observedAt,pr.head.sha,current);
  const matching=!observed.conflicted&&observed.head===pr.head.sha&&review.commit_id===pr.head.sha&&observedAt>=observed.previousAt&&submitted>=(observed.changedAt??current.updated_at);
  const fence=gitGuard(db,'EXISTS(SELECT 1 FROM vector_github_pull_requests WHERE repository_id=? AND number=? AND head_version=? AND head_conflicted=? AND updated_at=? AND head_observed_at IS ?)',id,pr.number,current.head_version,current.head_conflicted,current.updated_at,current.head_observed_at);
  if(!previous&&!matching&&input.action!=='dismissed')return {statements:[fence,...observed.statements],linked:0,diagnostic:'review_head_unproven'};
  const statements=[fence,
   previous?gitGuard(db,'EXISTS(SELECT 1 FROM github_reviews WHERE repository_id=? AND number=? AND review_id=? AND state=? AND head_version=?)',id,pr.number,review.id,previous.state,previous.head_version):gitGuard(db,'NOT EXISTS(SELECT 1 FROM github_reviews WHERE repository_id=? AND number=? AND review_id=?)',id,pr.number,review.id),
   ...observed.statements,
   db.prepare(`INSERT INTO github_reviews(repository_id,number,review_id,reviewer_id,reviewer_login,commit_sha,head_version,state,submitted_at,received_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(repository_id,number,review_id) DO UPDATE SET state=excluded.state`).bind(id,pr.number,review.id,review.user.id,review.user.login,review.commit_id,previous?.head_version??(matching?observed.version:-1),state,submitted,at)];
  return {statements,linked:1,diagnostic:state==='conflicted'?'review_state_conflict':'review_recorded'};
 });
}
