import type {Hono,Context} from 'hono';
import type {AppEnvironment} from '../../../app/bindings';
import {requireIssueAccess,IssueAccessError} from '../../issues/access';
import {isMutationAccessError} from '../../auth/mutation-database';
import {githubBranchName} from './branch-name';
import {githubIssueProjection} from '../github-read';
/** Read and mutation receipts share one full issue representation. Run inside
 * native admission, or around the versioned router with its token-bound DB. */
export function addGithubIssueProjection(app:Hono<AppEnvironment>,versioned=false){
 app.use('*',async(c:Context<AppEnvironment>,next)=>{
  const pattern=versioned?/^\/api\/v1\/issues(?:\/|$)/:/^\/api\/issues(?:\/|$)/;
  if(!pattern.test(c.req.path))return next();
  await next();
  if(c.res.status<200||c.res.status>=300||!c.res.headers.get('Content-Type')?.includes('application/json'))return;
  const payload:unknown=await c.res.clone().json(),actor=c.get('operatorId');let changed=false;
  const enrich=async(value:unknown):Promise<unknown>=>{
   if(!value||typeof value!=='object'||Array.isArray(value))return value;
   const issue=value as Record<string,unknown>;
   if(typeof issue.id!=='string'||typeof issue.identifier!=='string'||typeof issue.title!=='string'||!Array.isArray(issue.activity))return value;
   const fields=await githubIssueFields(c.env.DB,actor,issue.identifier,issue.title);changed=true;
   return {...issue,...fields};
  };
  try{
   let result=await enrich(payload);
   if(result===payload&&payload&&typeof payload==='object'&&!Array.isArray(payload)){
    const object=payload as Record<string,unknown>,copy={...object};
    if(object.issue)copy.issue=await enrich(object.issue);
    if(Array.isArray(object.issues))copy.issues=await Promise.all(object.issues.map(enrich));
    result=copy;
   }
   if(changed){const headers=new Headers(c.res.headers);headers.delete('Content-Length');await c.res.body?.cancel();c.res=new Response(JSON.stringify(result),{status:c.res.status,headers});}
  }catch(error){
   if(isMutationAccessError(error)){await c.res.body?.cancel();c.res=c.json({error:'invalid_token_or_session'},401);return;}
   if(error instanceof IssueAccessError){await c.res.body?.cancel();c.res=c.json({error:error.code},error.status);return;}
   throw error;
  }
 });
}

/** Native and agent issue reads derive the same fields behind current access. */
export async function githubIssueFields(db:D1Database,actor:string,identifier:string,title:string){
 const admitted=await requireIssueAccess(db,identifier,actor);
 const github=await githubIssueProjection(db,admitted.id);
 await requireIssueAccess(db,identifier,actor);
 return {branchName:githubBranchName(identifier,title),deployments:github.deployments};
}
