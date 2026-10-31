import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {devKey} from '../dev-gate.mjs';
import {withSdkPackage} from './sdk-package.mjs';

/** Runs the shipped example against an actual local Worker and persisted D1. */
export async function exerciseSdkIntake({runtime, cookie, team}) {
 return withSdkPackage(runtime, async packageDirectory => {
  const {VectorClient, ApiError} = await import(pathToFileURL(resolve('sdk/dist/client.js')).href);
  const call = async (path, method='GET', body, status=200) => {
    const response = await runtime.req('/api' + path, {method, headers:{Cookie:cookie, Origin:runtime.base, 'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body)});
    assert.equal(response.status, status);
    return response.json();
  };
  const issued = await call('/settings/integrations/tokens', 'POST', {name:'synthetic-vector-5140', scopes:['issues:read', 'issues:write']}, 201);
  const read = await call('/settings/integrations/tokens', 'POST', {name:'synthetic-vector-5141', scopes:['issues:read']}, 201);
  const title = 'synthetic-vector-5142: local SDK intake';
  const example = (name, credential, extra={}) => execFileSync(process.execPath, [resolve(packageDirectory, 'examples', name)], {
    encoding:'utf8', timeout:30_000, stdio:['ignore','pipe','pipe'],
    env:{...process.env, VECTOR_URL:runtime.base, VECTOR_API_TOKEN:credential, VECTOR_DEV_KEY:devKey, VECTOR_TEAM_ID:team.id, ...extra},
  });
  const output = example('run-intake.mjs', issued.token, {VECTOR_TITLE:title});
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
  const second = JSON.parse(example('run-intake.mjs', issued.token, {VECTOR_TITLE:'synthetic-vector-5142: second page'}));
  const refresh = () => JSON.parse(example('run-sync.mjs', read.token, {VECTOR_QUERY:'synthetic-vector-5142'})).issues;
  assert.deepEqual(refresh().map(row => row.identifier).sort(), [issue.identifier, second.identifier].sort());
  await client.request('issues_update_5', {path:{identifier:issue.identifier}, body:{expectedVersion:saved.version, title:title + ' updated'}});
  assert.equal(refresh().find(row => row.id === issue.id).title, title + ' updated');
  const contextToken = await call('/settings/integrations/tokens', 'POST', {name:'synthetic-vector-5145', scopes:['issues:read','comments:read']}, 201);
  await call('/issues/' + issue.identifier + '/comments', 'POST', {body:'synthetic-vector-5146'}, 201);
  await call('/issues/' + issue.identifier + '/comments', 'POST', {body:'synthetic-vector-5147'}, 201);
  const context = JSON.parse(example('run-agent.mjs', contextToken.token, {VECTOR_ISSUE:issue.identifier}));
  assert.equal(context.issue.id, issue.id);
  assert.equal(context.issue.title, title + ' updated');
  assert.deepEqual(context.comments.map(row => row.body).sort(), ['synthetic-vector-5146','synthetic-vector-5147']);
  const failedExample = (name, credential, extra) => {
    let failure;
    try { example(name, credential, extra); } catch (error) { failure = error; }
    assert.equal(failure?.status, 1);
    assert.equal(String(failure.stdout), '', 'a refused example emits no partial content');
    assert.equal(String(failure.stderr).includes(credential), false, 'no credential enters diagnostics');
  };
  failedExample('run-agent.mjs', read.token, {VECTOR_ISSUE:issue.identifier});
  await call('/issues/' + second.identifier, 'DELETE', {expectedVersion:1, confirmed:true});
  assert.deepEqual(refresh().map(row => row.id), [issue.id], 'a new full snapshot drops erased records');
  failedExample('run-agent.mjs', contextToken.token, {VECTOR_ISSUE:second.identifier});
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
  await refused(() => client.request('issues_update_5', {path:{identifier:issue.identifier}, body:{expectedVersion:saved.version, title:'synthetic-vector-5144'}}), 409, 'stale_version');
  const contextClient = new VectorClient({...options, token:contextToken.token});
  await refused(() => contextClient.request('issues_update_5', {path:{identifier:issue.identifier}, body:{expectedVersion:saved.version + 1, title:'synthetic-vector-5144'}}), 401, 'token_scope_or_authority_refused');
  await call('/settings/integrations/tokens/' + issued.credential.id, 'DELETE');
  await refused(() => client.request('issues_get_4', {path:{identifier:issue.identifier}}), 401, 'token_scope_or_authority_refused');
  await call('/settings/integrations/tokens/' + read.credential.id, 'DELETE');
  failedExample('run-sync.mjs', read.token, {VECTOR_QUERY:'synthetic-vector-5142'});
  await call('/settings/integrations/tokens/' + contextToken.credential.id, 'DELETE');
  failedExample('run-agent.mjs', contextToken.token, {VECTOR_ISSUE:issue.identifier});
  assert.deepEqual(runtime.sql('SELECT id, title, version FROM issues ORDER BY id'), before);
  console.log('API-005 packaged intake, paginated sync and read-only agent examples: public release download, persisted readback, refresh, erasure, scope, stale write and revocation passed.');
 });
}
