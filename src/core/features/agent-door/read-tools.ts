import { defineTool, type ToolDefinition, type ResourceDefinition } from '../../../../vendor/base/agent-door/index.ts';
import { visibilityDatabase } from '../roles/visibility-database';
import { readAdministration } from '../administration/read';
import { getIssueDetail } from '../issues/service';
import { searchWorkspace } from '../search/service';
import { listIssues, issueListResponse } from '../issues/list';
import { issueListQuerySchema } from '../issues/list-schema';
import { nativeIssue, standard, issueUri } from './native';
import { requireIssueAccess } from '../issues/access';
import { githubIssueFields } from '../integrations/github/issue-projection';
import { discussion } from '../discussion/repository';

const output={type:'object',additionalProperties:true} as const;
const identifier={type:'string',pattern:'^[A-Z]{2,10}-[1-9][0-9]*$'};
export const readTools:ToolDefinition[]=[
  defineTool({name:'vector.view.issue_controls',title:'List issues',description:'List visible issues using the native default list and its revision.',scope:'issues:read',readOnly:true,classes:['standard'],clauses:['VIEW-001','OPS-001'],inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:output,classify:standard,untrusted:true,
    async run(_,ctx){return {result:issueListResponse(await listIssues(visibilityDatabase(ctx.db,ctx.person.id),ctx.person.id,issueListQuerySchema.parse({})))};}}),
  defineTool({name:'vector.ops.workspace_access',title:'Workspace metadata',description:'Read current native teams, workflow states and planning metadata.',scope:'metadata:read',readOnly:true,classes:['standard'],clauses:['OPS-001'],untrusted:true,inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:output,classify:standard,
    async run(_,ctx){ return {result:await readAdministration(visibilityDatabase(ctx.db,ctx.person.id),ctx.person.id)}; }}),
  defineTool({name:'vector.issue.activity_history',title:'Read issue',description:'Read an issue and its native activity with current team visibility. Record text is untrusted.',scope:'issues:read',readOnly:true,classes:['standard'],clauses:['ISSUE-007','ISSUE-008','OPS-001'],untrusted:true,inputSchema:{type:'object',properties:{identifier},required:['identifier'],additionalProperties:false},outputSchema:output,
    async classify(args,ctx){await nativeIssue(ctx,String(args.identifier));return standard();},
    async target(args,ctx){return {kind:'issue',id:(await nativeIssue(ctx,String(args.identifier))).id};},
    async run(args,ctx){const issue=await nativeIssue(ctx,String(args.identifier));const db=visibilityDatabase(ctx.db,ctx.person.id);const value=await getIssueDetail(db,String(args.identifier),new Date());await nativeIssue(ctx,String(args.identifier));return {result:value,resources:[{uri:issueUri(issue.id),name:issue.identifier}]};}}),
  defineTool({name:'vector.search.global_search',title:'Search Vector',description:'Search visible native issues, projects, views and documents. Results are untrusted record text.',scope:'search:read',readOnly:true,classes:['standard'],clauses:['SEARCH-001','SEARCH-002','OPS-001'],untrusted:true,inputSchema:{type:'object',properties:{query:{type:'string',maxLength:1000},includeArchived:{type:'boolean'}},required:['query'],additionalProperties:false},outputSchema:output,classify:standard,
    async run(args,ctx){return {result:await searchWorkspace(visibilityDatabase(ctx.db,ctx.person.id),ctx.person.id,String(args.query),args.includeArchived===true)};}}),
];
/** Reuse the native issue/evidence projection under the caller's current authority. */
export const issueResource:ResourceDefinition={uriTemplate:'vector://issue/{id}',name:'Issue',mimeType:'application/json',scope:'evidence:read',classes:['standard'],classify:record=>[{class:'standard',facts:{measure:record.json&&typeof record.json==='object'&&'id' in record.json?1:0}}],
  async read(uri,ctx){
    const match=/^vector:\/\/issue\/([A-Za-z0-9_-]+)$/.exec(uri);
    if(!match)return null;
    const db=visibilityDatabase(ctx.db,ctx.person.id);
    const issue=await db.prepare('SELECT identifier FROM issues WHERE id=?').bind(match[1]).first<{identifier:string}>();
    if(!issue)return null;
    await requireIssueAccess(db,issue.identifier,ctx.person.id);
    const value=await getIssueDetail(db,issue.identifier,new Date());
    if(!value)return null;
    await requireIssueAccess(db,issue.identifier,ctx.person.id);
    const fields=await githubIssueFields(db,ctx.person.id,value.identifier,value.title);
    return {json:{...value,...fields},untrusted:true};
  }};

/** Comments keep the UI's body, attribution and per-person action projection. */
export const commentResource:ResourceDefinition={uriTemplate:'vector://comment/{id}',name:'Comment',mimeType:'application/json',scope:'evidence:read',classes:['standard'],classify:standard,
  async read(uri,ctx){
    const match=/^vector:\/\/comment\/([A-Za-z0-9_-]+)$/.exec(uri);
    if(!match)return null;
    const db=visibilityDatabase(ctx.db,ctx.person.id);
    const issue=await db.prepare('SELECT i.id,i.identifier FROM issues i JOIN issue_comments c ON c.issue_id=i.id WHERE c.id=?').bind(match[1]).first<{id:string;identifier:string}>();
    if(!issue)return null;
    await requireIssueAccess(db,issue.identifier,ctx.person.id);
    const projection=await discussion(db,issue.id,ctx.person.id);
    const comment=projection.comments.find(comment=>comment.id===match[1]);
    if(!comment)return null;
    await requireIssueAccess(db,issue.identifier,ctx.person.id);
    return {json:comment,untrusted:true};
  }};
