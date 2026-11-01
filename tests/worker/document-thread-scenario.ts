import {env} from 'cloudflare:workers';
import {expect} from 'vitest';
import {collaborationFixture} from './collaboration-fixture';
import {request} from './base-auth-fixture';
import {snapshot} from './role-fixture';

const changedTables=['issue_comments','issue_activity','audit_records','issue_followers','issue_mentions','notifications','notification_events','notification_candidates','notification_deliveries'];
/** One native thread, selected from an issue-owned document, keeps all existing thread authority. */
export async function documentThreadScenario(){
 const f=await collaborationFixture();
 const team=(await f.mutate('/settings/teams','POST',{name:'synthetic-vector-quote-team',identifierPrefix:'DQTE'})).teams.find(t=>t.identifierPrefix==='DQTE')!;
 const issue=await f.create({teamId:team.id,title:'synthetic-vector-quote-1'});
 const read=async(r:Response,status=200)=>{expect(r.status,await r.clone().text()).toBe(status);return r.json() as Promise<any>;};
 const body='🧭 First repeat. **Quoted café 🧪** needs review. Second repeat.';
 let doc=await read(await f.call('/documents','POST',{parentKind:'issue',parentId:issue.id,title:'synthetic-vector-quote-2',body}),201);
 const other=await read(await f.call('/documents','POST',{parentKind:'issue',parentId:issue.id,title:'synthetic-vector-quote-3',body}),201);
 const quote='repeat',start=Array.from(body.slice(0,body.lastIndexOf(quote))).length;
 const selected={documentId:doc.id,quote,start,end:start+quote.length,expectedVersion:doc.version,expectedBody:body};
 const path='/issues/'+issue.identifier,comments=async()=> (await read(await f.call(path+'/discussion'))).comments as any[];
 const post=async(cookie:string,text:string,parentId?:string,anchor?:unknown)=>read(await f.any(cookie,path+'/comments','POST',{body:text,...(parentId?{parentId}:{}),...(anchor?{anchor}:{})}),201);
 const root=(await post(f.bobCookie,'synthetic-vector-quote-question',undefined,selected)).id;
 const first=(await post(f.cookie,'synthetic-vector-first-reply',root)).id,second=(await post(f.caraCookie,'synthetic-vector-second-reply',root)).id;
 expect((await comments()).find(c=>c.id===root).anchor).toEqual({documentId:doc.id,quote,start,end:start+quote.length,removed:false});
 expect((await comments()).filter(c=>c.parentId===root).map(c=>c.id)).toEqual([first,second]);
 const resolve=async(resolved:boolean,cookie=f.cookie)=>read(await f.any(cookie,path+'/comments/'+root+'/resolution','POST',{resolved}));
 await resolve(true);expect((await comments()).find(c=>c.id===root)).toMatchObject({resolvedBy:'Owner',resolvedAt:expect.any(String)});
 await resolve(false,f.caraCookie);await resolve(true);
 const third=(await post(f.bobCookie,'synthetic-vector-third-reply',root)).id;
 expect((await comments()).find(c=>c.id===root)).toMatchObject({resolvedAt:null,resolvedBy:null});
 expect((await env.DB.prepare("SELECT kind,actor_operator_id actor FROM issue_activity WHERE issue_id=? AND kind LIKE 'thread.%' ORDER BY created_at,id").bind(issue.id).all()).results).toEqual([{kind:'thread.resolved',actor:f.owner},{kind:'thread.reopened',actor:f.cara},{kind:'thread.resolved',actor:f.owner},{kind:'thread.reopened',actor:f.bob}]);
 let before=await snapshot(changedTables);
 expect((await f.call(path+'/comments/'+root,'PATCH',{body:'Refused foreign edit'})).status).toBe(403);expect(await snapshot(changedTables)).toEqual(before);
 await read(await f.any(f.bobCookie,path+'/comments/'+root,'PATCH',{body:'synthetic-vector-edited-question'}));
 expect((await comments()).find(c=>c.id===root)).toMatchObject({body:'synthetic-vector-edited-question',editedAt:expect.any(String)});
 const prefix='🪴 More context. ';
 doc=await read(await f.call('/documents/'+doc.id,'PATCH',{expectedVersion:doc.version,body:prefix+body}));
 expect((await comments()).find(c=>c.id===root).anchor).toEqual({documentId:doc.id,quote,start:start+Array.from(prefix).length,end:start+Array.from(prefix).length+quote.length,removed:false});
 doc=await read(await f.call('/documents/'+doc.id,'PATCH',{expectedVersion:doc.version,body:(prefix+body).replace('Second repeat.','Second part.')}));
 expect((await comments()).find(c=>c.id===root).anchor).toMatchObject({documentId:doc.id,quote,removed:true});
 doc=await read(await f.call('/documents/'+doc.id,'PATCH',{expectedVersion:doc.version,body}));
 expect((await comments()).find(c=>c.id===root).anchor.removed).toBe(true);
 expect((await comments()).filter(c=>c.parentId===root).map(c=>c.id)).toEqual([first,second,third]);
 expect((await read(await f.call('/documents/'+other.id))).body).toBe(body);
 // The other identical document and the first identical occurrence never receive the thread.
 const unicode='Quoted café 🧪',unicodeStart=Array.from(body.slice(0,body.indexOf(unicode))).length;
 const current={...selected,expectedVersion:doc.version};
 const unicodeRoot=(await post(f.cookie,'synthetic-vector-unicode-question',undefined,{...current,quote:unicode,start:unicodeStart,end:unicodeStart+Array.from(unicode).length})).id;
 expect((await comments()).find(c=>c.id===unicodeRoot).anchor).toMatchObject({documentId:doc.id,quote:unicode,start:unicodeStart,removed:false});
 // Invalid, stale and cross-parent sources refuse every thread side effect.
 const outside=await f.create(),outsideDoc=await read(await f.call('/documents','POST',{parentKind:'issue',parentId:outside.id,title:'synthetic-vector-quote-4',body}),201);
 for(const [anchor,status] of [[{...current,quote:'Wrong quote'},400],[selected,409],[{...current,documentId:outsideDoc.id,expectedVersion:outsideDoc.version},400]] as const){
  before=await snapshot(changedTables);const denied=await f.call(path+'/comments','POST',{body:'synthetic-vector-refused',anchor});
  expect(denied.status,await denied.clone().text()).toBe(status);expect(await snapshot(changedTables)).toEqual(before);
 }
 before=await snapshot(changedTables);
 let raced=false;
 const racing=new Proxy(env.DB,{get(target,key){
  if(key==='batch')return async(statements:D1PreparedStatement[])=>{
   if(!raced&&statements.some(statement=>(statement as unknown as {statement:string}).statement.includes('document anchor changed'))){
    raced=true;doc=await read(await f.call('/documents/'+doc.id,'PATCH',{expectedVersion:doc.version,body:body+' Changed.'}));
   }
   return target.batch(statements);
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 const stale=await request('/api'+path+'/comments','POST',{body:'synthetic-vector-racing-quote',anchor:current},f.cookie,{DB:racing});
 expect(raced).toBe(true);expect(stale.status,await stale.clone().text()).toBe(409);expect(await snapshot(changedTables)).toEqual(before);
 // A document in a project is not admitted by linking it as a specification.
 const project=(await f.mutate('/settings/projects','POST',{name:'synthetic-vector-quote-project',leadOperatorId:f.owner})).projects.find(p=>p.name==='synthetic-vector-quote-project')!;
 const spec=await read(await f.call('/documents','POST',{parentKind:'project',parentId:project.id,title:'synthetic-vector-quote-spec',body}),201);
 await read(await f.call(path+'/specification','PUT',{documentId:spec.id}));before=await snapshot(changedTables);
 expect((await f.call(path+'/comments','POST',{body:'Refused specification source',anchor:{...selected,documentId:spec.id}})).status).toBe(400);expect(await snapshot(changedTables)).toEqual(before);
 // Current permissions apply to a document thread just as to any issue thread.
 await read(await f.call('/settings/teams/'+team.id+'/members/'+f.cara,'PUT',{role:'owner'}));
 before=await snapshot(changedTables);expect((await f.any(f.caraCookie,path+'/comments/'+root,'PATCH',{body:'Refused moderator edit'})).status).toBe(403);expect(await snapshot(changedTables)).toEqual(before);
 await read(await f.any(f.caraCookie,path+'/comments/'+root,'DELETE'));
 expect((await comments()).find(c=>c.id===root)).toMatchObject({body:null,anchor:null,deletedAt:expect.any(String)});
 expect((await comments()).filter(c=>c.parentId===root).map(c=>c.id)).toEqual([first,second,third]);
 expect(await env.DB.prepare("SELECT actor_operator_id actor FROM audit_records WHERE action='comment.deleted' AND subject_id=?").bind(root).first()).toEqual({actor:f.cara});
 const deletion=(await read(await f.call(path))).activity.find((entry:any)=>entry.kind==='comment.deleted'&&entry.nextValue.id===root);
 expect(deletion).toMatchObject({actor:expect.any(String),nextValue:{id:root}});
 expect(deletion.actor).toBe((await env.DB.prepare('SELECT name FROM operators WHERE id=?').bind(f.cara).first<string>('name')));
 expect(await env.DB.prepare('SELECT count(*) n FROM issue_followers WHERE issue_id=? AND operator_id=?').bind(issue.id,f.bob).first('n')).toBe(1);
 await read(await f.call('/settings/teams/'+team.id+'/members/'+f.cara,'PUT',{role:'member'}));before=await snapshot(changedTables);
 expect((await f.any(f.caraCookie,path+'/comments/'+unicodeRoot,'DELETE')).status).toBe(403);expect(await snapshot(changedTables)).toEqual(before);
 await read(await f.call('/settings/operators/'+f.cara+'/role','PATCH',{role:'viewer'}));
 before=await snapshot(changedTables);expect((await f.any(f.caraCookie,path+'/comments','POST',{body:'Refused Viewer',anchor:{...current,expectedVersion:doc.version,expectedBody:doc.body}})).status).toBe(403);expect(await snapshot(changedTables)).toEqual(before);
 await read(await f.call('/settings/operators/'+f.bob+'/role','PATCH',{role:'guest',teamIds:[team.id]}));
 await post(f.bobCookie,'synthetic-vector-guest-quote',undefined,{...current,expectedVersion:doc.version,expectedBody:doc.body});
 await read(await f.call('/settings/teams/'+team.id+'/privacy','PUT',{isPrivate:true}));
 await read(await f.call('/settings/teams/'+team.id+'/members/'+f.bob,'DELETE'));
 before=await snapshot(changedTables);
 expect((await f.any(f.bobCookie,path+'/comments','POST',{body:'Refused withdrawn Guest',anchor:{...current,expectedVersion:doc.version,expectedBody:doc.body}})).status).toBe(404);
 for(const url of [path+'/discussion','/documents/'+doc.id,'/documents/'+doc.id+'/revisions']){
  const denied=await f.any(f.bobCookie,url);expect(denied.status).toBe(404);expect(await denied.text()).not.toContain(unicode);
 }
 expect(await snapshot(changedTables)).toEqual(before);
 await read(await f.call('/settings/operators/'+f.bob,'DELETE'));before=await snapshot(changedTables);
 expect((await f.any(f.bobCookie,path+'/comments','POST',{body:'Refused revoked session',anchor:current})).status).toBe(401);expect(await snapshot(changedTables)).toEqual(before);
 console.log('PROBE ISSUE-008 document quotes: native document and issue doors retain exact occurrences, Unicode, ordered replies, resolution, removal and current authority; invalid and racing sources leave thread side effects unchanged');
}

/** The mention upgrade leaves a historical workspace in the shared target; a pristine restore needs it empty. */
export async function resetArchiveTarget(){
 const db=env.ARCHIVE_TARGET_DB;
 const objects=async(type:string)=>(await db.prepare("SELECT name,sql FROM sqlite_master WHERE type=? AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").bind(type).all<{name:string;sql:string}>()).results;
 for(const view of await objects('view'))await db.prepare('DROP VIEW "'+view.name+'"').run();
 for(const table of (await objects('table')).filter(t=>/^CREATE VIRTUAL/i.test(t.sql)))await db.prepare('DROP TABLE "'+table.name+'"').run();
 // Foreign keys decide the order: a table drops once nothing still references it.
 for(let pending=await objects('table');pending.length;){
  const remaining=[];
  for(const table of pending)try{await db.prepare('DROP TABLE "'+table.name+'"').run();}catch{remaining.push(table);}
  expect(remaining.length).toBeLessThan(pending.length);
  pending=remaining;
 }
}
