import {env} from 'cloudflare:workers';
import {expect,inject} from 'vitest';
import {applyD1Migrations} from 'cloudflare:test';
import {mentionToken} from '../../src/core/features/notifications/mention-token';
import {documentMentionStatements} from '../../src/core/features/documents/mentions';
import {visibilityDatabase} from '../../src/core/features/roles/visibility-database';
import {insertHistoricalSample} from './historical-sample-fixture';
import {actor,invite,request} from './base-auth-fixture';
import {snapshot} from './role-fixture';
import type {setupAdministration} from './administration-fixture';
const read=async(response:Response,status=200)=>{expect(response.status,await response.clone().text()).toBe(status);return response.json() as Promise<any>;};
const watched=['documents','document_revisions','document_comments','document_followers','document_mentions','document_notifications','document_notification_events','issue_activity','notifications','issue_followers'];
const mention=(id:string)=>mentionToken({id,name:'synthetic-vector-member'});

/** One native create and revision journey, including refused unsafe writes. */
export async function documentMentionsScenario(f:Awaited<ReturnType<typeof setupAdministration>>) {
 const peer=await invite(['synthetic-vector-35201','vector.test'].join('@'),f.cookie),peerId=await actor(peer);
 const next=await invite(['synthetic-vector-35202','vector.test'].join('@'),f.cookie),nextId=await actor(next);
 const viewer=await invite(['synthetic-vector-35203','vector.test'].join('@'),f.cookie,'viewer'),viewerId=await actor(viewer);
 const guest=await invite(['synthetic-vector-35204','vector.test'].join('@'),f.cookie),guestId=await actor(guest);
 const team=(await f.mutate('/settings/teams','POST',{name:'synthetic-vector-35205',identifierPrefix:'SYNMENT',isPrivate:true})).teams.find(t=>t.name==='synthetic-vector-35205')!;
 for(const id of [peerId,viewerId])await f.mutate(`/settings/teams/${team.id}/members/${id}`,'PUT',{role:'member'});
 await f.mutate('/settings/operators/'+guestId+'/role','PATCH',{role:'guest',teamIds:[team.id]});
 const issue=await f.create({teamId:team.id}),body=mention(peerId)+' '+mention(f.owner)+' '+mention(guestId)+' @unknown '+mention('01K00000000000000000999999');
 let doc=await read(await f.call('/documents','POST',{parentKind:'issue',parentId:issue.id,title:'synthetic-vector-mentioned-document',body}),201);
 const path='/documents/'+doc.id;
 const inbox=async(cookie:string)=>(await read(await request('/api/notifications?limit=50','GET',undefined,cookie))).items.filter((n:any)=>n.documentId===doc.id);
 const followers=async()=>(await env.DB.prepare('SELECT operator_id FROM document_followers WHERE document_id=? ORDER BY operator_id').bind(doc.id).all<{operator_id:string}>()).results.map(r=>r.operator_id);
 expect(doc.body).toBe(body);
 expect(await followers()).toEqual([peerId,f.owner,guestId].sort());
 expect(await inbox(f.cookie)).toEqual([]);
 const delivered=(await inbox(peer))[0];expect(await inbox(peer)).toHaveLength(1);
 expect(delivered).toMatchObject({documentId:doc.id,title:doc.title,causes:['mention'],readAt:null});
 expect(await inbox(guest)).toHaveLength(1);
 const countBefore=await read(await request('/api/notifications/count','GET',undefined,peer));
 await read(await request('/api/notifications/'+delivered.id+'/read','POST',undefined,peer));
 expect((await read(await request('/api/notifications/count','GET',undefined,peer))).unreadCount).toBe(countBefore.unreadCount-1);
 expect((await inbox(peer))[0].readAt).not.toBeNull();
 // Repeated mentions in unchanged text and a new revision never duplicate delivery.
 doc=await read(await f.call(path,'PATCH',{expectedVersion:doc.version,body}));
 expect(await inbox(peer)).toHaveLength(1);expect(await inbox(guest)).toHaveLength(1);
 // An inaccessible recipient is not notified. Gaining access without a new
 // mention is not a historical delivery door either.
 doc=await read(await f.call(path,'PATCH',{expectedVersion:doc.version,body:body+' '+mention(nextId)}));
 expect(await inbox(next)).toEqual([]);
 await f.mutate(`/settings/teams/${team.id}/members/${nextId}`,'PUT',{role:'member'});
 doc=await read(await f.call(path,'PATCH',{expectedVersion:doc.version,body:doc.body}));
 expect(await inbox(next)).toEqual([]);
 doc=await read(await f.call(path,'PATCH',{expectedVersion:doc.version,body:body+' '+mention(viewerId)}));
 expect(await inbox(viewer)).toHaveLength(1);expect(await inbox(peer)).toHaveLength(1);
 const beforeStale=await snapshot(watched);
 expect((await f.call(path,'PATCH',{expectedVersion:doc.version-1,body:mention(nextId)})).status).toBe(409);
 expect(await snapshot(watched)).toEqual(beforeStale);
 for(const [door,method,input] of [[path,'PATCH',{expectedVersion:doc.version,body:mention(nextId)}],['/documents','POST',{parentKind:'issue',parentId:issue.id,title:'synthetic-vector-refused-mention',body:mention(nextId)}]] as const) {
  const before=await snapshot(watched);expect((await request('/api'+door,method,input,viewer)).status).toBe(403);expect(await snapshot(watched)).toEqual(before);
 }
 // Failure after notification insertion rolls back the revision and every
 // mention, follower and receipt, through the mounted public mutation.
 await env.DB.exec("CREATE TRIGGER synthetic_vector_mention_failure BEFORE INSERT ON document_followers BEGIN SELECT RAISE(ABORT,'synthetic-vector-mention-rollback'); END");
 const beforeFailure=await snapshot(watched);
 expect((await f.call(path,'PATCH',{expectedVersion:doc.version,body:doc.body+' '+mention(nextId)})).status).toBe(500);
 expect(await snapshot(watched)).toEqual(beforeFailure);
 expect((await f.call('/documents','POST',{parentKind:'issue',parentId:issue.id,title:'synthetic-vector-rollback-document',body:mention(nextId)})).status).toBe(500);
 expect(await snapshot(watched)).toEqual(beforeFailure);
 await env.DB.exec('DROP TRIGGER synthetic_vector_mention_failure');
 doc=await read(await f.call(path,'PATCH',{expectedVersion:doc.version,body:doc.body+' '+mention(nextId)}));
 expect(await inbox(next)).toHaveLength(1);
 doc=await read(await f.call(path,'PATCH',{expectedVersion:doc.version,body:'@unknown remains literal'}));
 expect(doc.body).toBe('@unknown remains literal');expect(await inbox(peer)).toHaveLength(1);expect(await inbox(next)).toHaveLength(1);
 expect(await followers()).toEqual([peerId,f.owner,guestId,viewerId,nextId].sort());
 // Current parent authority hides delivered history and read mutations after
 // withdrawal, without deleting or recreating that history.
 await f.mutate(`/settings/teams/${team.id}/members/${peerId}`,'DELETE');
 expect(await inbox(peer)).toEqual([]);
 expect((await request('/api'+path,'GET',undefined,peer)).status).toBe(404);
 const beforeRead=await snapshot(watched);expect((await request('/api/notifications/'+delivered.id+'/read','POST',undefined,peer)).status).toBe(404);expect(await snapshot(watched)).toEqual(beforeRead);
 expect((await request('/api'+path,'PATCH',{expectedVersion:doc.version,body:mention(nextId)},peer)).status).toBe(404);expect(await snapshot(watched)).toEqual(beforeRead);
 doc=await read(await f.call(path,'PATCH',{expectedVersion:doc.version,body:mention(peerId)}));
 expect(await inbox(peer)).toEqual([]);
 await f.mutate(`/settings/teams/${team.id}/members/${peerId}`,'PUT',{role:'member'});
 expect(await inbox(peer)).toHaveLength(1);
 doc=await read(await f.call(path,'PATCH',{expectedVersion:doc.version,body:doc.body}));expect(await inbox(peer)).toHaveLength(1);
 // A project follows its genuine issue membership. Guest notifications follow
 // current invited-parent read access, never a carrier issue.
 const project=(await f.mutate('/settings/projects','POST',{name:'synthetic-vector-35206',leadOperatorId:f.owner})).projects.find(p=>p.name==='synthetic-vector-35206')!;
 await f.create({teamId:team.id,projectId:project.id});
 const projectDoc=await read(await f.call('/documents','POST',{parentKind:'project',parentId:project.id,title:'synthetic-vector-project-mention',body:mention(guestId)}),201);
 expect((await read(await request('/api/notifications?limit=50','GET',undefined,guest))).items.filter((n:any)=>n.documentId===projectDoc.id)).toHaveLength(1);
 const teamDoc=await read(await f.call('/documents','POST',{parentKind:'team',parentId:team.id,title:'synthetic-vector-team-mention',body:mention(guestId)}),201);
 expect((await read(await request('/api/notifications?limit=50','GET',undefined,guest))).items.filter((n:any)=>n.documentId===teamDoc.id)).toHaveLength(1);
 const initiative=await read(await f.call('/initiatives','POST',{name:'synthetic-vector-35207',ownerOperatorId:f.owner}),201);
 const initiativeDoc=await read(await f.call('/documents','POST',{parentKind:'initiative',parentId:initiative.id,title:'synthetic-vector-initiative-mention',body:mention(guestId)+' '+mention(peerId)}),201);
 expect((await read(await request('/api/notifications?limit=50','GET',undefined,guest))).items.some((n:any)=>n.documentId===initiativeDoc.id)).toBe(false);
 expect((await read(await request('/api/notifications?limit=50','GET',undefined,peer))).items.filter((n:any)=>n.documentId===initiativeDoc.id)).toHaveLength(1);
 // Erasure removes recipient custody and revokes the open session. Replaying
 // the capture cannot resurrect followers or notifications for the person.
 await read(await f.call('/settings/operators/'+nextId,'DELETE'));
 expect((await request('/api/notifications','GET',undefined,next)).status).toBe(401);
 expect((await env.DB.prepare('SELECT count(*) n FROM document_notifications WHERE recipient_id=?').bind(nextId).first<number>('n'))).toBe(0);
 expect((await env.DB.prepare('SELECT count(*) n FROM document_followers WHERE operator_id=?').bind(nextId).first<number>('n'))).toBe(0);
 const beforeReplay=await snapshot(watched);
 await env.DB.batch(documentMentionStatements(visibilityDatabase(env.DB,f.owner),{documentId:doc.id,actor:f.owner,version:doc.version,at:doc.updatedAt},doc.body));
 expect(await snapshot(watched)).toEqual(beforeReplay);
 doc=await read(await f.call(path,'PATCH',{expectedVersion:doc.version,body:doc.body+' '+mention(nextId)}));
 expect((await env.DB.prepare('SELECT count(*) n FROM document_notifications WHERE recipient_id=?').bind(nextId).first<number>('n'))).toBe(0);
 console.log('PROBE PROJ-013 document mentions: native create, revise, remove, read and current authority -> once-only document Inbox and followers; stale, Viewer, withdrawn and erased writes preserve custody');
 return {doc,peerId};
}

