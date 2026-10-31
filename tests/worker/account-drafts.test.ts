import { createUlid } from '../../src/core/shared/ids';
import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { collaborationFixture } from './collaboration-fixture';
import { bindings, origin, request, signIn } from './base-auth-fixture';
import { heldBody } from './removal-fixture';
import { createServerApp } from '../../src/core/app/server';
import { emptyNewIssueDraft } from '../../src/core/features/issues/ui/new-issue-draft';
import type { AccountDraft } from '../../src/core/features/drafts/schema';

async function json<T>(response: Response, status = 200): Promise<T> {
  expect(response.status, await response.clone().text()).toBe(status);
  return response.json() as Promise<T>;
}

it('[ISSUE-028] private account drafts survive independent sessions, reconcile competing saves and are consumed atomically without resurrection', async () => {
  const f = await collaborationFixture(), team = f.initial.teams[0];
  for (const name of ['synthetic-vector-2801', 'synthetic-vector-2802'])
    await f.mutate('/settings/labels', 'POST', { name, color: '#405080' });
  const labelIds = (await f.state()).labels.filter(row => row.name.startsWith('synthetic-vector-280')).map(row => row.id);
  expect(labelIds).toHaveLength(2);
  const values = { ...emptyNewIssueDraft, teamId: team.id, title: 'synthetic-vector-2803', labelIds };
  const first = (await json<{ draft: AccountDraft }>(await f.call('/drafts', 'POST', { values }), 201)).draft;
  expect(first).toMatchObject({ values, team: team.name, revision: 1 });
  expect(Number.isFinite(Date.parse(first.updatedAt))).toBe(true);
  const secondSession = await signIn(); expect(secondSession).not.toBe(f.cookie);
  expect((await json<{ drafts: AccountDraft[] }>(await f.any(secondSession, '/drafts'))).drafts).toEqual([first]);
  expect((await json<{ draft: AccountDraft }>(await f.any(secondSession, '/drafts/' + first.id))).draft).toEqual(first);
  const path = '/drafts/' + first.id;
  const later = { ...values, title: 'synthetic-vector-2804', description: 'Newer account text' };
  const updated = (await json<{ draft: AccountDraft }>(await f.any(secondSession, path, 'PATCH', { revision: 1, values: later }))).draft;
  expect(updated.revision).toBe(2);
  const stale = await json<{ draft: AccountDraft }>(await f.call(path, 'PATCH', { revision: 1, values }), 409);
  expect(stale.draft.values).toEqual(later);
  const rows = () => env.DB.prepare('SELECT * FROM issue_drafts ORDER BY id').all();
  const before = (await rows()).results;
  expect((await f.any(f.bobCookie, '/drafts')).status).toBe(200);
  expect((await json<{ drafts: AccountDraft[] }>(await f.any(f.bobCookie, '/drafts'))).drafts).toEqual([]);
  expect((await f.any(f.bobCookie, path)).status).toBe(404);
  expect((await f.any(f.bobCookie, path, 'PATCH', { revision: 2, values: later })).status).toBe(409);
  expect((await f.any(f.bobCookie, path, 'DELETE', { revision: 2 })).status).toBe(409);
  for (const route of ['/search?q=' + values.title, '/issues?q=' + values.title])
    expect(JSON.stringify(await f.data(f.bobCookie, route))).not.toContain(values.title);
  const token = await json<{ token: string }>(await f.any(f.bobCookie, '/settings/integrations/tokens', 'POST', { name: 'synthetic-vector-2805', scopes: ['issues:read'] }), 201);
  for (const route of ['/drafts', '/issues?q=' + values.title]) {
    const response = await createServerApp().request(origin + '/api/v1' + route, { headers: { Authorization: 'Bearer ' + token.token } }, bindings);
    expect(await response.text()).not.toContain(values.title);
  }
  expect((await rows()).results).toEqual(before);
  const submit = (cookie: string, title = later.title, revision = 2) => createServerApp().request(origin + '/api/issues', {
    method: 'POST', headers: { Host: new URL(origin).host, Cookie: cookie, Origin: origin, 'content-type': 'application/json',
      'x-vector-draft-id': first.id, 'x-vector-draft-revision': String(revision) },
    body: JSON.stringify({ teamId: team.id, title, description: later.description, labelIds }),
  }, bindings);
  expect((await submit(f.bobCookie)).status).toBe(409);
  await env.DB.prepare("CREATE TRIGGER synthetic_draft_rollback BEFORE INSERT ON issues WHEN NEW.title='synthetic-vector-2806' BEGIN SELECT RAISE(ABORT,'synthetic draft rollback'); END").run();
  try { expect((await submit(secondSession, 'synthetic-vector-2806')).status).toBe(500); }
  finally { await env.DB.prepare('DROP TRIGGER synthetic_draft_rollback').run(); }
  expect((await rows()).results).toEqual(before);
  expect(await env.DB.prepare('SELECT count(*) n FROM issues WHERE title=?').bind('synthetic-vector-2806').first<number>('n')).toBe(0);
  const issue = await json<{ title: string; labels: { id: string }[] }>(await submit(secondSession), 201);
  expect(issue.title).toBe(later.title); expect(issue.labels.map(row => row.id).sort()).toEqual([...labelIds].sort());
  for (const cookie of [f.cookie, secondSession]) expect((await json<{ drafts: AccountDraft[] }>(await f.any(cookie, '/drafts'))).drafts).toEqual([]);
  expect((await submit(secondSession)).status).toBe(409);
  expect((await f.call(path, 'PATCH', { revision: 2, values })).status).toBe(409);
  expect(await env.DB.prepare('SELECT body_json FROM issue_drafts WHERE id=?').bind(first.id).first('body_json')).toBeNull();
  const discard = (await json<{ draft: AccountDraft }>(await f.call('/drafts', 'POST', { values }), 201)).draft;
  expect((await f.any(secondSession, '/drafts/' + discard.id, 'DELETE', { revision: 1 })).status).toBe(200);
  expect((await f.call('/drafts/' + discard.id, 'PATCH', { revision: 1, values })).status).toBe(409);
  expect((await json<{ drafts: AccountDraft[] }>(await f.call('/drafts'))).drafts).toEqual([]);
  // Revoking a captured session while its body arrives cannot save anything.
  const revoked = await signIn(), held = heldBody();
  const pending = createServerApp().request(origin + '/api/drafts', { method: 'POST',
    headers: { Host: new URL(origin).host, Cookie: revoked, Origin: origin, 'content-type': 'application/json' }, body: held.body }, bindings);
  await Promise.race([held.reading, pending.then(r => { throw Error('Body not reached: ' + r.status); })]);
  expect((await request('/auth/signout', 'POST', {}, revoked)).status).toBe(204);
  const afterRevocation = (await rows()).results;
  held.release(JSON.stringify({ values }));
  expect((await pending).status).toBe(401); expect((await rows()).results).toEqual(afterRevocation);
  // Current creation authority also governs saving drafts, including invited Guests.
  await env.DB.prepare("UPDATE operators SET role='viewer' WHERE id=?").bind(f.bob).run();
  expect((await f.any(f.bobCookie, '/drafts', 'POST', { values })).status).toBe(403);
  expect((await rows()).results).toEqual(afterRevocation);
  await env.DB.prepare("UPDATE operators SET role='guest' WHERE id=?").bind(f.bob).run();
  await env.DB.prepare('DELETE FROM team_members WHERE operator_id=?').bind(f.bob).run();
  expect((await f.any(f.bobCookie, '/drafts', 'POST', { values })).status).toBe(404);
  await env.DB.prepare("INSERT INTO team_members(team_id,operator_id,role,created_at,updated_at) VALUES(?,?,'member',?,?)").bind(team.id, f.bob, new Date().toISOString(), new Date().toISOString()).run();
  const guest = (await json<{ draft: AccountDraft }>(await f.any(f.bobCookie, '/drafts', 'POST', { values }), 201)).draft;
  await env.DB.prepare('DELETE FROM team_members WHERE operator_id=?').bind(f.bob).run();
  expect((await f.any(f.bobCookie, '/drafts/' + guest.id)).status).toBe(404);
  const guestState = (await rows()).results;
  expect([403,404]).toContain((await f.any(f.bobCookie, '/drafts/' + guest.id, 'PATCH', { values, revision: 1 })).status);
  expect((await rows()).results).toEqual(guestState);
  await env.DB.prepare("UPDATE operators SET role='member' WHERE id=?").bind(f.bob).run();
  const own=(await json<{draft:AccountDraft}>(await f.any(f.bobCookie,'/drafts','POST',{values}),201)).draft;
  const workspace=createUlid(new Date());
  await env.DB.prepare('INSERT INTO workspace_settings(id,name,timezone,created_at,updated_at) SELECT ?,name,timezone,created_at,updated_at FROM workspace_settings LIMIT 1').bind(workspace).run();
  await env.DB.prepare('UPDATE operators SET workspace_id=? WHERE id=?').bind(workspace,f.bob).run();
  const moved=(await rows()).results;
  expect((await json<{drafts:AccountDraft[]}>(await f.any(f.bobCookie,'/drafts'))).drafts).toEqual([]);
  expect((await f.any(f.bobCookie,'/drafts/'+own.id)).status).toBe(404);
  expect((await f.any(f.bobCookie,'/drafts/'+own.id,'PATCH',{values,revision:1})).status).toBe(409);
  expect((await rows()).results).toEqual(moved);

}, 120_000);
