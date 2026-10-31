import { Hono } from 'hono';
import { env } from 'cloudflare:workers';
import { expect } from 'vitest';
import { createUlid } from '../../src/core/shared/ids';
import { createServerApp } from '../../src/core/app/server';
import { createApiApp } from '../../src/core/app/api';
import type { AppEnvironment } from '../../src/core/app/bindings';
import type { CommentDraft } from '../../src/core/features/drafts/comment-schema';
import { collaborationFixture } from './collaboration-fixture';
import { bindings, origin, request, signIn } from './base-auth-fixture';
import { heldBody } from './removal-fixture';
async function json<T = any>(response: Response,status=200): Promise<T> {
  expect(response.status,await response.clone().text()).toBe(status); return response.json() as Promise<T>;
}

export async function commentDraftScenario() {
  const f = await collaborationFixture(), team = f.initial.teams[0], second = await signIn();
  const description = 'synthetic-vector-2867 quoted words';
  const issue = await json(await f.call('/issues','POST',{teamId:team.id,title:'synthetic-vector-2860',description}),201);
  const target = '/issues/' + issue.identifier, text = 'synthetic-vector-2861';
  const id = createUlid(new Date());
  const draft: CommentDraft = (await json(await f.call(target+'/comment-drafts','POST',{id,body:text}),201)).draft;
  expect(draft).toMatchObject({id,body:text,revision:1,identifier:issue.identifier,parentId:null,team:team.name});
  expect(Number.isFinite(Date.parse(draft.updatedAt))).toBe(true);
  expect((await json(await f.any(second,'/comment-drafts'))).drafts).toEqual([draft]);
  expect((await json(await f.any(second,target+'/comment-drafts','POST',{id:createUlid(new Date()),body:'synthetic-vector-2862'}),409)).draft).toEqual(draft);
  const path = '/comment-drafts/' + id, newer = '\nsynthetic-vector-2863\n';
  const updated = (await json(await f.any(second,path,'PATCH',{revision:1,body:newer}))).draft;
  expect(updated.body).toBe(newer); expect(updated.revision).toBe(2);
  expect((await json(await f.call(path,'PATCH',{revision:1,body:text}),409)).draft).toEqual(updated);
  const state = async () => (await env.DB.prepare('SELECT * FROM comment_drafts ORDER BY id').all()).results;
  const snapshot = await state();
  for (const route of ['/comment-drafts','/search?q='+text,'/notifications?limit=50'])
    expect(JSON.stringify(await json(await f.any(f.bobCookie,route)))).not.toContain(newer.trim());
  expect((await f.any(f.bobCookie,path,'PATCH',{revision:2,body:text})).status).toBe(409);
  expect((await f.any(f.bobCookie,path,'DELETE',{revision:2})).status).toBe(409);
  const token = await json(await f.any(f.bobCookie,'/settings/integrations/tokens','POST',{name:'synthetic-vector-2864',scopes:['issues:read','comments:read']}),201);
  for (const route of ['/comment-drafts','/issues?q='+text]) {
    const response = await createServerApp().request(origin+'/api/v1'+route,{headers:{Authorization:'Bearer '+token.token}},bindings);
    expect(await response.text()).not.toContain(newer.trim());
  }
  expect(await state()).toEqual(snapshot);
  const submit = (cookie:string,body=newer.trim(),parentId?:string,revision=2) => createServerApp().request(origin+'/api'+target+'/comments',{method:'POST',
    headers:{Host:new URL(origin).host,Cookie:cookie,Origin:origin,'content-type':'application/json',
      'x-vector-comment-draft-id':id,'x-vector-comment-draft-revision':String(revision)},body:JSON.stringify({body,...(parentId?{parentId}:{})})},bindings);
  const counts = async () => Promise.all(['issue_comments','issue_activity','notifications','issue_followers'].map(table => env.DB.prepare('SELECT count(*) n FROM '+table).first('n')));
  const prior = await counts();
  expect((await submit(f.bobCookie)).status).toBe(409);
  expect((await submit(second,text)).status).toBe(409);
  expect((await submit(second,newer.trim(),createUlid(new Date()))).status).toBe(409);
  await env.DB.prepare("CREATE TRIGGER synthetic_comment_draft_rollback BEFORE UPDATE ON comment_drafts WHEN NEW.state='submitted' BEGIN SELECT RAISE(ABORT,'synthetic comment draft rollback'); END").run();
  try { expect((await submit(second)).status).toBe(500); }
  finally { await env.DB.prepare('DROP TRIGGER synthetic_comment_draft_rollback').run(); }
  expect(await state()).toEqual(snapshot); expect(await counts()).toEqual(prior);
  const delayed = heldBody();
  const pending = createServerApp().request(origin+'/api'+path,{method:'PATCH',headers:{Host:new URL(origin).host,Cookie:f.cookie,Origin:origin,'content-type':'application/json'},body:delayed.body},bindings);
  await Promise.race([delayed.reading,pending.then(r=>{throw Error('Draft body not reached: '+r.status);})]);
  const comment = await json(await submit(second),201);
  delayed.release(JSON.stringify({revision:2,body:text})); expect((await pending).status).toBe(409);
  expect((await submit(second)).status).toBe(409);
  expect((await f.call(target+'/comment-drafts','POST',{id,body:text})).status).toBe(409);
  expect((await json(await f.call('/comment-drafts'))).drafts).toEqual([]);
  expect(await env.DB.prepare('SELECT body FROM comment_drafts WHERE id=?').bind(id).first('body')).toBeNull();
  expect((await json(await f.call(target+'/discussion'))).comments).toEqual([expect.objectContaining({id:comment.id,body:newer.trim()})]);
  // A quoted description comment is its own composer; posting consumes its exact saved selection.
  const anchor = {quote:'quoted words',start:22,end:34,expectedDescription:description}, quoteId = createUlid(new Date());
  const quoted = (await json(await f.call(target+'/comment-drafts','POST',{id:quoteId,body:text,anchor}),201)).draft;
  expect(quoted).toMatchObject({id:quoteId,body:text,parentId:null,anchor});
  expect((await json(await f.any(second,'/comment-drafts'))).drafts).toEqual([quoted]);
  expect((await f.call(target+'/comment-drafts','POST',{id:createUlid(new Date()),body:text,parentId:comment.id,anchor})).status).toBe(400);
  const quote = (selection: unknown) => createServerApp().request(origin+'/api'+target+'/comments',{method:'POST',
    headers:{Host:new URL(origin).host,Cookie:second,Origin:origin,'content-type':'application/json',
      'x-vector-comment-draft-id':quoteId,'x-vector-comment-draft-revision':'1'},body:JSON.stringify({body:text,anchor:selection})},bindings);
  expect((await quote({...anchor,quote:'quoted',end:28})).status).toBe(409);
  const thread = await json(await quote(anchor),201);
  expect((await json(await f.call('/comment-drafts'))).drafts).toEqual([]);
  expect((await json(await f.call(target+'/discussion'))).comments).toContainEqual(expect.objectContaining({id:thread.id,body:text,
    anchor:{quote:'quoted words',start:22,end:34,removed:false}}));
  const reply = (await json(await f.call(target+'/comment-drafts','POST',{id:createUlid(new Date()),body:text,parentId:comment.id}),201)).draft;
  expect(reply.parentId).toBe(comment.id);
  expect((await f.any(second,'/comment-drafts/'+reply.id,'DELETE',{revision:1})).status).toBe(200);
  expect((await f.call('/comment-drafts/'+reply.id,'PATCH',{revision:1,body:text})).status).toBe(409);
  expect((await f.call(target+'/comment-drafts','POST',{id:reply.id,body:text,parentId:comment.id})).status).toBe(409);
  const invalidBefore = await state();
  expect((await f.call(target+'/comment-drafts','POST',{id:createUlid(new Date()),body:text,parentId:createUlid(new Date())})).status).toBe(404);
  expect(await state()).toEqual(invalidBefore);
  const revoked = await signIn(), held = heldBody();
  const revoking = createServerApp().request(origin+'/api'+target+'/comment-drafts',{method:'POST',headers:{Host:new URL(origin).host,Cookie:revoked,Origin:origin,'content-type':'application/json'},body:held.body},bindings);
  await Promise.race([held.reading,revoking.then(r=>{throw Error('Body not reached: '+r.status);})]);
  expect((await request('/auth/signout','POST',{},revoked)).status).toBe(204);
  held.release(JSON.stringify({id:createUlid(new Date()),body:text})); expect((await revoking).status).toBe(401);
  expect(await state()).toEqual(invalidBefore);
  await env.DB.prepare("UPDATE operators SET role='viewer' WHERE id=?").bind(f.bob).run();
  expect((await f.any(f.bobCookie,target+'/comment-drafts','POST',{id:createUlid(new Date()),body:text})).status).toBe(403);
  await env.DB.prepare("UPDATE operators SET role='guest' WHERE id=?").bind(f.bob).run();
  await env.DB.prepare('DELETE FROM team_members WHERE operator_id=?').bind(f.bob).run();
  expect((await f.any(f.bobCookie,target+'/comment-drafts','POST',{id:createUlid(new Date()),body:text})).status).toBe(404);
  expect((await f.call('/settings/teams/'+team.id+'/members/'+f.bob,'PUT',{role:'member'})).status).toBe(200);
  const guest = (await json(await f.any(f.bobCookie,target+'/comment-drafts','POST',{id:createUlid(new Date()),body:text}),201)).draft;
  expect((await f.call('/settings/teams/'+team.id+'/members/'+f.bob,'DELETE')).status).toBe(200);
  expect((await json(await f.any(f.bobCookie,'/comment-drafts'))).drafts).toEqual([]);
  const inaccessible = await state();
  expect([403,404]).toContain((await f.any(f.bobCookie,'/comment-drafts/'+guest.id,'PATCH',{revision:1,body:text})).status);
  expect(await state()).toEqual(inaccessible);
  // Restoring the current membership makes the same private draft available again.
  expect((await f.call('/settings/teams/'+team.id+'/members/'+f.bob,'PUT',{role:'member'})).status).toBe(200);
  expect((await json(await f.any(f.bobCookie,'/comment-drafts'))).drafts).toEqual([guest]);
  const originalWorkspace = await env.DB.prepare('SELECT workspace_id FROM operators WHERE id=?').bind(f.bob).first<string>('workspace_id');
  const workspace = createUlid(new Date());
  await env.DB.prepare('INSERT INTO workspace_settings(id,name,timezone,created_at,updated_at) SELECT ?,name,timezone,created_at,updated_at FROM workspace_settings LIMIT 1').bind(workspace).run();
  await env.DB.prepare('UPDATE operators SET workspace_id=? WHERE id=?').bind(workspace,f.bob).run();
  const native = new Hono<AppEnvironment>().route('/api',createApiApp());
  const foreign = (route:string,method='GET',body?:unknown) => native.request(origin+'/api'+route,{method,headers:{Host:new URL(origin).host,Cookie:f.bobCookie,Origin:origin,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},bindings);
  expect((await json(await foreign('/comment-drafts'))).drafts).toEqual([]);
  expect((await foreign('/comment-drafts/'+guest.id,'PATCH',{revision:1,body:text})).status).toBe(409);
  expect(await state()).toEqual(inaccessible);
  await env.DB.prepare("UPDATE operators SET workspace_id=?,role='member' WHERE id=?").bind(originalWorkspace,f.bob).run();
  await env.DB.prepare('DELETE FROM workspace_settings WHERE id=?').bind(workspace).run();
  const erased = await f.call(target,'DELETE',{expectedVersion:issue.version,confirmed:true});
  expect(erased.status,await erased.clone().text()).toBe(200);
  expect((await env.DB.prepare('SELECT * FROM comment_drafts WHERE issue_id=?').bind(issue.id).all()).results).toEqual([]);
  expect((await f.call(target+'/comment-drafts','POST',{id:guest.id,body:text})).status).toBe(404);
}

