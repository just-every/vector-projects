import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { openGate } from './dev-gate.mjs';
import { readDevelopmentLink } from './outbox-session.mjs';
import { beforePrivateNavigation } from './collaboration-navigation.mjs';
export const expectedAccountDraftConflicts = new Set();
const require = createRequire(import.meta.url);
const until = async (read, accept, message) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
};

export async function accountDraftJourney(page, context, base, record, { state, evidence }) {
  const get = async client => {
    const response = await client.get(base + '/api/drafts'); assert.equal(response.status(), 200);
    return (await response.json()).drafts;
  };
  // A clean form through the product's discard door, preserving the local-restore regression.
  await page.getByRole('textbox', { name: /^Title/, disabled: false }).waitFor();
  await new Promise(resolve => setTimeout(resolve, 500));
  for (const draft of await get(context.request)) {
    await page.getByRole('button', { name: 'Discard draft ' + (draft.values.title || 'Untitled issue'), exact: true }).click();
    await until(() => get(context.request), rows => !rows.some(row => row.id === draft.id), 'Discard removes the previous form');
  }
  await page.getByText('No open account drafts.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: /^Title/ }).inputValue(), '');
  const options = await (await context.request.get(base + '/api/options')).json();
  const labels = options.labels.slice(0, 2); assert.equal(labels.length, 2);
  const title = 'synthetic-vector-2820-' + Date.now();
  await page.getByRole('textbox', { name: /^Title/ }).fill(title);
  const details = page.locator('details').filter({ has: page.locator('.new-issue-labels') });
  if (!await details.evaluate(element => element.open)) await details.locator('summary').click();
  for (const label of labels) await page.getByRole('checkbox', { name: label.name, exact: true }).check();
  const saved = await until(() => get(context.request), rows => rows.some(row => row.values.title === title && row.values.labelIds.length === 2), 'Typed title and labels reach account');
  const draft = saved.find(row => row.values.title === title);
  assert.deepEqual([...draft.values.labelIds].sort(), labels.map(row => row.id).sort());
  const session = await (await context.request.get(base + '/auth/session')).json();
  const other = await context.browser().newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { Connection: 'close' } });
  const second = await other.newPage(), errors = [];
  second.on('pageerror', error => errors.push(error.message));
  try {
    await openGate(other, base);
    await second.goto(base + '/signin');
    await second.getByRole('textbox', { name: 'Email', exact: true }).fill(session.operator.email);
    const requested = second.waitForResponse(response => response.url() === base + '/auth/request' && response.request().method() === 'POST');
    await second.getByRole('button', { name: 'Send sign-in link', exact: true }).click();
    assert.equal((await requested).status(), 202);
    await second.goto(await readDevelopmentLink(base, other.request, session.operator.email, state));
    await second.getByRole('button', { name: 'Confirm', exact: true }).click();
    await second.waitForURL(base + '/app');
    const independent = await (await other.request.get(base + '/auth/session')).json();
    assert.notEqual(independent.id, session.id, 'Two genuine sign-ins have independent sessions');
    await beforePrivateNavigation(second, base + '/app/new-issue');
    await second.goto(base + '/app/new-issue');
    await until(() => second.getByRole('textbox', { name: /^Title/ }).inputValue(), value => value === title, 'Second browser recovers exact title');
    const secondDetails = second.locator('details').filter({ has: second.locator('.new-issue-labels') });
    if (!await secondDetails.evaluate(element => element.open)) await secondDetails.locator('summary').click();
    for (const label of labels) assert.equal(await second.getByRole('checkbox', { name: label.name, exact: true }).isChecked(), true);
    const list = second.getByRole('region', { name: 'Drafts', exact: true });
    assert.ok((await list.innerText()).includes(draft.team));
    assert.ok(await list.locator('time').getAttribute('datetime'));
    await list.getByRole('button', { name: 'Open draft ' + title, exact: true }).focus();
    await second.keyboard.press('Enter');
    const newer = title + '-newer';
    await second.getByRole('textbox', { name: /^Title/ }).fill(newer);
    await until(() => get(other.request), rows => rows.some(row => row.values.title === newer), 'Later save reaches account');
    await until(() => page.getByRole('textbox', { name: /^Title/ }).inputValue(), value => value === newer, 'Other browser shows newer text before its next save');
    // Hold an old device's real save, allow the independent browser to commit,
    // then deliver that stale request. Its response displays the winning text.
    let release, held;
    const arrived = new Promise(resolve => { held = resolve; });
    const pause = new Promise(resolve => { release = resolve; });
    const url = base + '/api/drafts/' + draft.id;
    const intercept = async route => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      held(); await pause; await route.continue();
    };
    expectedAccountDraftConflicts.add(url);
    await page.route(url, intercept);
    await page.getByRole('textbox', { name: /^Title/ }).fill(title + '-delayed');
    await Promise.race([arrived, new Promise((_, reject) => setTimeout(() => reject(new Error('Draft save did not reach the native door')), 10000))]);
    const winning = title + '-winning';
    await second.getByRole('textbox', { name: /^Title/ }).fill(winning);
    await until(() => get(other.request), rows => rows.some(row => row.values.title === winning), 'Concurrent newer save commits');
    const conflict = page.waitForResponse(response => response.url() === url && response.status() === 409);
    release(); await conflict;
    await until(() => page.getByRole('textbox', { name: /^Title/ }).inputValue(), value => value === winning, 'Delayed save cannot overwrite newer text');
    await page.unroute(url, intercept);
    expectedAccountDraftConflicts.delete(url);
    const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
    await second.evaluate(source => {
      const script = document.createElement('script'); script.nonce = document.querySelector('script[nonce]')?.nonce ?? '';
      script.textContent = source; document.head.append(script);
    }, axeSource);
    const violations = await second.evaluate(async () => (await window.axe.run()).violations.filter(row => ['serious', 'critical'].includes(row.impact)).map(row => row.id));
    assert.deepEqual(violations, []);
    for (const width of [1440, 390]) {
      await second.setViewportSize({ width, height: 1000 });
      assert.equal(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await second.screenshot({ path: evidence + '/account-drafts-' + width + '.png', fullPage: true });
    }
    await second.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Open draft ' + winning, exact: true }).waitFor();
    const created = second.waitForResponse(response => response.url() === base + '/api/issues' && response.request().method() === 'POST');
    await second.getByRole('button', { name: 'Create issue', exact: true }).click();
    const response = await created; assert.equal(response.status(), 201);
    const issue = await response.json(); assert.equal(issue.title, winning);
    assert.deepEqual(issue.labels.map(row => row.id).sort(), labels.map(row => row.id).sort());
    await second.waitForURL(base + '/app/issues/' + issue.identifier);
    await until(() => page.getByRole('region', { name: 'Drafts', exact: true }).innerText(), text => !text.includes(winning), 'Submission disappears from first browser');
    assert.deepEqual(await get(other.request), []);
    await until(() => page.getByRole('textbox', { name: /^Title/ }).inputValue(), value => value === '', 'Submission clears the other browser form');
    const discarded = title + '-discard';
    await page.getByRole('textbox', { name: /^Title/ }).fill(discarded);
    await until(() => get(context.request), rows => rows.some(row => row.values.title === discarded), 'Next draft saves');
    await beforePrivateNavigation(second, base + '/app/new-issue'); await second.goto(base + '/app/new-issue');
    await second.getByRole('button', { name: 'Discard draft ' + discarded, exact: true }).click();
    await until(() => get(other.request), rows => rows.length === 0, 'Discard consumes account draft');
    await until(() => page.getByRole('textbox', { name: /^Title/ }).inputValue(), value => value === '', 'Discard clears other browser');
    assert.deepEqual(errors, []);
    record('ISSUE-028', 'Independent native sessions restore title and two labels, show newer text, refuse a delayed save, atomically submit, and discard across browsers; keyboard, accessibility and both screen widths verified.');
  } finally { expectedAccountDraftConflicts.clear(); await other.close(); }
}
