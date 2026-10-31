import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { withOperatorClient } from './operator-request.mjs';
import { readDevelopmentLink } from './outbox-session.mjs';
import { beforePrivateNavigation, settleReads } from './collaboration-navigation.mjs';

/** A real Member prepares native work; another signed-in Member decides it. */
export async function agentApprovalJourney(ownerPage, ownerContext, base, state, evidence, record) {
  const contexts = [];
  const json = async (context, path, method = 'GET', data, status = 200) => withOperatorClient(context, async client => {
    const response = await client.fetch(base + path, { method, headers: { Origin: base }, ...(data === undefined ? {} : { data }) });
    assert.equal(response.status(), status, path + ': ' + await response.text());
    return response.json();
  });
  const invite = async number => {
    const email = ['synthetic-vector-' + number + '-' + Date.now(), 'vector.test'].join('@');
    await json(ownerContext, '/api/settings/operators/invite', 'POST', { email, displayName: 'synthetic-vector-' + number, role: 'member' }, 202);
    const context = await ownerContext.browser().newContext({ viewport: { width: 1440, height: 1000 } });
    contexts.push(context);
    const page = await context.newPage();
    await page.goto(await readDevelopmentLink(base, ownerContext.request, email, state));
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.waitForURL(base + '/app');
    await settleReads(page);
    return { context, page, id: (await json(context, '/api/session')).operatorId };
  };
  try {
    await beforePrivateNavigation(ownerPage, base + '/agents');
    await ownerPage.goto(base + '/agents');
    const sponsor = await invite(7010), approver = await invite(7011);
    assert.notEqual(sponsor.id, approver.id);
    const policy = await json(ownerContext, '/agents/api/policy', 'PUT', { document: {
      schema: 'rer-agent-policy/1', catalogue: 'rer-agent-classes/1',
      rules: [{ id: 'native-edit', class: '*', do: 'approval', approver: ['person:' + approver.id], wait: 'P1D' }], spend: { none: true },
    } });
    const options = await json(ownerContext, '/api/options');
    const issue = await json(sponsor.context, '/api/issues', 'POST', { teamId: options.teams[0].id, title: 'synthetic-vector-7012' }, 201);
    const { token } = await json(sponsor.context, '/api/settings/integrations/tokens', 'POST', { name: 'synthetic-vector-7013', scopes: ['issues:write'] }, 201);
    let id = 0;
    const call = async args => withOperatorClient(sponsor.context, async client => {
      const response = await client.post(base + '/mcp', { headers: { Origin: base, Authorization: 'Bearer ' + token, Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': 'vector.issue.concurrent_edits' }, data: {
        jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'vector.issue.concurrent_edits', arguments: args,
          _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': { elicitation: { url: {} } } } },
      } });
      assert.equal(response.status(), 200);
      const body = await response.json();
      assert.equal(body.error, undefined);
      return body.result;
    });
    const input = { identifier: issue.identifier, expected_revision: issue.version, change: { expectedVersion: issue.version, title: 'synthetic-vector-7014' }, idempotency_key: crypto.randomUUID() };
    const pending = await call(input), handle = pending._meta['com.runeditrun/approval'];
    assert.equal(pending.resultType, 'input_required');
    assert.ok(pending.requestState);
    assert.equal(pending.inputRequests.approval.params.mode, 'url');
    assert.equal(pending.inputRequests.approval.params.url, handle.url);
    assert.equal((await json(sponsor.context, '/api/issues/' + issue.identifier)).title, 'synthetic-vector-7012');
    const { approval } = await json(approver.context, '/agents/api/approvals/' + handle.id);
    assert.equal(approval.revision, policy.revision);
    assert.deepEqual(approval.classes, [{ class: 'standard', facts: { measure: 1 } }]);
    assert.equal(approval.summary.nativeTarget.id, issue.id);
    assert.deepEqual(approval.summary.items, ['title: synthetic-vector-7014']);
    assert.ok(Date.parse(approval.expires_at) > Date.now());
    await sponsor.page.goto(handle.url);
    assert.equal(await sponsor.page.getByRole('button', { name: 'Approve', exact: true }).count(), 0, 'the sponsoring Member cannot decide');
    const page = approver.page, pageErrors = [], consoleErrors = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(handle.url);
    await page.getByRole('button', { name: 'Approve', exact: true }).waitFor();
    assert.match(await page.locator('[data-approval-summary]').innerText(), /synthetic-vector-7014/);
    assert.equal(await page.locator('time[datetime="' + approval.expires_at + '"]').count(), 1);
    await page.getByText('Details', { exact: true }).click();
    assert.match(await page.locator('main').innerText(), /synthetic-vector-7011/);
    const require = createRequire(import.meta.url), axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
    await page.evaluate(source => {
      const script = document.createElement('script');
      script.nonce = document.querySelector('script[nonce]')?.nonce ?? '';
      script.textContent = source; document.head.append(script);
    }, axeSource);
    const violations = await page.evaluate(async () => (await window.axe.run()).violations.filter(row => ['serious', 'critical'].includes(row.impact)).map(row => row.id));
    assert.deepEqual(violations, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'approval page has no horizontal overflow');
    const approve = page.getByRole('button', { name: 'Approve', exact: true });
    await approve.focus();
    assert.equal(await approve.evaluate(element => document.activeElement === element), true);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({ path: evidence + '/agent-approval-' + width + '.png', fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await approve.focus();
    const approvedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/agents/api/approvals/' + handle.id + '/approve');
    await approve.press('Enter');
    assert.equal((await approvedResponse).status(), 200);
    await page.locator('[data-approval-state="executed"]').waitFor();
    const result = await call(input), receipt = result._meta['com.runeditrun/receipt'];
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.version, issue.version + 1);
    assert.equal(receipt.approval_id, handle.id);
    assert.deepEqual(receipt.approved_by, [approver.id]);
    const edited = await json(sponsor.context, '/api/issues/' + issue.identifier);
    assert.equal(edited.title, input.change.title);
    assert.equal((await call(input))._meta['com.runeditrun/receipt'].id, receipt.id);
    await json(approver.context, '/agents/api/approvals/' + handle.id + '/approve', 'POST', { revision: approval.revision, summary_sha256: approval.summary_sha256 });
    assert.deepEqual(await json(sponsor.context, '/api/issues/' + issue.identifier), edited, 'repeated approval and retry create no second native effect');
    const changed = { ...input, expected_revision: edited.version, change: { expectedVersion: edited.version, title: 'synthetic-vector-7015' } };
    assert.equal((await call(changed))._meta['com.runeditrun/error'].code, 'idempotency_conflict');
    const freshInput = { ...changed, idempotency_key: crypto.randomUUID() }, fresh = await call(freshInput);
    const freshHandle = fresh._meta['com.runeditrun/approval'];
    assert.equal(fresh.resultType, 'input_required');
    assert.notEqual(freshHandle.id, handle.id);
    await page.goto(freshHandle.url);
    const declined = page.waitForResponse(response => new URL(response.url()).pathname === '/agents/api/approvals/' + freshHandle.id + '/reject');
    await page.getByRole('button', { name: 'Decline', exact: true }).click();
    assert.equal((await declined).status(), 200);
    await page.locator('[data-approval-state="rejected"]').waitFor();
    assert.equal((await call(freshInput))._meta['com.runeditrun/error'].code, 'approval_rejected');
    assert.deepEqual(await json(sponsor.context, '/api/issues/' + issue.identifier), edited);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleErrors, []);
    record('BASE-AGENT-007', 'Named approver browser decides the saved revision; URL elicitation, native edit, stable receipt, fresh changed-input approval and rejection verified; approval page captured at 1440 and 390.');
  } finally {
    for (const context of contexts) await context.close();
  }
}
