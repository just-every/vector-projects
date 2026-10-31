import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {devKey} from '../dev-gate.mjs';

/** Runs the shipped example against an actual local Worker and persisted D1. */
export async function exerciseSdkIntake({runtime, cookie, team}) {
  const {VectorClient, ApiError} = await import(pathToFileURL(resolve('sdk/dist/client.js')).href);
  const call = async (path, method='GET', body, status=200) => {
    const response = await runtime.req('/api' + path, {method, headers:{Cookie:cookie, Origin:runtime.base, 'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body)});
    assert.equal(response.status, status);
    return response.json();
  };
  const issued = await call('/settings/integrations/tokens', 'POST', {name:'synthetic-vector-5140', scopes:['issues:read', 'issues:write']}, 201);
  const read = await call('/settings/integrations/tokens', 'POST', {name:'synthetic-vector-5141', scopes:['issues:read']}, 201);
  const title = 'synthetic-vector-5142: local SDK intake';
  const output = execFileSync(process.execPath, ['sdk/examples/run-intake.mjs'], {
    encoding:'utf8', timeout:30_000,
    env:{...process.env, VECTOR_URL:runtime.base, VECTOR_API_TOKEN:issued.token, VECTOR_DEV_KEY:devKey, VECTOR_TEAM_ID:team.id, VECTOR_TITLE:title},
  });
  // Never pass credential strings to assertion diagnostics.
  assert.equal(output.includes(issued.token), false, 'example output excludes credentials');
  const issue = JSON.parse(output);
  assert.equal(issue.title, title);
  assert.match(issue.identifier, /^[A-Z]{2,10}-[1-9][0-9]*$/);
  assert.deepEqual(runtime.sql("SELECT identifier, title FROM issues WHERE id='" + issue.id.replaceAll("'", "''") + "'").map(row => ({...row})), [{identifier:issue.identifier, title}]);
  const options = {baseUrl:runtime.base, token:issued.token, headers:{'x-rer-dev-key':devKey}};
  const client = new VectorClient(options);
  const saved = (await client.request('issues_get_4', {path:{identifier:issue.identifier}})).data;
  assert.equal(saved.id, issue.id);
  assert.equal(saved.title, title);
  const before = runtime.sql('SELECT id, title, version FROM issues ORDER BY id');
  const refused = async (run, status, code) => {
    const error = await run().then(() => null, error => error);
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, status);
    assert.equal(error.body.error, code);
    assert.equal(error.message.includes(issued.token), false, 'errors exclude request credentials');
    assert.deepEqual(runtime.sql('SELECT id, title, version FROM issues ORDER BY id'), before);
  };
  const reader = new VectorClient({...options, token:read.token});
  await refused(() => reader.request('issues_create_3', {body:{teamId:team.id, title:'synthetic-vector-5143'}}), 401, 'token_scope_or_authority_refused');
  await refused(() => client.request('issues_update_5', {path:{identifier:issue.identifier}, body:{expectedVersion:saved.version + 1, title:'synthetic-vector-5144'}}), 409, 'stale_version');
  await call('/settings/integrations/tokens/' + issued.credential.id, 'DELETE');
  await refused(() => client.request('issues_get_4', {path:{identifier:issue.identifier}}), 401, 'token_scope_or_authority_refused');
  await call('/settings/integrations/tokens/' + read.credential.id, 'DELETE');
  console.log('API-005 local compiled intake example: persisted title and identifier, insufficient scope, stale write and revocation passed.');
}
