import {env} from 'cloudflare:workers';
import {expect} from 'vitest';
import {ApiError, VectorClient} from '../../sdk/client';
import {intake} from '../../sdk/examples/intake';
import {bindings, origin} from './base-auth-fixture';
import type {setupIntegrations} from './integration-fixture';

/** Consumer code uses the generated client against the mounted application. */
export async function sdkIntakeJourney(f: Awaited<ReturnType<typeof setupIntegrations>>) {
  const issued = await f.issueToken(['issues:read', 'issues:write', 'comments:read', 'comments:write'], 'synthetic-vector-5134');
  const read = await f.issueToken(['issues:read'], 'synthetic-vector-5135');
  const transport: typeof fetch = (url, init) => f.app.request(String(url), init, bindings);
  const client = new VectorClient({baseUrl:origin, token:issued.token, fetch:transport});
  const title = 'synthetic-vector-5134: intake + exact title';
  const input = {teamId:f.initial.teams[0].id, title};
  const issue = await intake(client, input);
  expect(issue.title).toBe(title);
  expect(issue.identifier).toMatch(/^BASE-[1-9][0-9]*$/);
  expect(await env.DB.prepare('SELECT identifier, title FROM issues WHERE id=?').bind(issue.id).first()).toEqual({identifier:issue.identifier, title});
  f.restart();
  const persisted = (await client.request('issues_get_4', {path:{identifier:issue.identifier}})).data;
  expect(persisted).toMatchObject(issue);

  // Typed path and body data also survive the generated comment operations.
  const comment = (await client.request('comments_create_10', {path:{identifier:issue.identifier}, body:{body:'synthetic-vector-5135'}})).data as {id:string};
  const projection = (await client.request('comments_get_13', {path:{id:comment.id}})).data;
  expect(projection.body).toBe('synthetic-vector-5135');
  expect(projection.issueIdentifier).toBe(issue.identifier);

  await intake(client, {...input, title:'synthetic-vector-5136'});
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = (await client.request('issues_list_2', {query:{q:'synthetic-vector-513', limit:1, cursor}})).data;
    expect(page.total).toBe(2);
    expect(page.issues).toHaveLength(1);
    ids.push(page.issues![0].identifier as string);
    expect(page.nextCursor === null || typeof page.nextCursor === 'string').toBe(true);
    cursor = page.nextCursor as string | undefined;
  } while (cursor);
  expect(new Set(ids).size).toBe(2);
  expect(ids).toContain(issue.identifier);
  const before = (await env.DB.prepare('SELECT * FROM issues ORDER BY id').all()).results;
  const refused = async (run: () => Promise<unknown>, status: number, code: string) => {
    const error = await run().then(() => null, error => error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(status);
    expect(error.body).toMatchObject({error:code});
    expect(error.message).not.toContain(issued.token);
    expect((await env.DB.prepare('SELECT * FROM issues ORDER BY id').all()).results).toEqual(before);
  };
  const reader = new VectorClient({baseUrl:origin, token:read.token, fetch:transport});
  await refused(() => intake(reader, {...input, title:'synthetic-vector-5137'}), 401, 'token_scope_or_authority_refused');
  await refused(() => client.request('issues_update_5', {path:{identifier:issue.identifier}, body:{expectedVersion:Number(persisted.version) + 1, title:'synthetic-vector-5138'}}), 409, 'stale_version');
  await refused(() => client.request('issues_list_2', {query:{limit:0}}), 400, 'invalid_request');
  expect((await f.call('/settings/integrations/tokens/' + issued.credential.id, 'DELETE')).status).toBe(200);
  await refused(() => client.request('issues_get_4', {path:{identifier:issue.identifier}}), 401, 'token_scope_or_authority_refused');
}
