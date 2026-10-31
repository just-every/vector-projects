import { expect, it, vi } from 'vitest';
import { createServerApp } from '../../src/core/app/server';
import { agentResponse } from '../../src/core/features/agent-door/runtime';
import { setupAdministration } from './administration-fixture';
import { actor, bindings, invite, origin, request } from './base-auth-fixture';
import { snapshot } from './role-fixture';

it('a named person approves the saved native issue edit once, while changed, rejected and expired requests have no effect', async () => {
  const f = await setupAdministration();
  const memberCookie = await invite(['synthetic-vector-7001', 'vector.test'].join('@'), f.cookie, 'member');
  const approverCookie = await invite(['synthetic-vector-7002', 'vector.test'].join('@'), f.cookie, 'member');
  const member = await actor(memberCookie), approver = await actor(approverCookie);
  expect(member).not.toBe(approver);
  const minted = await request('/api/settings/integrations/tokens', 'POST', { name: 'synthetic-vector-7003', scopes: ['issues:write'] }, memberCookie);
  expect(minted.status).toBe(201);
  const { token } = await minted.json() as { token: string };
  const app = createServerApp();
  const send = async (path: string, method = 'GET', body?: unknown, cookie = f.cookie, extra: Record<string, string> = {}) => {
    const req = new Request(origin + path, { method, headers: { Host: new URL(origin).host, Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    return await agentResponse(bindings, req) ?? app.request(req, undefined, bindings);
  };
  const json = async (response: Response, status = 200): Promise<any> => {
    expect(response.status, await response.clone().text()).toBe(status);
    return response.json();
  };
  const policy = await json(await send('/agents/api/policy', 'PUT', { document: {
    schema: 'rer-agent-policy/1', catalogue: 'rer-agent-classes/1',
    rules: [{ id: 'native-edit', class: '*', do: 'approval', approver: ['person:' + approver], wait: 'P1D' }], spend: { none: true },
  } }));
  const issue = await f.create({ title: 'synthetic-vector-7004' });
  const nativeTables = ['issues', 'issue_activity'];
  const native = () => snapshot(nativeTables);
  const read = async () => json(await f.call('/issues/' + issue.identifier));
  let rpcId = 0;
  const call = async (args: Record<string, unknown>) => {
    const body = await json(await send('/mcp', 'POST', { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: {
      name: 'vector.issue.concurrent_edits', arguments: args,
      _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': { elicitation: { url: {} } } },
    } }, '', { Authorization: 'Bearer ' + token, Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': 'vector.issue.concurrent_edits' }));
    expect(body.error).toBeUndefined();
    return body.result;
  };
  const args = (title: string, version = issue.version) => ({ identifier: issue.identifier, expected_revision: version, change: { expectedVersion: version, title }, idempotency_key: crypto.randomUUID() });
  const prepare = async (input: Record<string, unknown>) => {
    const before = await native(), result = await call(input);
    expect(result.resultType).toBe('input_required');
    expect(result.requestState).toEqual(expect.any(String));
    const handle = result._meta['com.runeditrun/approval'];
    expect(result.inputRequests.approval).toMatchObject({ method: 'elicitation/create', params: { mode: 'url', url: handle.url } });
    expect(handle.url).toBe(origin + '/agents/approvals/' + handle.id);
    const { approval } = await json(await send('/agents/api/approvals/' + handle.id, 'GET', undefined, approverCookie));
    expect(approval).toMatchObject({ id: handle.id, state: 'pending', revision: policy.revision,
      classes: [{ class: 'standard', facts: { measure: 1 } }], approvers: ['person:' + approver], approvals: [],
      summary: { nativeTarget: { kind: 'issue', id: issue.id }, target: { id: issue.identifier }, items: ['title: ' + (input.change as any).title] },
      prepared_by: { for: { id: member }, agent: { name: 'synthetic-vector-7003' } },
    });
    expect(Date.parse(approval.expires_at) - Date.now()).toBe(86_400_000);
    expect(await native()).toEqual(before);
    return { approval, result, input, path: '/agents/api/approvals/' + handle.id };
  };
  const evidence = (approval: any) => ({ revision: approval.revision, summary_sha256: approval.summary_sha256 });
  // Freeze the pipeline's clock without rewriting policy, pending actions or native rows.
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  try {
    const initial = await native(), pending = await prepare(args('synthetic-vector-7005'));
    for (const cookie of [memberCookie, f.cookie]) {
      await json(await send(pending.path + '/approve', 'POST', evidence(pending.approval), cookie), 403);
    }
    await json(await send(pending.path + '/approve', 'POST', evidence(pending.approval), '', { Authorization: 'Bearer ' + token }), 403);
    await json(await send(pending.path + '/approve', 'POST', { ...evidence(pending.approval), summary_sha256: 'synthetic-vector-7006' }, approverCookie), 409).then(body => expect(body.code).toBe('approval_summary_mismatch'));
    await json(await send(pending.path + '/approve', 'POST', { ...evidence(pending.approval), revision: policy.revision + 1 }, approverCookie), 409).then(body => expect(body.code).toBe('revision_conflict'));
    expect((await json(await send(pending.path, 'GET', undefined, approverCookie))).approval.approvals).toEqual([]);
    expect(await native()).toEqual(initial);
    const approved = await json(await send(pending.path + '/approve', 'POST', evidence(pending.approval), approverCookie));
    expect(approved.approval).toMatchObject({ state: 'executed', approvals: [{ person: approver }] });
    const retry = await call(pending.input), receipt = retry._meta['com.runeditrun/receipt'];
    expect(retry.isError).toBe(false);
    expect(retry.structuredContent).toMatchObject({ id: issue.id, identifier: issue.identifier, version: issue.version + 1 });
    expect(receipt).toMatchObject({ approval_id: pending.approval.id, decision_id: pending.approval.decision_id, approved_by: [approver], prepared_by: { for: { id: member } } });
    expect((await read()).title).toBe('synthetic-vector-7005');
    const after = await native();
    expect(after.issue_activity.length).toBe(initial.issue_activity.length + 1);
    const activity = after.issue_activity.at(-1) as any;
    expect(activity).toMatchObject({ agent_id: receipt.prepared_by.agent.id, agent_operation_id: pending.approval.decision_id });
    expect(JSON.parse(activity.agent_approvers_json)).toEqual([{ id: approver }]);
    await json(await send(pending.path + '/approve', 'POST', evidence(pending.approval), approverCookie));
    const replay = await call(pending.input);
    expect(replay._meta['com.runeditrun/receipt'].id).toBe(receipt.id);
    expect(await native()).toEqual(after);
    const audit = await json(await send('/agents/api/audit'));
    const decision = audit.rows.find((row: any) => row.id === pending.approval.decision_id);
    const execution = audit.rows.find((row: any) => row.decision_id === pending.approval.decision_id && row.outcome === 'done');
    expect(decision).toMatchObject({ decision: 'approval', outcome: 'pending', approval: { id: pending.approval.id, by: [approver] }, classes: [{ class: 'standard', facts: { measure: 1 } }] });
    expect(execution).toMatchObject({ operation_id: activity.agent_operation_id, sponsor: { id: member }, approval: { id: pending.approval.id, by: [approver] }, resource: { kind: 'issue', id: issue.id } });
    expect(audit.differs_from_policy).toBe(0);

    const changed = { ...pending.input, expected_revision: issue.version + 1, change: { expectedVersion: issue.version + 1, title: 'synthetic-vector-7007' } };
    expect((await call(changed))._meta['com.runeditrun/error'].code).toBe('idempotency_conflict');
    expect(await native()).toEqual(after);
    const fresh = await prepare({ ...changed, idempotency_key: crypto.randomUUID() });
    expect(fresh.approval.id).not.toBe(pending.approval.id);
    expect(fresh.approval.summary_sha256).not.toBe(pending.approval.summary_sha256);
    await json(await send(fresh.path + '/reject', 'POST', evidence(fresh.approval), approverCookie));
    expect((await call(fresh.input))._meta['com.runeditrun/error'].code).toBe('approval_rejected');
    expect(await native()).toEqual(after);

    const stale = await prepare(args('synthetic-vector-7009', issue.version + 1));
    expect((await f.call('/issues/' + issue.identifier, 'PATCH', { expectedVersion: issue.version + 1, title: 'synthetic-vector-7016' })).status).toBe(200);
    const concurrent = await native();
    const staleApproval = await json(await send(stale.path + '/approve', 'POST', evidence(stale.approval), approverCookie));
    expect(staleApproval.approval).toMatchObject({ state: 'refused', code: 'revision_conflict' });
    expect((await call(stale.input))._meta['com.runeditrun/error'].code).toBe('revision_conflict');
    expect(await native()).toEqual(concurrent);

    const expired = await prepare(args('synthetic-vector-7008', issue.version + 2));
    clock.mockReturnValue(Date.parse(expired.approval.expires_at) + 1);
    const expiry = await json(await send(expired.path + '/approve', 'POST', evidence(expired.approval), approverCookie), 409);
    expect(expiry.code).toBe('approval_expired');
    expect((await call(expired.input))._meta['com.runeditrun/error'].code).toBe('approval_expired');
    expect(await native()).toEqual(concurrent);
  } finally { clock.mockRestore(); }
});
