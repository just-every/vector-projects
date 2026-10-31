import assert from 'node:assert/strict';
import { join } from 'node:path';
import { settleReads } from '../collaboration-navigation.mjs';

/** Subscription API and browser comment mutations use the same native queue.
 * Subscription controls remain a separate, unimplemented Settings obligation. */
export async function exerciseWebhookComments({ page, runtime, cookie, team, evidence }) {
  await runtime.freshRequestWindow();
  const errors = [], onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  const call = async (path, method = 'GET', input, status = 200) => {
    const response = await runtime.req('/api' + path, { method, headers: { Cookie: cookie, Origin: runtime.base, 'Content-Type': 'application/json' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
  };
  const events = ['comment.created', 'comment.updated', 'comment.deleted'];
  const destination = await call('/settings/integrations/destinations', 'POST', { name: 'synthetic-vector-9080', url: 'https://receiver.example.com/comments', events, teamIds: [team.id] }, 201);
  try {
    const issue = await call('/issues', 'POST', { teamId: team.id, title: 'synthetic-vector-9081' }, 201);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(runtime.base + '/app/issues/' + issue.identifier);
    await page.getByRole('heading', { name: 'Discussion', exact: true }).waitFor();
    await settleReads(page);
    const rootText = 'synthetic-vector-9082', replyText = 'synthetic-vector-9083';
    // A controlled textarea mirrors its text, and an unsent account draft is
    // saved before posting: wait for each comment's own committed receipt.
    const posted = () => page.waitForResponse(response => new URL(response.url()).pathname === '/api/issues/' + issue.identifier + '/comments'
      && response.request().method() === 'POST');
    await page.getByRole('textbox', { name: 'Add a comment', exact: true }).fill(rootText);
    const rootPosted = posted();
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    assert.equal((await rootPosted).status(), 201);
    const thread = page.getByRole('region', { name: /^Thread started by/ });
    await thread.getByText(rootText, { exact: true }).waitFor();
    await thread.getByRole('button', { name: 'Reply', exact: true }).click();
    await thread.getByRole('textbox', { name: 'Reply to thread', exact: true }).fill(replyText);
    const replyPosted = posted();
    await thread.getByRole('button', { name: 'Post reply', exact: true }).click();
    assert.equal((await replyPosted).status(), 201);
    await thread.getByText(replyText, { exact: true }).waitFor();
    await settleReads(page);
    await page.reload();
    await thread.getByText(rootText, { exact: true }).waitFor();
    await thread.getByText(replyText, { exact: true }).waitFor();
    await settleReads(page);
    const config = await call('/settings/integrations');
    assert.deepEqual(config.destinations.find(d => d.id === destination.id).events, events);
    assert.deepEqual(config.destinations.find(d => d.id === destination.id).teamIds, [team.id]);
    const discussion = await call('/issues/' + issue.identifier + '/discussion');
    const root = discussion.comments.find(c => c.body === rootText), reply = discussion.comments.find(c => c.body === replyText);
    assert.equal(reply.parentId, root.id);
    for (const id of [root.id, reply.id]) {
      await call('/issues/' + issue.identifier + '/comments/' + id, 'PATCH', { body: 'synthetic-vector-9084' });
      await call('/issues/' + issue.identifier + '/comments/' + id, 'DELETE');
    }
    await settleReads(page);
    await page.reload();
    await page.getByRole('heading', { name: 'Discussion', exact: true }).waitFor();
    await settleReads(page);
    assert.equal(await thread.getByText('Comment deleted', { exact: true }).count(), 2);
    assert.equal(await thread.getByText(rootText, { exact: true }).count(), 0);
    assert.equal(await thread.getByText(replyText, { exact: true }).count(), 0);
    const captured = runtime.sql('SELECT event,body FROM vector_webhook_events WHERE destination_id=\'' + destination.id + '\' ORDER BY id');
    assert.equal(captured.length, 6);
    assert.deepEqual(captured.map(e => e.event).sort(), [...events, ...events].sort());
    for (const event of captured) {
      const payload = JSON.parse(event.body);
      assert.equal(payload.issueId, issue.id);
      assert.equal(payload.rootCommentId, root.id);
      assert.equal(payload.parentCommentId, payload.commentId === reply.id ? root.id : null);
      for (const text of [rootText, replyText, 'synthetic-vector-9084']) assert(!event.body.includes(text));
    }
    assert.deepEqual(errors, []);
    // Assertions run at desktop width; phone is the candidate's additional visual proof.
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await thread.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(evidence, 'webhook-comment-history-' + width + '.png') });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  } finally {
    page.off('pageerror', onError);
    await call('/settings/integrations/destinations/' + destination.id, 'DELETE');
  }
}
