import { accountDraftJourney } from './account-drafts-journey.mjs';
export { expectedAccountDraftConflicts } from './account-drafts-journey.mjs';
import assert from 'node:assert/strict';
import { beforePrivateNavigation } from './collaboration-navigation.mjs';

export const expectedDraftFailures = new Set();

export async function draftJourney(page, context, base, teamId, operatorId, record, proof) {
  const target = base + '/app/new-issue';
  await beforePrivateNavigation(page, target);
  expectedDraftFailures.add(base + '/api/metadata');
  // A failed team-metadata read must expose recovery through the same form door.
  // Do not inject into a late read from the departing Current document.
  let failedMetadataReads = 0;
  const failMetadata = route => {
    if (route.request().headers().referer !== target) return route.fallback();
    ++failedMetadataReads;
    return route.fulfill({ status: 500, contentType: 'application/json',
      body: JSON.stringify({ error: 'unavailable' }) });
  };
  await page.route('**/api/metadata', failMetadata);
  await page.goto(target);
  await page.getByRole('alert').filter({ hasText: 'Unable to load issue options.' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '← Back', exact: true }).isEnabled(), true);
  await page.unroute('**/api/metadata', failMetadata);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('textbox', { name: /^Title/, disabled: false }).waitFor();
  assert.equal(failedMetadataReads, 1, 'Only the issue form metadata read receives the injected failure');
  expectedDraftFailures.delete(base + '/api/metadata');
  const title = `Unsent browser draft ${Date.now()}`;
  const fields = [
    [/^Title/, title], ['Description', 'First unsent line\nSecond unsent line\nThird line'],
    ['Expected outcome', 'Restore the typed outcome'], ['Customer impact', 'Restore the typed impact'],
    [/^Estimate/, '7'], ['Due date', '2027-02-18'],
  ];
  await page.getByRole('textbox', { name: /^Title/ }).fill(title);
  await page.getByLabel('Description', { exact: true }).fill(fields[1][1]);
  await page.getByLabel(/^Team/).selectOption(teamId);
  await page.getByText('Optional context', { exact: true }).click();
  await page.getByLabel(/^Assignee/).selectOption(operatorId);
  await page.getByLabel(/^Priority/).selectOption('high');
  for (const [name, value] of fields.slice(2)) await page.getByLabel(name).fill(value);
  await beforePrivateNavigation(page, page.url());
  await page.reload();
  await page.getByRole('textbox', { name: /^Title/ }).waitFor();
  // The form restores the draft once its options and team metadata load, and only then enables its fields.
  await page.getByRole('textbox', { name: /^Title/, disabled: false }).waitFor();
  await page.getByText('Optional context', { exact: true }).click();
  for (const [name, value] of fields) assert.equal(await page.getByLabel(name).inputValue(), value);
  for (const [name, value] of [[/^Team/, teamId], [/^Assignee/, operatorId], [/^Priority/, 'high']])
    assert.equal(await page.getByLabel(name).inputValue(), value);
  for (const path of ['/api/search?q=' + encodeURIComponent(title), '/api/issues?q=' + encodeURIComponent(title)]) {
    const response = await context.request.get(base + path);
    assert.equal(response.status(), 200);
    const body = await response.json();
    assert.ok(!JSON.stringify(body).includes(title), 'Unsubmitted draft never became an API record');
  }
  // Clear through the real form so the subsequent creation journey starts clean.
  for (const [name] of fields) await page.getByLabel(name).fill('');
  await page.getByLabel(/^Assignee/).selectOption('');
  await page.getByLabel(/^Priority/).selectOption('none');
  record('ISSUE-015', 'Typed unique unsent title, multiline description, team, assignee, priority, estimate, date, outcome and impact survive reload in the same context; authenticated search/list contain no created record.');
  if (proof) await accountDraftJourney(page, context, base, record, proof);
}
