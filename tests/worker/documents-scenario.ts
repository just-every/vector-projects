import {freshTarget,stageArchive,finalBody,targetCall,targetSignIn,type ArchiveRecords} from './http-archive-fixture';
import {documentReferenceScenario} from './reference-scenario';
import {env} from 'cloudflare:workers';
import {expect} from 'vitest';
import {readArchive} from '@runeditrun/rer/modules/portability';
import {setupAdministration} from './administration-fixture';
import {invite,actor,request} from './base-auth-fixture';
import {snapshot} from './role-fixture';
const read=async(response:Response,status=200)=>{expect(response.status,await response.clone().text()).toBe(status);return response.json() as Promise<any>;};
const tables=['documents','document_revisions','document_comments','issue_specifications','issues','projects','teams'];
export async function documentJourney(){
 const f=await setupAdministration();
 const project=(await f.mutate('/settings/projects','POST',{name:'synthetic-vector-35001',leadOperatorId:f.owner})).projects.find(p=>p.name==='synthetic-vector-35001')!;
 const issue=await f.create({projectId:project.id,title:'synthetic-vector-35002'});
 const doc=await read(await f.call('/documents','POST',{parentKind:'project',parentId:project.id,title:'synthetic-vector-project-spec',body:'synthetic-vector-original-design'}),201);
 await read(await f.call('/issues/'+issue.identifier+'/specification','PUT',{documentId:doc.id}));
 expect((await read(await f.call('/issues/'+issue.identifier))).specification).toEqual({id:doc.id,title:doc.title});
 const first=await read(await f.call('/documents/'+doc.id,'PATCH',{expectedVersion:doc.version,body:'synthetic-vector-first-revision'}));
 const second=await read(await f.call('/documents/'+doc.id,'PATCH',{expectedVersion:first.version,body:'synthetic-vector-second-revision'}));
 expect((await read(await f.call('/documents/'+doc.id+'/revisions'))).revisions.map((r:any)=>[r.version,r.body])).toEqual([[1,doc.body],[2,first.body],[3,second.body]]);
 expect((await read(await f.call('/search?q='+encodeURIComponent(doc.title)))).documents).toContainEqual({id:doc.id,title:doc.title});
 expect((await read(await f.call('/search?q=synthetic-vector-second-revision'))).documents).toContainEqual({id:doc.id,title:doc.title});
 expect((await read(await f.call('/documents?parentKind=project&parentId='+project.id))).documents.map((d:any)=>d.id)).toContain(doc.id);
 const initiative=await read(await f.call('/initiatives','POST',{name:'synthetic-vector-35003',ownerOperatorId:f.owner}),201);
 const initiativeDoc=await read(await f.call('/documents','POST',{parentKind:'initiative',parentId:initiative.id,title:'synthetic-vector-initiative-handbook',body:'synthetic-vector-initiative-body'}),201);
 const team=(await f.mutate('/settings/teams','POST',{name:'synthetic-vector-35004',identifierPrefix:'SYNDOC'})).teams.find(t=>t.name==='synthetic-vector-35004')!;
 const teamDoc=await read(await f.call('/documents','POST',{parentKind:'team',parentId:team.id,title:'synthetic-vector-team-handbook',body:'synthetic-vector-team-body'}),201);
 for(const [kind,id,document] of [['initiative',initiative.id,initiativeDoc],['team',team.id,teamDoc]] as const){
  expect((await read(await f.call('/documents?parentKind='+kind+'&parentId='+id))).documents.map((d:any)=>d.id)).toContain(document.id);
  expect((await read(await f.call('/search?q='+encodeURIComponent(document.title)))).documents).toContainEqual({id:document.id,title:document.title});
 }
 const outsider=await invite('synthetic-vector-35005@vector.test',f.cookie),member=await invite('synthetic-vector-35006@vector.test',f.cookie),memberId=await actor(member);
 await read(await f.call(`/settings/teams/${team.id}/members/${memberId}`,'PUT',{role:'member'}));
 expect((await request('/api/documents/'+teamDoc.id,'GET',undefined,outsider)).status).toBe(200);
 await read(await f.call(`/settings/teams/${team.id}/privacy`,'PUT',{isPrivate:true}));
 expect((await request('/api/documents/'+teamDoc.id,'GET',undefined,outsider)).status).toBe(404);
 expect((await request('/api/documents/'+teamDoc.id+'/revisions','GET',undefined,outsider)).status).toBe(404);
 expect((await request('/api/documents?parentKind=team&parentId='+team.id,'GET',undefined,outsider)).status).toBe(404);
 expect((await read(await request('/api/documents','GET',undefined,outsider))).documents.map((d:any)=>d.id)).not.toContain(teamDoc.id);
 expect((await read(await request('/api/search?q='+encodeURIComponent(teamDoc.title),'GET',undefined,outsider))).documents).not.toContainEqual({id:teamDoc.id,title:teamDoc.title});
 expect(await read(await request('/api/documents/'+teamDoc.id,'GET',undefined,member))).toMatchObject({id:teamDoc.id,body:teamDoc.body});
 expect((await read(await request('/api/documents?parentKind=team&parentId='+team.id,'GET',undefined,member))).documents.map((d:any)=>d.id)).toContain(teamDoc.id);
 expect((await read(await request('/api/search?q='+encodeURIComponent(teamDoc.title),'GET',undefined,member))).documents).toContainEqual({id:teamDoc.id,title:teamDoc.title});
 const issueDoc=await read(await f.call('/documents','POST',{parentKind:'issue',parentId:issue.id,title:'synthetic-vector-issue-runbook',body:'synthetic-vector-issue-runbook-body'}),201);
 await read(await f.call('/documents/'+doc.id+'/comments','POST',{body:'synthetic-vector-exported-comment'}),201);
 await read(await f.call('/issues/'+issue.identifier+'/specification','PUT',{documentId:teamDoc.id}));
 expect((await read(await request('/api/issues/'+issue.identifier,'GET',undefined,outsider))).specification).toBeNull();
 expect((await read(await request('/api/issues/'+issue.identifier+'/specification','GET',undefined,outsider))).specification).toBeNull();
 expect((await read(await request('/api/issues/'+issue.identifier+'/specification','GET',undefined,member))).specification).toEqual({id:teamDoc.id,title:teamDoc.title});
 await read(await f.call('/issues/'+issue.identifier+'/specification','PUT',{documentId:doc.id}));
 const reference=await documentReferenceScenario(f);
 // Persist both live and removed document anchors in the native issue graph.
 const quote=issueDoc.body,start=0;
 const anchored=await read(await f.call('/issues/'+issue.identifier+'/comments','POST',{body:'synthetic-vector-portable-quote',anchor:{documentId:issueDoc.id,quote,start,end:Array.from(quote).length,expectedVersion:issueDoc.version,expectedBody:issueDoc.body}}),201);
 const reply=await read(await f.call('/issues/'+issue.identifier+'/comments','POST',{body:'synthetic-vector-portable-reply',parentId:anchored.id}),201);
 await read(await f.call('/documents/'+issueDoc.id,'PATCH',{expectedVersion:issueDoc.version,body:'synthetic-vector-source-removed'}));
 const portable=await read(await f.call('/documents','POST',{parentKind:'issue',parentId:issue.id,title:'synthetic-vector-live-quote',body:'🧭 café 🧪'}),201);
 const live=await read(await f.call('/issues/'+issue.identifier+'/comments','POST',{body:'synthetic-vector-live-thread',anchor:{documentId:portable.id,quote:'café 🧪',start:2,end:8,expectedVersion:portable.version,expectedBody:portable.body}}),201);
 const beforeThreads=(await read(await f.call('/issues/'+issue.identifier+'/discussion'))).comments;
 expect(beforeThreads.find((c:any)=>c.id===anchored.id).anchor).toEqual({documentId:issueDoc.id,quote,start,end:Array.from(quote).length,removed:true});
 expect(beforeThreads.find((c:any)=>c.id===live.id).anchor).toMatchObject({documentId:portable.id,quote:'café 🧪',removed:false});
 const native=await env.DB.prepare('SELECT '+(await import('../../src/core/features/data/import/native-snapshot')).snapshotExpression+' value FROM issues i WHERE id=?').bind(issue.id).first<string>('value');
 expect(JSON.parse(native!).comments.find((c:any)=>c.id===anchored.id).document_anchor).toContain(issueDoc.id);
 // A native archive retains the document, parent identity, both edits and issue link.
 const exported=await read(await f.call('/portability/exports','POST',{}),201);
 let state={phase:'building'};while(state.phase==='building')state=await read(await f.call('/portability/exports/'+exported.id+'/advance','POST',{maxParts:16}));
 const download=await f.call('/portability/exports/'+exported.id+'/download');expect(download.status).toBe(200);
 const items:any[]=[],records:ArchiveRecords=[];for await(const record of readArchive(download.body!)){records.push(record);if(record.kind==='part')items.push(...record.items);}
 const rows=(table:string)=>items.filter(item=>item.kind==='row'&&item.table===table).map(item=>item.row);
 expect(rows('issue_comments')).toContainEqual(expect.objectContaining({id:anchored.id,document_anchor:JSON.stringify(beforeThreads.find((c:any)=>c.id===anchored.id).anchor)}));
 expect(rows('document_issue_references')).toContainEqual(expect.objectContaining({document_id:reference.doc.id,target_issue_id:reference.target.id,removed:0}));
 expect(rows('documents')).toContainEqual(expect.objectContaining({id:issueDoc.id,parent_kind:'issue',parent_id:issue.id}));
 expect(rows('issues')).toContainEqual(expect.objectContaining({id:issue.id}));
 expect(rows('document_comments')).toContainEqual(expect.objectContaining({document_id:doc.id,body:'synthetic-vector-exported-comment'}));
 expect(rows('projects')).toContainEqual(expect.objectContaining({id:project.id}));
 expect(rows('documents')).toContainEqual(expect.objectContaining({id:doc.id,parent_kind:'project',parent_id:project.id,body:second.body}));
 expect(rows('document_revisions').filter(r=>r.document_id===doc.id).map(r=>r.body).sort()).toEqual([doc.body,first.body,second.body].sort());
 expect(rows('issue_specifications')).toContainEqual(expect.objectContaining({issue_id:issue.id,document_id:doc.id}));
 expect(rows('documents')).toContainEqual(expect.objectContaining({id:teamDoc.id,parent_id:team.id}));
 expect(rows('teams')).toContainEqual(expect.objectContaining({id:team.id}));
 expect(rows('documents')).toContainEqual(expect.objectContaining({id:initiativeDoc.id,parent_id:initiative.id}));
 expect(rows('initiatives')).toContainEqual(expect.objectContaining({id:initiative.id}));
 await read(await f.call('/issues/'+issue.identifier+'/specification','DELETE'));
 expect((await read(await f.call('/issues/'+issue.identifier))).specification).toBeNull();
 const destinationCookie=await freshTarget(),job=await stageArchive(records,destinationCookie);
 await read(await targetCall('/api/portability/imports/'+job+'/finalize','POST',finalBody(records),destinationCookie));
 const historical=await targetSignIn();
 const restored=await read(await targetCall('/api/issues/'+issue.identifier+'/discussion','GET',undefined,historical));
 expect(restored.comments).toEqual(beforeThreads);
 expect(restored.comments.find((c:any)=>c.id===reply.id)).toMatchObject({parentId:anchored.id,body:'synthetic-vector-portable-reply'});
 expect(await read(await targetCall('/api/documents/'+portable.id,'GET',undefined,historical))).toMatchObject({id:portable.id,body:portable.body,parentId:issue.id});
 const restoredDoc=await read(await targetCall('/api/documents/'+issueDoc.id,'GET',undefined,historical));
 await read(await targetCall('/api/documents/'+issueDoc.id,'PATCH',{expectedVersion:restoredDoc.version,body:issueDoc.body},historical));
 expect((await read(await targetCall('/api/issues/'+issue.identifier+'/discussion','GET',undefined,historical))).comments.find((c:any)=>c.id===anchored.id).anchor.removed).toBe(true);
 console.log('PROBE ISSUE-008 native archive: export → pristine HTTP restore → fresh historical sign-in retains live and removed source identities, quotes and replies; restored matching text never resurrects an anchor');
 expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
}
export async function documentRoles(){
 const f=await setupAdministration(),team=f.initial.teams[0];
 const project=(await f.mutate('/settings/projects','POST',{name:'synthetic-vector-35010',leadOperatorId:f.owner})).projects.find(p=>p.name==='synthetic-vector-35010')!;
 const issue=await f.create({projectId:project.id}),initiative=await read(await f.call('/initiatives','POST',{name:'synthetic-vector-35011',ownerOperatorId:f.owner}),201);
 const admin=await invite('synthetic-vector-35012@vector.test',f.cookie,'admin'),member=await invite('synthetic-vector-35013@vector.test',f.cookie),guest=await invite('synthetic-vector-35014@vector.test',f.cookie),viewer=await invite('synthetic-vector-35015@vector.test',f.cookie,'viewer');
 const guestId=await actor(guest);await read(await f.call('/settings/operators/'+guestId+'/role','PATCH',{role:'guest',teamIds:[team.id]}));
 let count=0;let visible:any;
 const create=async(cookie:string,kind:string,id:string)=>read(await request('/api/documents','POST',{parentKind:kind,parentId:id,title:'synthetic-vector-role-document-'+(++count),body:'synthetic-vector-role-original'},cookie),201);
 for(const cookie of [f.cookie,admin,member])for(const [kind,id] of [['project',project.id],['issue',issue.id],['initiative',initiative.id],['team',team.id]]){
  const doc=await create(cookie,kind,id),edited=await read(await request('/api/documents/'+doc.id,'PATCH',{expectedVersion:doc.version,body:'synthetic-vector-role-edited'},cookie));
  const commented=await read(await request('/api/documents/'+doc.id+'/comments','POST',{body:'synthetic-vector-role-comment'},cookie),201);
  expect(edited.body).toBe('synthetic-vector-role-edited');expect(commented.comments.map((c:any)=>c.body)).toContain('synthetic-vector-role-comment');visible=doc;
 }
 for(const [kind,id] of [['project',project.id],['issue',issue.id]]){const doc=await create(guest,kind,id);await read(await request('/api/documents/'+doc.id,'PATCH',{expectedVersion:doc.version,body:'synthetic-vector-guest-edited'},guest));expect((await read(await request('/api/documents/'+doc.id+'/comments','POST',{body:'synthetic-vector-guest-comment'},guest),201)).comments.map((c:any)=>c.body)).toContain('synthetic-vector-guest-comment');}
 const outside=(await f.mutate('/settings/teams','POST',{name:'synthetic-vector-35016',identifierPrefix:'SYNDOUT'})).teams.find(t=>t.name==='synthetic-vector-35016')!;
 const outsideProject=(await f.mutate('/settings/projects','POST',{name:'synthetic-vector-35017',leadOperatorId:f.owner})).projects.find(p=>p.name==='synthetic-vector-35017')!;
 const outsideIssue=await f.create({teamId:outside.id,projectId:outsideProject.id});
 for(const [kind,id,status] of [['team',team.id,403],['initiative',initiative.id,403],['project',outsideProject.id,404],['issue',outsideIssue.id,404]] as const){
  const target=await create(f.cookie,kind,id);
  const mutationStatus=kind==='initiative'?404:status;
  const attempts:[string,string,unknown,number][]=[['/documents','POST',{parentKind:kind,parentId:id,title:'synthetic-vector-guest-refused',body:'synthetic-vector-refused'},status],['/documents/'+target.id,'PATCH',{expectedVersion:target.version,body:'synthetic-vector-guest-refused'},mutationStatus],['/documents/'+target.id+'/comments','POST',{body:'synthetic-vector-guest-refused'},mutationStatus]];
  for(const [path,method,body,expected] of attempts){const before=await snapshot(tables);expect((await request('/api'+path,method,body,guest)).status).toBe(expected);expect(await snapshot(tables)).toEqual(before);}
 }
 await read(await f.call('/issues/'+issue.identifier+'/specification','PUT',{documentId:visible.id}));
 expect((await read(await request('/api/documents/'+visible.id,'GET',undefined,viewer))).id).toBe(visible.id);
 expect((await read(await request('/api/documents/'+visible.id+'/revisions','GET',undefined,viewer))).revisions.length).toBeGreaterThan(0);
 expect((await read(await request('/api/documents?parentKind=team&parentId='+team.id,'GET',undefined,viewer))).documents.map((d:any)=>d.id)).toContain(visible.id);
 expect((await read(await request('/api/issues/'+issue.identifier+'/specification','GET',undefined,viewer))).specification.id).toBe(visible.id);
 const attempts:[string,string,unknown][]=[['/documents','POST',{parentKind:'project',parentId:project.id,title:'synthetic-vector-viewer-refused',body:'synthetic-vector-refused'}],['/documents/'+visible.id,'PATCH',{expectedVersion:visible.version+1,body:'synthetic-vector-viewer-refused'}],['/documents/'+visible.id+'/comments','POST',{body:'synthetic-vector-viewer-refused'}],['/issues/'+issue.identifier+'/specification','PUT',{documentId:visible.id}],['/issues/'+issue.identifier+'/specification','DELETE',undefined]];
 for(const [path,method,body] of attempts){const before=await snapshot(tables);expect((await request('/api'+path,method,body,viewer)).status).toBe(403);expect(await snapshot(tables)).toEqual(before);}
 // The next request from an already-open Member session sees a demotion too.
 await read(await f.call('/settings/operators/'+await actor(member)+'/role','PATCH',{role:'viewer'}));
 const before=await snapshot(tables);expect((await request('/api/documents/'+visible.id+'/comments','POST',{body:'synthetic-vector-demoted-refused'},member)).status).toBe(403);expect(await snapshot(tables)).toEqual(before);
}