export async function documentMentionUpgrade() {
 const db=env.ARCHIVE_TARGET_DB,migrations=inject('migrations'),boundary=migrations.findIndex(m=>m.name==='0122_document_mentions.sql');
 await applyD1Migrations(db,migrations.slice(0,boundary));
 await insertHistoricalSample(db,new Date('2026-10-01T00:00:00Z'));
 const owner=(await db.prepare('SELECT id,workspace_id FROM operators LIMIT 1').first<any>())!;
 const issue=(await db.prepare('SELECT id FROM issues LIMIT 1').first<any>())!;
 const id='01K00000000000000000035201',at='2026-10-01T00:00:00.000Z',body=mention(owner.id);
 await db.batch([
  db.prepare('INSERT INTO documents(id,workspace_id,parent_kind,parent_id,title,body,author_operator_id,created_at,updated_at) VALUES(?,?,\'issue\',?,?,?,?,?,?)').bind(id,owner.workspace_id,issue.id,'synthetic-vector-upgrade-mention',body,owner.id,at,at),
  db.prepare('INSERT INTO document_revisions(id,document_id,version,title,body,author_operator_id,created_at) VALUES(?,?,1,?,?,?,?)').bind('01K00000000000000000035202',id,'synthetic-vector-upgrade-mention',body,owner.id,at),
 ]);
 const before=(await db.prepare('SELECT * FROM documents ORDER BY id').all()).results,revisions=(await db.prepare('SELECT * FROM document_revisions ORDER BY id').all()).results;
 await applyD1Migrations(db,migrations.slice(boundary));
 expect((await db.prepare('SELECT * FROM documents ORDER BY id').all()).results).toEqual(before);
 expect((await db.prepare('SELECT * FROM document_revisions ORDER BY id').all()).results).toEqual(revisions);
 for(const table of ['document_notifications','document_followers','document_mentions','document_notification_events'])expect(await db.prepare('SELECT count(*) n FROM '+table).first<number>('n')).toBe(0);
 expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
}
