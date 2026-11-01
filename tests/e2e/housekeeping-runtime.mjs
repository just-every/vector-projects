import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createAdminRuntime, bootstrapOwner } from './admin-runtime-support.mjs';
import { writeRuntimeD1 } from './runtime-d1.mjs';
import { beforePrivateNavigation, settleReads } from './collaboration-navigation.mjs';
import { counts, inviteRecipient } from './collaboration-support.mjs';
// AUTO-003: periods are set and previewed in Settings; the scheduled run closes and archives with a reason entry every
// reader finds in the issue's activity and one notification per follower, as a manual status change gives; archived issues leave lists.
const output = resolve(process.env.VECTOR_HOUSEKEEPING_SHOTS ?? '.artifacts/verification/housekeeping');
await mkdir(output, { recursive: true });
const runtime = createAdminRuntime(1440, [], { port: 15980, inspectorPort: 15981 });
Object.assign(runtime.config, { NOTIFICATION_EMAIL_ENABLED: 'true' });
let browser, page;
const goOn = async (p, path) => { await beforePrivateNavigation(p, runtime.base + path); await p.goto(runtime.base + path); await p.locator('main:visible').first().waitFor(); await settleReads(p); };
const go = path => goOn(page, path);
const overflowOn = async p => assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
const overflow = () => overflowOn(page);
const sizeOf = width => ({ width, height: width === 390 ? 844 : 1000 });
try {
  runtime.initialize(); await runtime.start();
  browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  await bootstrapOwner(page, runtime);
  const api = context.request, headers = { Origin: runtime.base };
  const team = (await (await api.get(runtime.base + '/api/settings/administration')).json()).teams[0];
  const status = category => team.statuses.find(s => s.category === category).id;
  const create = async (title, category) => {
    const response = await api.post(runtime.base + '/api/issues', { headers, data: { title, teamId: team.id, statusId: status(category) } });
    assert.equal(response.status(), 201); return response.json();
  };
  const stale = await create('Follow up on the courier damage claim', 'backlog');
  const done = await create('Publish the September carrier scorecard', 'completed');
  // A teammate follows both, and a third issue the owner cancels by hand: the notification to match.
  const manual = await create('Cancel the duplicate pallet booking', 'backlog');
  const recipient = await inviteRecipient({ page, browser, runtime }), peer = recipient.peer;
  for (const issue of [stale, done, manual])
    assert.equal((await recipient.context.request.patch(`${runtime.base}/api/issues/${issue.identifier}/subscription`, { headers, data: { following: true } })).status(), 200);
  assert.equal((await api.patch(`${runtime.base}/api/issues/${manual.identifier}`, { headers, data: { expectedVersion: manual.version, statusId: status('canceled') } })).status(), 200);
  const ago = days => new Date(Date.now() - days * 86400000).toISOString();
  await writeRuntimeD1(runtime.base, [
    { sql: 'UPDATE issues SET updated_at=?,created_at=? WHERE id=?', params: [ago(31), ago(31), stale.id] },
    { sql: 'UPDATE issues SET updated_at=?,created_at=?,completed_at=? WHERE id=?', params: [ago(91), ago(91), ago(91), done.id] },
    { sql: 'UPDATE issue_activity SET created_at=?,updated_at=? WHERE issue_id=?', params: [ago(31), ago(31), stale.id] },
    { sql: 'UPDATE issue_activity SET created_at=?,updated_at=? WHERE issue_id=?', params: [ago(91), ago(91), done.id] },
  ]);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await go(`/app/settings/teams/${team.id}/automation`);
    // Each period stores as it changes (no Save button); Preview reads what the next run would use.
    const rule = page.getByRole('region', { name: 'Auto-close and auto-archive', exact: true });
    const stored = () => page.waitForResponse(r => r.url().endsWith('/housekeeping') && r.request().method() === 'PUT');
    for (const [label, value] of [['Close after', '30'], ['Archive after', '90']]) {
      const field = rule.getByLabel(label, { exact: true });
      if (await field.inputValue() === value) continue;
      const saved = stored();
      await field.fill(value); await field.blur(); assert.equal((await saved).status(), 200);
    }
    assert.equal(await rule.getByRole('button', { name: /^Save(?!d)/ }).count(), 0);
    await rule.getByRole('button', { name: 'Preview', exact: true }).click();
    const preview = page.getByRole('status', { name: `Preview for ${team.name}` });
    await preview.getByRole('heading', { name: 'Would close 1' }).waitFor();
    await preview.getByRole('heading', { name: 'Would archive 1' }).waitFor();
    assert.ok((await preview.innerText()).includes(stale.identifier) && (await preview.innerText()).includes(done.identifier));
    await settleReads(page); await preview.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/settings-preview-${width}.png` }); await overflow();
  }
  // Two scheduled runs: the second finds nothing left to change, so each change notifies once.
  for (let run = 0; run < 2; run++) {
    const tick = await api.get(runtime.base + '/cdn-cgi/local/scheduled?cron=' + encodeURIComponent('* * * * *'));
    assert.equal(tick.status(), 200); await tick.body();
  }
  const signedOut = await browser.newContext();
  const outsider = await signedOut.newPage(); outsider.setDefaultTimeout(20000);
  const reasons = [[stale, 'Closed automatically after 30 days without activity'], [done, 'Archived automatically 90 days after it closed']];
  for (const width of [1440, 390]) {
    await page.setViewportSize(sizeOf(width));
    await go('/app/issues/' + done.identifier);
    await page.getByRole('note').filter({ hasText: 'Archived' }).waitFor();
    await page.screenshot({ path: `${output}/archived-issue-${width}.png` }); await overflow();
    await go('/app/issues/' + stale.identifier);
    await page.getByRole('heading', { name: stale.title }).waitFor();
    assert.equal((await (await api.get(runtime.base + '/api/issues/' + stale.identifier)).json()).category, 'canceled');
    // Readers (the owner and the teammate) find the reason in the issue's own activity; a signed-out visitor does not.
    for (const [reader, name] of [[page, 'owner'], [peer, 'teammate']]) {
      await reader.setViewportSize(sizeOf(width));
      for (const [issue, reason] of reasons) {
        await goOn(reader, '/app/issues/' + issue.identifier);
        await reader.locator('details.issue-history > summary').click();
        const entry = reader.locator('.activity-list li').filter({ hasText: reason });
        assert.equal(await entry.count(), 1, `${name} finds one reason entry on ${issue.identifier}`);
        assert.match(await entry.innerText(), /Auto-(close|archive) automation/);
        await entry.scrollIntoViewIfNeeded(); await overflowOn(reader);
        await reader.screenshot({ path: `${output}/${name}-${issue === stale ? 'closed' : 'archived'}-reason-${width}.png` });
      }
    }
    await outsider.setViewportSize(sizeOf(width));
    for (const [issue, reason] of reasons) {
      await outsider.goto(runtime.base + '/app/issues/' + issue.identifier); await outsider.waitForLoadState('networkidle');
      assert.ok(!(await outsider.locator('body').innerText()).includes(reason), 'a signed-out visitor never sees the reason');
      assert.equal((await signedOut.request.get(runtime.base + '/api/issues/' + issue.identifier)).status(), 401);
    }
    await outsider.screenshot({ path: `${output}/signed-out-${width}.png` });
    // The follower's inbox holds one notification per automated change, like the manual cancel; mail matches it too.
    await goOn(peer, '/app/inbox');
    for (const [issue, action] of [[manual, 'canceled'], [stale, 'Auto-close automation canceled'], [done, 'Auto-archive automation archived']])
      assert.equal(await peer.locator('.inbox-row').filter({ hasText: issue.identifier }).filter({ hasText: action }).count(), 1, `one ${action} row for ${issue.identifier}`);
    await overflowOn(peer); await peer.screenshot({ path: `${output}/follower-inbox-${width}.png` });
    for (const issue of [stale, done]) assert.deepEqual(counts(runtime, issue, recipient.operator), counts(runtime, manual, recipient.operator));
    await go('/app/issues?category=completed');
    assert.equal(await page.getByText(done.title).count(), 0, 'archived issue left the completed list');
    await go('/app/search');
    await page.getByLabel(/Include archived/).uncheck(); await page.getByLabel('Search workspace').fill(done.title); await settleReads(page);
    assert.equal(await page.getByRole('link', { name: new RegExp(done.identifier) }).count(), 0, 'default search leaves archived issues out');
    await page.getByLabel(/Include archived/).check(); await page.getByRole('link', { name: new RegExp(done.identifier) }).first().waitFor();
    await page.screenshot({ path: `${output}/search-archived-${width}.png` }); await overflow();
  }
  console.log('[AUTO-003] preview, save, scheduled close and archive with reader-visible reasons and follower notifications, archived page, lists and search at 1440/390');
} catch (error) { if (page) await page.screenshot({ path: output + '/failure.png' }).catch(() => {}); throw error; }
finally { if (browser) await browser.close(); await runtime.stop(); }
