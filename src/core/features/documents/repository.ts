import {documentMentionStatements} from './mentions';
import {createUlid} from '../../shared/ids';
import {settingsActor} from '../settings/repository';
import {IntegrationError} from '../integrations/errors';
import {gitGuard} from '../integrations/github/rules';
import {documentReferenceStatements} from '../issue-references/documents';
import {extractIssueIdentifiers} from '../issue-references/identifiers.server';
import {readIssueReferences} from '../issue-references/repository';
import type {z} from 'zod';
import type {ParentKind,documentInput,documentEdit} from './schema';

export function parentSql(kind:ParentKind){
 switch(kind){
  case 'project':return 'SELECT p.id,p.name FROM projects p WHERE p.id=? AND p.workspace_id=?';
  case 'issue':return 'SELECT i.id,i.title name,i.identifier FROM issues i JOIN teams t ON t.id=i.team_id WHERE i.id=? AND t.workspace_id=?';
  case 'team':return 'SELECT t.id,t.name FROM teams t WHERE t.id=? AND t.workspace_id=?';
  case 'initiative':return "SELECT n.id,n.name FROM initiatives n WHERE n.id=? AND n.workspace_id=? AND (SELECT role FROM operators WHERE id=?)<>'guest'";
 }
}
async function parent(db:D1Database,actor:string,kind:ParentKind,id:string){
 const access=await settingsActor(db,actor);
 const values=kind==='initiative'?[id,access.workspace_id,actor]:[id,access.workspace_id];
 const row=await db.prepare(parentSql(kind)).bind(...values).first<{id:string;name:string;identifier?:string}>();
 if(!row)throw new IntegrationError(404,'document_parent_not_found');
 const url=kind==='issue'?'/app/issues/'+row.identifier:kind==='project'?'/app/projects/'+id:kind==='initiative'?'/app/initiatives/'+id:'/app/teams/'+id;
 return {...row,kind,url,workspace:access.workspace_id,values};
}
export async function listDocuments(db:D1Database,actor:string,kind?:ParentKind,id?:string){
 const access=await settingsActor(db,actor),subject=kind&&id?await parent(db,actor,kind,id):null;
 const rows=(await db.prepare('SELECT id,title,parent_kind parentKind,parent_id parentId,version,updated_at updatedAt FROM documents WHERE workspace_id=?'+(subject?' AND parent_kind=? AND parent_id=?':'')+' ORDER BY updated_at DESC,id DESC LIMIT 100').bind(access.workspace_id,...(subject?[subject.kind,subject.id]:[])).all()).results;
 const teams=subject&&subject.kind!=='team'?(await db.prepare('SELECT DISTINCT t.id,t.name FROM issues i JOIN teams t ON t.id=i.team_id WHERE '+(subject.kind==='issue'?'i.id=?':subject.kind==='project'?'i.project_id=?':'i.project_id IN (SELECT project_id FROM initiative_projects WHERE initiative_id=?)')+' ORDER BY t.name,t.id').bind(subject.id).all<{id:string;name:string}>()).results:[];
 if(subject)await parent(db,actor,subject.kind,subject.id);
 return {teams,parent:subject?{id:subject.id,kind:subject.kind,name:subject.name,url:subject.url}:null,documents:rows};
}
export async function readDocument(db:D1Database,actor:string,id:string){
 const access=await settingsActor(db,actor);
 const row=await db.prepare(`SELECT d.id,d.title,d.body,d.parent_kind parentKind,d.parent_id parentId,d.version,d.created_at createdAt,d.updated_at updatedAt,o.name authorName,
 (SELECT json_group_array(json_object('id',c.id,'body',c.body,'authorName',a.name,'createdAt',c.created_at)) FROM (SELECT * FROM document_comments WHERE document_id=d.id ORDER BY id DESC LIMIT 11) c JOIN operators a ON a.id=c.author_operator_id) comments
 FROM documents d JOIN operators o ON o.id=d.author_operator_id WHERE d.id=? AND d.workspace_id=?`).bind(id,access.workspace_id).first<{id:string;title:string;body:string;parentKind:ParentKind;parentId:string;version:number;createdAt:string;updatedAt:string;authorName:string;comments:string}>();
 if(!row)throw new IntegrationError(404,'document_not_found');
 const comments=JSON.parse(row.comments) as {id:string;body:string;authorName:string;createdAt:string}[];
 const references=await readIssueReferences(db,actor,extractIssueIdentifiers(row.body));
 // Recheck the source after resolving target metadata, before returning either.
 if(!await db.prepare('SELECT id FROM documents WHERE id=? AND workspace_id=?').bind(id,access.workspace_id).first())throw new IntegrationError(404,'document_not_found');
 return {...row,references,comments:comments.slice(0,10).reverse(),nextBeforeComment:comments.length>10?comments[9].id:null};
}
export async function documentRevisions(db:D1Database,actor:string,id:string,before?:number){
 await readDocument(db,actor,id);
 const rows=(await db.prepare('SELECT r.id,r.version,r.title,r.body,r.created_at createdAt,o.name authorName FROM document_revisions r JOIN operators o ON o.id=r.author_operator_id WHERE r.document_id=? AND (? IS NULL OR r.version<?) ORDER BY r.version DESC LIMIT 5').bind(id,before??null,before??null).all<{id:string;version:number;title:string;body:string;createdAt:string;authorName:string}>()).results;
 await readDocument(db,actor,id);
 return {revisions:rows.reverse(),nextBeforeVersion:rows.length===5&&rows[0].version>1?rows[0].version:null};
}
export async function documentComments(db:D1Database,actor:string,id:string,before?:string){
 await readDocument(db,actor,id);
 const comments=(await db.prepare('SELECT c.id,c.body,o.name authorName,c.created_at createdAt FROM document_comments c JOIN operators o ON o.id=c.author_operator_id WHERE c.document_id=? AND (? IS NULL OR c.id<?) ORDER BY c.id DESC LIMIT 11').bind(id,before??null,before??null).all<{id:string;body:string;authorName:string;createdAt:string}>()).results;
 await readDocument(db,actor,id);
 return {comments:comments.slice(0,10).reverse(),nextBeforeComment:comments.length>10?comments[9].id:null};
}
export async function createDocument(db:D1Database,actor:string,input:z.infer<typeof documentInput>){
 const subject=await parent(db,actor,input.parentKind,input.parentId),now=new Date(),at=now.toISOString(),id=createUlid(now);
 await db.batch([
  gitGuard(db,'EXISTS('+parentSql(subject.kind)+')',...subject.values),
  db.prepare('INSERT INTO documents(id,workspace_id,parent_kind,parent_id,title,body,author_operator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,subject.workspace,subject.kind,subject.id,input.title,input.body,actor,at,at),
  db.prepare('INSERT INTO document_revisions(id,document_id,version,title,body,author_operator_id,created_at) VALUES(?,?,1,?,?,?,?)').bind(createUlid(now),id,input.title,input.body,actor,at),
  ...documentReferenceStatements(db,{documentId:id,actor,version:1,at},input.body),
  ...documentMentionStatements(db,{documentId:id,actor,version:1,at},input.body),
 ]);
 return readDocument(db,actor,id);
}
export async function editDocument(db:D1Database,actor:string,id:string,input:z.infer<typeof documentEdit>){
 const old=await readDocument(db,actor,id);if(old.version!==input.expectedVersion)throw new IntegrationError(409,'stale_document');
 const now=new Date(),at=now.toISOString(),title=input.title??old.title,body=input.body??old.body;
 await db.batch([
  gitGuard(db,'EXISTS(SELECT 1 FROM documents WHERE id=? AND version=?)',id,old.version),
  db.prepare('INSERT INTO document_revisions(id,document_id,version,title,body,author_operator_id,created_at) VALUES(?,?,?,?,?,?,?)').bind(createUlid(now),id,old.version+1,title,body,actor,at),
  db.prepare('UPDATE documents SET title=?,body=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(title,body,at,id,old.version),
  ...documentReferenceStatements(db,{documentId:id,actor,version:old.version+1,at},body),
  ...documentMentionStatements(db,{documentId:id,actor,version:old.version+1,at},body,old.body),
 ]);
 return readDocument(db,actor,id);
}
export async function commentDocument(db:D1Database,actor:string,id:string,body:string){
 await readDocument(db,actor,id);const now=new Date();
 await db.prepare('INSERT INTO document_comments(id,document_id,body,author_operator_id,created_at) SELECT ?,id,?,?,? FROM documents WHERE id=?').bind(createUlid(now),body,actor,now.toISOString(),id).run();
 return readDocument(db,actor,id);
}
export async function issueSpecification(db:D1Database,identifier:string){
 return db.prepare('SELECT d.id,d.title FROM issue_specifications s JOIN issues i ON i.id=s.issue_id JOIN documents d ON d.id=s.document_id WHERE i.identifier=?').bind(identifier).first<{id:string;title:string}>();
}
export async function setSpecification(db:D1Database,actor:string,identifier:string,documentId:string|null){
 const issue=await db.prepare('SELECT id FROM issues WHERE identifier=?').bind(identifier).first<{id:string}>();if(!issue)throw new IntegrationError(404,'issue_not_found');
 if(documentId){await readDocument(db,actor,documentId);await db.prepare('INSERT INTO issue_specifications(issue_id,document_id,author_operator_id,updated_at) SELECT i.id,d.id,?,? FROM issues i JOIN documents d ON d.id=? WHERE i.id=? ON CONFLICT(issue_id) DO UPDATE SET document_id=excluded.document_id,author_operator_id=excluded.author_operator_id,updated_at=excluded.updated_at').bind(actor,new Date().toISOString(),documentId,issue.id).run();}
 else await db.prepare('DELETE FROM issue_specifications WHERE issue_id=?').bind(issue.id).run();
 return {specification:await issueSpecification(db,identifier)};
}
