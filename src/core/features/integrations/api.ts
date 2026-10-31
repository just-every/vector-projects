import {addIssueTemplateRoutes} from '../issue-templates/routes';
import {createIssueFromRequest} from '../issue-templates/application';
import {createTeam} from "../administration/teams";
import {setTeamPrivacy} from '../team-membership/privacy';
import {teamPrivacySchema} from '../administration/schema';
import {teamCreateSchema} from "../administration/schema";
import { createLabel } from "../administration/labels";
import { labelCreateSchema } from "../administration/schema";
import { apiSchema,apiRoute } from './api-schema';
import { addCommentApi } from './comment-api';
import { addMilestoneApi } from './milestone-api';
import { addCycleApi } from './cycle-api';
import { addLabelApi } from './label-api';
import { pageQuery,pageScope,decodeCursor,nextCursor } from './api-pagination';
import { CommentPermissionError } from '../discussion/permissions';
import { admitRate } from '../auth/repository';
import { addIssueCopyRoutes } from "../issue-copy/routes";
import { addProjectApi } from "./project-api";
import { SettingsError } from "../administration/transaction";
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnvironment } from '../../app/bindings';
import { readRequestJson,RequestBodyError } from '../../app/input';
import { configureNotifications,needsNotificationDrain,notificationEventIds,directMessageEventIds } from '../notifications/context';
import { deliverCommittedDirectMessages } from './outbound';
import { drainNotificationMail } from '../notifications/mail';
import { mutationDatabase,isMutationAccessError,fileSettlementDatabase,AuthorityChangedError, VisibilityChangedError } from '../auth/mutation-database';
import { visibilityDatabase } from '../roles/visibility-database';
import { doorAuthority } from '../roles/enforcement';
import { IssueAccessError,requireIssueAccess } from '../issues/access';
import { IssueMutationError } from '../issues/errors';
import { getIssueDetail } from '../issues/service';
import { issueListQuerySchema } from '../issues/list-schema';
import { issueListResponse,listIssues } from '../issues/list';
import { PaginationInvalidated } from '../issues/list-revision';
import { updateIssueSchema } from '../issue-edit/routes';
import { updateIssueRecord } from '../issue-edit/repository';
import { addComment } from '../discussion/repository';
import { CommentVersionError } from '../discussion/revision';
import { addDescriptionHistoryRoutes } from '../description-history/routes';
import { readAdministration } from '../administration/read';
import { IntegrationError } from './errors';
import { authorizeToken,tokenPredicate } from './tokens';
import { admitted } from './authority';
const identifier=z.string().regex(/^[A-Z]{2,10}-[1-9][0-9]*$/);
const comment=z.object({body:z.string().trim().min(1).max(100000)}).strict();
function parse<T>(schema:z.ZodType<T>,input:unknown){const value=schema.safeParse(input);if(!value.success)throw new IntegrationError(400,'invalid_request');return value.data;}
/** Bearers admit only this versioned API, never documents, files or functions. */
export function createIntegrationApi(){
 const app=new Hono<AppEnvironment>();
 app.onError((error,c)=>{
  if(error instanceof CommentVersionError)return c.json({error:error.code,message:error.message},409);
  if(error instanceof VisibilityChangedError)return c.json({error:'not_found',message:error.message},404);
  if(error instanceof AuthorityChangedError)return c.json({error:'authority_changed',message:error.message},409);
  if(error instanceof z.ZodError)return c.json({error:'invalid_request'},400);
  if(error instanceof CommentPermissionError)return c.json({error:error.code,message:error.message},403);
  if(error instanceof SettingsError)return c.json({error:error.code,message:error.message},error.status);
  if(error instanceof IntegrationError)return c.json({error:error.code,message:error.message},error.status);
  if(error instanceof IssueAccessError)return c.json({error:error.code},error.status);
  if(isMutationAccessError(error))return c.json({error:'invalid_token'},401);
  if(error instanceof RequestBodyError)return c.json({error:'invalid_request'},error.status);
  if(error instanceof PaginationInvalidated)return c.json({error:'pagination_invalidated'},409);
  if(error instanceof IssueMutationError)return c.json({error:error.code,message:error.message},error.code==='issue_not_found'?404:error.code==='invalid_transition'?409:400);
  console.error(error);
  return c.json({error:'integration_unavailable'},503);
 });
 app.use('*',async(c,next)=>{
  const path=c.req.path.replace(/^\/api\/v1/,''),method=c.req.method;
  const route=apiRoute(path,method);
  if(!route)return c.json({error:'route_not_found'},404);
  if(path==='/schema')return c.json(apiSchema);
  if(!route.list&&Object.keys(c.req.query()).length)throw new IntegrationError(400,'invalid_query');
  const scopes=route.scopes;
  // Cookie-authenticated browsers may not turn another origin into a bearer
  // write. Server clients omit Origin; if supplied it must be the saved origin.
  if(c.req.header('Origin')&&c.req.header('Origin')!==c.env.APP_ORIGIN)throw new IntegrationError(403,'origin_refused');
  const raw=c.env.DB,actor=await authorizeToken(raw,c.req.raw,scopes,method+':'+path),predicate=tokenPredicate(actor);
  if(!await admitRate(raw,'api-v1:'+actor.workspace+':'+actor.tokenId,300,60000))return c.json({error:'rate_limited'},429,{'Retry-After':String(Math.max(1,Math.ceil((60000-Date.now()%60000)/1000))),'Cache-Control':'no-store'});
  c.set('operatorId',actor.id);c.header('Cache-Control','no-store');
  // ROLE-001: a token acts with its member's current role, never a copied one.
  const authority=await doorAuthority(c,'v1',actor.id,raw);if(authority.denied)return authority.denied;
  c.env={...c.env,DB:mutationDatabase(visibilityDatabase(raw,actor.id),actor.id,undefined,{sql:predicate.sql,values:predicate.params},authority.fence)};
  configureNotifications(c.env.DB,c.env);
  try{await next();}finally{if(await needsNotificationDrain(c.env.DB)){try{await drainNotificationMail({...c.env,DB:fileSettlementDatabase(c.env.DB)},{eventIds:notificationEventIds(c.env.DB)});}catch{console.error('Integration notification delivery interrupted; durable intent retained.');}}
   try{await deliverCommittedDirectMessages({...c.env,DB:fileSettlementDatabase(c.env.DB)},directMessageEventIds(c.env.DB));}catch{console.error('Slack direct message delivery interrupted; durable intent retained for Cron.');}}
  if(!await admitted(raw,predicate)){await c.res.body?.cancel();c.res=c.json({error:'invalid_token'},401,{'Cache-Control':'no-store'});}
 });
 app.put('/teams/:id/privacy',async c=>{
  const input=parse(teamPrivacySchema,await readRequestJson(c.req.raw));
  await setTeamPrivacy(c.env.DB,c.get('operatorId'),c.req.param('id'),input.isPrivate);
  return c.json({id:c.req.param('id'),isPrivate:input.isPrivate});
 });
 app.post('/teams',async c=>{
  const input=teamCreateSchema.omit({createSlackChannel:true}).parse(await readRequestJson(c.req.raw));
  const id=await createTeam(c.env.DB,c.get('operatorId'),input);
  const data=await readAdministration(c.env.DB,c.get('operatorId'));
  return c.json(data.teams.find(team=>team.id===id),201);
 });
 app.post('/labels' ,async c=>{
  const input=labelCreateSchema.parse(await readRequestJson(c.req.raw));
  const id=await createLabel(c.env.DB,c.get('operatorId'),input);
  return c.json({id,...input},201);
 });
 app.get('/metadata' ,async c=>c.json(await readAdministration(c.env.DB,c.get('operatorId'))));
 app.get('/schema',c=>c.json(apiSchema));
 app.get('/issues',async c=>{
  const query=c.req.query(),{limit,cursor,...nativeQuery}=query;
  const allowed=Object.keys(issueListQuerySchema.shape);
  if(Object.keys(nativeQuery).some(key=>!allowed.includes(key)))throw new IntegrationError(400,'invalid_query');
  if(limit===undefined&&cursor===undefined)return c.json(issueListResponse(await listIssues(c.env.DB,c.get('operatorId'),parse(issueListQuerySchema,nativeQuery))));
  if('offset' in nativeQuery||'revision' in nativeQuery||'pageSize' in nativeQuery)throw new IntegrationError(400,'invalid_query');
  const page=pageQuery.parse({limit,cursor}),filters=parse(issueListQuerySchema,{...nativeQuery,pageSize:100});
  const scope=await pageScope(c.get('operatorId'),'issues',[filters,page.limit]),position=decodeCursor(cursor,scope);
  const value=issueListResponse(await listIssues(c.env.DB,c.get('operatorId'),{...filters,offset:position.offset,revision:position.revision}));
  const issues=value.issues.slice(0,page.limit),offset=position.offset+issues.length;
  return c.json({...value,issues,nextCursor:offset<value.total?nextCursor(offset,value.revision,scope):null});
 });
 app.get('/issues/:identifier',async c=>{const id=parse(identifier,c.req.param('identifier'));await requireIssueAccess(c.env.DB,id,c.get('operatorId'));const value=await getIssueDetail(c.env.DB,id,new Date());await requireIssueAccess(c.env.DB,id,c.get('operatorId'));return c.json(value);});
 app.post('/issues',async c=>c.json(await createIssueFromRequest(c.env.DB,c.get('operatorId'),await readRequestJson(c.req.raw)),201));
 app.patch('/issues/:identifier',async c=>{const id=parse(identifier,c.req.param('identifier')),input=parse(updateIssueSchema,await readRequestJson(c.req.raw));await requireIssueAccess(c.env.DB,id,c.get('operatorId'));const state=await updateIssueRecord(c.env.DB,id,c.get('operatorId'),input),issue=await getIssueDetail(c.env.DB,id,new Date());await requireIssueAccess(c.env.DB,id,c.get('operatorId'));return state==='stale'?c.json({error:'stale_version',version:issue?.version},409):c.json(issue);});
 app.post('/issues/:identifier/comments',async c=>{const id=parse(identifier,c.req.param('identifier')),input=parse(comment,await readRequestJson(c.req.raw)),issue=await requireIssueAccess(c.env.DB,id,c.get('operatorId'));return c.json({id:await addComment(c.env.DB,issue.id,c.get('operatorId'),input.body)},201);});
 addIssueTemplateRoutes(app);
 addIssueCopyRoutes(app,false);
 addProjectApi(app);
 addCommentApi(app);
 addMilestoneApi(app);
 addCycleApi(app);
 addLabelApi(app);
 addDescriptionHistoryRoutes(app,false);
 return app;
}
