import { withOperatorClient } from './operator-request.mjs';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { verificationDirectory } from '../../scripts/verification-paths.mjs';
import { subscriptionsJourney } from './subscriptions-journey.mjs';
import { beforePrivateNavigation, settleReads } from './collaboration-navigation.mjs';

// Two genuine native sessions, with signed source input only at the network edge.
export async function followerJourney(actorPage, actorContext, inboxPage, recipientContext, base, record) {
  const api = context => async (path, method = 'GET', data, expected = 200) => {
    return withOperatorClient(context, async client => {
      const response = await client.fetch(base + '/api' + path, {
        method, headers: { Origin: base, Connection: "close" }, ...(data === undefined ? {} : { data }),
      });
      assert.equal(response.status(), expected, `${method} ${path}`);
      return await response.json();
    });
  };
  const recipient = api(recipientContext), actor = api(actorContext);
  const actorOptions = await actor('/options');
  assert.notEqual(actorOptions.operator.id, (await recipient('/options')).operator.id, 'The action and Inbox belong to different members');
  const actorName = actorOptions.operators.find(row => row.id === actorOptions.operator.id).name;
  const originalViewport = inboxPage.viewportSize();
  for (const width of [1440, 390]) {
    await inboxPage.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await actorPage.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const suffix = [...randomBytes(7)].map(n => String.fromCharCode(65 + n % 26)).join('');
    const name = 'Payment follow-up ' + suffix;
    const teams = await recipient('/settings/teams', 'POST', { name, identifierPrefix: 'NF' + suffix });
    const team = teams.teams.find(row => row.name === name);
    const status = category => team.statuses.find(row => row.category === category);
    const ownerId = (await recipient('/options')).operator.id;
    const create = (title, changes = {}) => recipient('/issues', 'POST', { teamId: team.id, title, statusId: status('unstarted').id, ...changes }, 201);
    const completed = await create('Restore the checkout after a retry');
    const canceled = await create('Retire the old payment callback');
    const grouped = await create('Investigate urgent duplicate charges');
    const blocked = await create('Release the payment retry fix', { assigneeOperatorId: ownerId });
    const blocker = await create('Confirm the provider accepts idempotency keys');
    const configured = await recipient(`/settings/teams/${team.id}/statuses`, 'POST', { name: 'Verification', category: 'started' });
    const removed = configured.teams.find(row => row.id === team.id).statuses.find(row => row.name === 'Verification');
    const mapped = await create('Verify provider recovery', { statusId: removed.id });
    const source = await recipient('/settings/integrations/sources', 'POST', { name: 'Payment monitoring', sourceId: 'followup-' + suffix.toLowerCase(), teamId: team.id }, 201);
    const input = { teamId: team.id, title: 'Retry failures returned with new evidence', sourceRecordId: suffix, sourceRevisionId: 'first', observedAt: new Date().toISOString() };
    const revision = async body => {
      const text = JSON.stringify(body), id = randomUUID(), at = String(Math.floor(Date.now() / 1000));
      const signature = createHmac('sha256', Buffer.from(source.secret, 'hex')).update(JSON.stringify([
        'integrations.webhook.v1', source.workspaceId, source.sourceId, 'signal.revision', id, at, text,
      ])).digest('hex');
      const response = await fetch(source.receiver, { method: 'POST', headers: {
        'content-type': 'application/json', 'webhook-id': id, 'webhook-tenant': source.workspaceId,
        'webhook-destination': source.sourceId, 'webhook-event': 'signal.revision',
        'webhook-timestamp': at, 'webhook-signature': 'v1=' + signature,
      }, body: text });
      assert.equal(response.status, 200); return response.json();
    };
    const signal = await revision(input);
    const deferred = await recipient('/issues/' + signal.identifier + '/defer', 'POST', {
      expectedVersion: 1, returnAt: new Date(Date.now() + 3600000).toISOString(), reason: 'Wait for another provider observation',
    });
    await beforePrivateNavigation(inboxPage, base + '/app/inbox');
    await inboxPage.goto(base + '/app/inbox');
    await inboxPage.getByRole('heading', { name: 'Inbox', exact: true }).waitFor();
    const timeOrigin = await inboxPage.evaluate(() => performance.timeOrigin);
    const timings = [];
    async function live(issue, action, causes, expectedCount = 1, name = actorName) {
      const start = performance.now(); await action();
      const rows = inboxPage.locator('.inbox-row').filter({ hasText: issue.identifier });
      const description = causes.includes('completed') ? 'completed' : causes.includes('canceled') ? 'canceled'
        : causes.includes('intake_return') ? 'returned your deferred intake' : causes.includes('unblocked') ? 'removed the last blocker'
        : causes.includes('blocking') ? 'changed a blocking relation' : causes.includes('thread_reopened') ? 'reopened a thread' : 'changed the status';
      await rows.filter({ hasText: description }).first().waitFor({ timeout: Math.max(1, 5000 - (performance.now() - start)) });
      const elapsed = performance.now() - start;
      assert(elapsed <= 5000, `${description} appeared within five seconds: ${elapsed}`);
      assert.equal(await rows.count(), expectedCount);
      const notifications = (await recipient('/notifications?limit=50')).items.filter(row => row.identifier === issue.identifier);
      assert.equal(notifications.length, expectedCount);
      const matching = notifications.filter(row => JSON.stringify([...row.causes].sort()) === JSON.stringify([...causes].sort()));
      assert.equal(matching.length, 1); assert.equal(matching[0].actor, name);
      assert.equal((await actor('/notifications?limit=50')).items.filter(row => row.identifier === issue.identifier && (!causes.includes('thread_reopened') || row.causes.includes('thread_reopened'))).length, 0);
      assert.equal(await inboxPage.evaluate(() => performance.timeOrigin), timeOrigin, 'Inbox refreshes without navigation');
      timings.push(`${description}: ${Math.round(elapsed)}ms`);
    }
    async function changeStatus(issue, category) {
      await beforePrivateNavigation(actorPage, base + '/app/issues/' + issue.identifier);
      await actorPage.goto(base + '/app/issues/' + issue.identifier);
      await actorPage.getByRole('heading', { name: issue.title, exact: true }).waitFor();
      await live(issue, async () => {
        const [response] = await Promise.all([
          actorPage.waitForResponse(r => new URL(r.url()).pathname === '/api/issues/' + issue.identifier && r.request().method() === 'PATCH'),
          actorPage.getByLabel('Issue status', { exact: true }).selectOption(status(category).id),
        ]);
        assert.equal(response.status(), 200);
      }, [category]);
    }
    await changeStatus(completed, 'completed');
    await changeStatus(canceled, 'canceled');
    await live(grouped, () => actor('/issues/' + grouped.identifier, 'PATCH', {
      expectedVersion: grouped.version, statusId: status('started').id, priority: 'urgent',
    }), ['status', 'urgent']);
    await beforePrivateNavigation(actorPage, base + '/app/issues/' + blocked.identifier);
    await actorPage.goto(base + '/app/issues/' + blocked.identifier);
    await actorPage.waitForFunction(() => {
      const control = document.querySelector('select[aria-label="Issue status"]');
      return control && !control.disabled;
    });
    await actorPage.locator('summary').filter({ hasText: /^Relationships ·/ }).click();
    await actorPage.getByText('Add dependency', { exact: true }).click();
    const dependency = actorPage.getByRole('group', { name: 'Dependency fields', exact: true });
    await dependency.getByLabel('Issue identifier', { exact: true }).fill(blocker.identifier);
    await dependency.getByRole('combobox', { name: /^Direction/ }).selectOption('blocked-by');
    for (const method of ['POST', 'DELETE']) await live(blocked, async () => {
      const [response] = await Promise.all([
        actorPage.waitForResponse(r => new URL(r.url()).pathname === '/api/issues/' + blocked.identifier + '/dependencies' && r.request().method() === method),
        method === 'POST' ? dependency.getByRole('button', { name: 'Add dependency', exact: true }).click()
          : actorPage.getByRole('button', { name: 'Remove dependency ' + blocker.identifier, exact: true }).click(),
      ]);
      assert.equal(response.status(), 200);
    }, method === 'POST' ? ['blocking'] : ['blocking', 'unblocked'], method === 'POST' ? 1 : 2);
    // NOTIFY-001: a current follower who replied sees the reopener by name.
    const threaded = await create('Retry failures returned after the fix');
    const root = await actor('/issues/' + threaded.identifier + '/comments', 'POST', { body: 'Which payment retries still fail?' }, 201);
    await recipient('/issues/' + threaded.identifier + '/comments', 'POST', { body: 'The delayed callback still fails on Safari.', parentId: root.id }, 201);
    await actor('/issues/' + threaded.identifier + '/comments/' + root.id + '/resolution', 'POST', { resolved: true });
    await beforePrivateNavigation(actorPage, base + '/app/issues/' + threaded.identifier);
    await actorPage.goto(base + '/app/issues/' + threaded.identifier);
    const resolvedThread = actorPage.getByRole('region', { name: /^Resolved thread/ });
    await resolvedThread.getByRole('button', { name: 'Show thread', exact: true }).click();
    const thread = actorPage.getByRole('region', { name: /^Thread started by/ });
    const prior = (await recipient('/notifications?limit=50')).items.filter(row => row.identifier === threaded.identifier).length;
    await live(threaded, async () => {
      const [response] = await Promise.all([
        actorPage.waitForResponse(r => new URL(r.url()).pathname === '/api/issues/' + threaded.identifier + '/comments/' + root.id + '/resolution' && r.request().method() === 'POST'),
        thread.getByRole('button', { name: 'Reopen', exact: true }).click(),
      ]);
      assert.equal(response.status(), 200);
    }, ['thread_reopened'], prior + 1);
    await actor('/issues/' + threaded.identifier + '/comments/' + root.id + '/resolution', 'POST', { resolved: false });
    assert.equal((await recipient('/notifications?limit=50')).items.filter(row => row.identifier === threaded.identifier && row.causes.includes('thread_reopened')).length, 1);
    await mkdir(verificationDirectory + '/follower-events', { recursive: true });
    const reopenRow = inboxPage.locator('.inbox-row').filter({ hasText: threaded.identifier }).filter({ hasText: 'reopened a thread' });
    await reopenRow.scrollIntoViewIfNeeded();
    await inboxPage.screenshot({ path: `${verificationDirectory}/follower-events/thread-reopened-${width}.png`, fullPage: true });
    await live(mapped, () => actor(`/settings/teams/${team.id}/statuses/${removed.id}`, 'DELETE', { destinationStatusId: status('started').id }), ['status']);
    const fresh = { ...input, sourceRevisionId: 'fresh', summary: 'The retry failed again' };
    await live(signal, () => revision(fresh), ['intake_return'], 1, 'Payment monitoring');
    assert.equal((await revision(fresh)).reused, true);
    await revision({ ...fresh, sourceRevisionId: 'third' });
    const returned = await recipient('/issues/' + signal.identifier);
    assert.equal(returned.deferredUntil, null); assert.equal(returned.version, deferred.version + 1);
    assert.deepEqual(returned.decisions, deferred.decisions);
    assert.equal(returned.activity.filter(row => row.kind === 'intake.returned').length, 1);
    assert.equal((await recipient('/notifications?limit=50')).items.filter(row => row.identifier === signal.identifier).length, 1);
    await settleReads(inboxPage);
    assert(await inboxPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Inbox fits the viewport');
    await mkdir(verificationDirectory + '/follower-events', { recursive: true });
    await inboxPage.screenshot({ path: `${verificationDirectory}/follower-events/inbox-${width}.png`, fullPage: true });
    await beforePrivateNavigation(inboxPage, base + '/app/settings/notifications');
    await inboxPage.goto(base + '/app/settings/notifications');
    const notificationPanel = inboxPage.getByRole('region', { name: 'Notifications', exact: true });
    const disclosure = inboxPage.locator('details').filter({ has: inboxPage.locator('#notifications-heading') }).first();
    if (await disclosure.count() && await disclosure.getAttribute('open') === null) await disclosure.locator('summary').first().click();
    const mute = notificationPanel.locator('.notification-mutes').getByRole('checkbox', { name: 'Reopened threads', exact: true });
    await mute.waitFor();
    await mute.scrollIntoViewIfNeeded();
    await notificationPanel.screenshot({ path: `${verificationDirectory}/follower-events/thread-preferences-panel-${width}.png` });
    await inboxPage.screenshot({ path: `${verificationDirectory}/follower-events/thread-preferences-${width}.png` });
    const [muted] = await Promise.all([
      inboxPage.waitForResponse(r => new URL(r.url()).pathname === '/api/settings/notifications' && r.request().method() === 'PATCH'),
      mute.click(),
    ]);
    assert.equal(muted.status(), 200);
    await inboxPage.waitForFunction(() => [...document.querySelectorAll('.notification-mutes .notification-checkbox')].find(label => label.textContent.includes('Reopened threads')).querySelector('input').checked);
    assert((await recipient('/settings/notifications')).mutedKinds.includes('thread_reopened'));
    await recipient('/settings/notifications', 'PATCH', { mutedKinds: [] });
    await beforePrivateNavigation(inboxPage, base + '/app/inbox');
    await inboxPage.goto(base + '/app/inbox');
    await inboxPage.getByRole('heading', { name: 'Inbox', exact: true }).waitFor();
    record('NOTIFY-001', `${width}px live Inbox: ${timings.join('; ')}. One grouped event per recipient; participated resolved-thread reopen names the actor once, repeat reopen adds nothing, per-type mute is editable; actor excluded; signed evidence replay and later revisions do not repeat the deferrer notification.`);
  }
  await subscriptionsJourney({recipientPage:inboxPage,actorPage,base,evidence:verificationDirectory+'/subject-subscriptions'});
  record('NOTIFY-009', 'Team, project, label and saved-view subscriptions at 1440 and 390; one created notice across four matches; actor excluded; unsubscribe immediately stops future notices.');
  await inboxPage.setViewportSize(originalViewport);
  await actorPage.setViewportSize(originalViewport);
}
