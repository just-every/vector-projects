import { groupingJourney } from "./core-grouping-journey.mjs";
import { withOperatorClient } from './operator-request.mjs';
import assert from 'node:assert/strict';
import { beforePrivateNavigation, settleReads } from './collaboration-navigation.mjs';
import { streamPlanningJourney } from './core-stream-planning-journey.mjs';
import { undoJourney } from './core-undo-journey.mjs';
import { paletteJourney } from './core-palette-journey.mjs';
import { booleanFilterJourney } from './core-boolean-filter-journey.mjs';
import { favoritesJourney } from './core-favorites-journey.mjs';
import { crossTeamViewJourney } from './core-cross-team-view-journey.mjs';

export async function keyboardJourney(page, context, base, record, independent = journey => journey(), runtime) {
  const origin = await page.evaluate(() => performance.timeOrigin);
  for (const modifier of ['Control', 'Meta']) {
    await settleReads(page);
    await page.locator('h1').first().click();
    await page.keyboard.press(`${modifier}+k`);
    const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
    await palette.waitFor();
    const search = palette.getByRole('textbox');
    await search.fill('Open Projects');
    await palette.getByRole('option', { name: /Open Projects/ }).waitFor();
    await settleReads(page);
    await page.keyboard.press('Enter');
    await page.waitForURL(base + '/app/projects');
    await palette.waitFor({ state: 'detached' });
    await page.locator('h1').first().click();
    await page.keyboard.press(`${modifier}+k`);
    await palette.waitFor();
    await page.keyboard.press('Escape');
    await palette.waitFor({ state: 'detached' });
  }
  await paletteJourney(page, context, base, record);
  await settleReads(page);
  await page.locator('h1').first().click();
  await page.keyboard.press('c');
  await page.waitForURL(base + '/app/new-issue');
  const title = page.getByRole('textbox', { name: /^Title/ });
  await title.fill('');
  await title.pressSequentially('c g m g c g p');
  assert.equal(new URL(page.url()).pathname, '/app/new-issue');
  assert.equal(await title.inputValue(), 'c g m g c g p');
  await title.fill('');
  await page.getByLabel('Description', { exact: true }).pressSequentially('c g m g c g p');
  assert.equal(new URL(page.url()).pathname, '/app/new-issue');
  await page.getByLabel('Description', { exact: true }).fill('');
  for (const [key, path, heading] of [['m', '/app/my-work', 'My work'], ['c', '/app', 'Current'], ['p', '/app/projects', 'Projects']]) {
    await settleReads(page);
    await page.locator('h1').first().click();
    await page.keyboard.press('g');
    await page.keyboard.press(key);
    await page.waitForURL(base + path);
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
  }
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  record('CMD-002', 'Control+k and Meta+k each open a palette that navigates with Enter and closes with Escape; c and g m/c/p navigate, while title/description typing remains editable.');
  await independent(() => booleanFilterJourney({ page, context, base, record, ...runtime }));
  await independent(() => favoritesJourney({ page, context, base, record, ...runtime }));
  await independent(() => groupingJourney({ page, context, base, record, ...runtime }));
  await independent(() => crossTeamViewJourney({ page, context, base, record, ...runtime }));
  await independent(() => issueEditingJourney(page, context, base, record));
  await independent(() => streamPlanningJourney(page, context, base, record));
  await undoJourney(page, context, base, record, independent, runtime);
}

// One native journey covers list focus, keyboard bulk editing, and an atomic
// stale-version failure. All fixture and concurrent writes use public APIs.
export async function issueEditingJourney(page, context, base, record) {
  const marker = `Keyboard planning ${Date.now()}`;
  const labelName = marker + ' review';
  const createdLabel = await context.request.post(base + '/api/settings/labels', {
    headers: { Origin: base }, data: { name: labelName, color: '#2563eb' },
  });
  assert.equal(createdLabel.status(), 200);
  const optionsResponse = await context.request.get(base + '/api/options');
  assert.equal(optionsResponse.status(), 200);
  const options = await optionsResponse.json();
  const team = options.teams.find(team => options.statuses.filter(status =>
    status.teamId === team.id && ['backlog', 'unstarted', 'started'].includes(status.category)).length >= 2);
  assert.ok(team, 'A real team has two nonterminal workflow statuses');
  const statuses = options.statuses.filter(status => status.teamId === team.id &&
    ['backlog', 'unstarted', 'started'].includes(status.category));
  const assignee = options.operators.find(operator => operator.id === options.operator.id);
  assert.ok(assignee);
  const label = options.labels.find(label => label.name === labelName);
  assert.ok(label);
  const fixtures = [];
  for (const [title, priority] of [['Triage', 'low'], ['Schedule', 'urgent'], ['Deliver', 'high']]) {
    const response = await context.request.post(base + '/api/issues', {
      headers: { Origin: base }, data: { title: `${marker} ${title}`, priority, teamId: team.id, statusId: statuses[0].id },
    });
    assert.equal(response.status(), 201);
    fixtures.push(await response.json());
  }
  const target = base + '/app/issues?' + new URLSearchParams({ q: marker, team: team.id, sort: 'oldest', grouping: 'priority' });
  await beforePrivateNavigation(page, target);
  await page.goto(target);
  const ready = async () => {
    await settleReads(page);
    await page.locator('.issues-browser[data-list-state="ready"]').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.issues-row')].every(row => !row.disabled));
  };
  await ready();
  const rows = page.locator('.issues-row');
  await rows.first().waitFor();
  assert.equal(await rows.count(), 3);
  const rendered = await rows.evaluateAll(nodes => nodes.map(node => node.dataset.issueIdentifier));
  const active = () => page.evaluate(() => document.activeElement?.id);
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await active(), 'issue-row-' + rendered[1], 'Arrows follow rendered groups');
  await page.keyboard.press('x');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('x');
  const selected = rendered.slice(0, 2);
  const selectionOrder = [rendered[1], rendered[0]];
  const owner = await page.locator('.issues-browser').elementHandle();
  await settleReads(page);
  await page.keyboard.press('Enter');
  await page.waitForURL(url => url.pathname === '/app/issues/' + selected[0]);
  await page.getByRole('heading', { name: fixtures.find(issue => issue.identifier === selected[0]).title, exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForURL(url => url.pathname === '/app/issues');
  await page.waitForFunction(id => document.activeElement?.id === 'issue-row-' + id, selected[0]);
  assert.ok(await owner.evaluate(node => node.isConnected), 'The list remains mounted behind detail');
  for (const id of selected) assert.equal(await page.getByRole('checkbox', { name: 'Select ' + id, exact: true }).isChecked(), true);

  // Changing a grouped query while the row owns focus must restore its DOM
  // focus across the query's loading gap, including when groups reparent rows.
  await page.getByRole('combobox', { name: 'Group by', exact: true }).selectOption('status');
  await ready();
  assert.equal(await active(), 'issue-row-' + selected[0]);
  await page.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('newest');
  await ready();
  assert.equal(await active(), 'issue-row-' + selected[0]);

  async function choose(dialog, name, value) {
    const select = dialog.getByRole('combobox', { name, exact: true });
    const index = await select.evaluate((node, value) => [...node.options].findIndex(option => option.value === value), value);
    assert.ok(index >= 0);
    // Native select type-ahead works without a mouse on macOS and Linux.
    const text = await select.locator('option').nth(index).innerText();
    await select.pressSequentially(text);
    assert.equal(await select.inputValue(), value);
  }
  async function submit(dialog, status = 200) {
    const [receipt] = await Promise.all([
      page.waitForResponse(response => response.url() === base + '/api/issues/bulk' && response.request().method() === 'POST'),
      (async () => {
        await dialog.getByRole('button', { name: 'Apply changes', exact: true }).focus();
        await page.keyboard.press('Enter');
      })(),
    ]);
    assert.equal(receipt.status(), status);
    await receipt.finished();
    if (status === 200) {
      await dialog.waitFor({ state: 'detached' }); await ready();
      await page.waitForFunction(id => document.activeElement?.id === 'issue-row-' + id, selected[0]);
    }
    return receipt;
  }
  async function change(key, name, value) {
    await page.keyboard.press(key);
    const dialog = page.getByRole('dialog', { name: 'Change ' + name.toLowerCase(), exact: true });
    await dialog.waitFor();
    await choose(dialog, name, value);
    await page.keyboard.press('Tab');
    return submit(dialog);
  }
  const statusReceipt = await change('s', 'Status', statuses[1].id);
  assert.deepEqual(statusReceipt.request().postDataJSON().issues.map(issue => issue.identifier).sort(), [...selected].sort());
  await change('a', 'Assignee', assignee.id);
  await change('p', 'Priority', 'high');
  await page.keyboard.press('l');
  const labelsDialog = page.getByRole('dialog', { name: 'Change labels', exact: true });
  await labelsDialog.getByRole('checkbox', { name: labelName, exact: true }).focus();
  await page.keyboard.press('Space');
  await submit(labelsDialog);
  for (const [key, name, value] of [['e', 'Estimate', '5'], ['d', 'Due date', '2027-04-16']]) {
    await page.keyboard.press(key);
    const dialog = page.getByRole('dialog', { name: 'Change ' + name.toLowerCase(), exact: true });
    if (key === 'e') await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Estimate');
    await dialog.getByLabel(name, { exact: true }).fill(value);
    await submit(dialog);
  }
  const read = async id => withOperatorClient(context, async client => {
    const response = await client.get(base + '/api/issues/' + id);
    assert.equal(response.status(), 200);
    return await response.json();
  });
  const saved = await Promise.all(selected.map(read));
  for (const issue of saved) {
    assert.equal(issue.status.id, statuses[1].id);
    assert.equal(issue.assignee.id, assignee.id);
    assert.equal(issue.priority, 'high');
    assert.equal(issue.estimate, 5);
    assert.equal(issue.dueDate, '2027-04-16');
    assert.deepEqual(issue.labels.map(label => label.id), [label.id]);
  }
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Issue keyboard shortcuts', exact: true });
  await help.waitFor();
  await help.getByRole('button', { name: 'Close', exact: true }).focus();
  const helpPath = new URL(page.url()).pathname;
  await page.keyboard.press('c');
  assert.equal(new URL(page.url()).pathname, helpPath, 'A modal owns shortcuts while it is open');
  await page.keyboard.press('Escape');
  await help.waitFor({ state: 'detached' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await page.keyboard.press('Control+.');
  const expectedBranches = selectionOrder.map(id => saved.find(issue => issue.identifier === id))
    .map(issue => issue.identifier.toLowerCase() + '-' + issue.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')).join('\n');
  await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), expectedBranches);

  await page.keyboard.press('p');
  const conflictDialog = page.getByRole('dialog', { name: 'Change priority', exact: true });
  await choose(conflictDialog, 'Priority', 'medium');
  const concurrent = await context.request.patch(base + '/api/issues/' + saved[0].identifier, {
    headers: { Origin: base }, data: { expectedVersion: saved[0].version, title: saved[0].title + ' reviewed elsewhere' },
  });
  assert.equal(concurrent.status(), 200);
  const before = await Promise.all(selected.map(read));
  const conflict = await submit(conflictDialog, 409);
  const failure = await conflict.json();
  assert.ok(failure.failures.some(issue => issue.identifier === saved[0].identifier));
  assert.deepEqual(conflict.request().postDataJSON().issues.map(issue => [issue.identifier, issue.expectedVersion]).sort(),
    saved.map(issue => [issue.identifier, issue.version]).sort());
  await conflictDialog.getByRole('alert').filter({ hasText: saved[0].identifier }).waitFor();
  const apply = conflictDialog.getByRole('button', { name: 'Apply changes', exact: true });
  assert.equal(await apply.isDisabled(), true);
  const after = await Promise.all(selected.map(read));
  for (let index = 0; index < before.length; index++) {
    assert.equal(after[index].version, before[index].version);
    assert.equal(after[index].priority, before[index].priority);
    assert.equal(after[index].activity.length, before[index].activity.length);
  }
  await conflictDialog.getByRole('button', { name: 'Review current issues', exact: true }).focus();
  await page.keyboard.press('Enter');
  const acceptReview = conflictDialog.getByRole('button', { name: 'Use reviewed versions', exact: true });
  await acceptReview.waitFor();
  assert.equal(await apply.isDisabled(), true, 'Fetching current values does not authorize retry');
  await acceptReview.focus();
  await page.keyboard.press('Enter');
  assert.equal(await apply.isEnabled(), true);
  await submit(conflictDialog);
  for (const issue of await Promise.all(selected.map(read))) assert.equal(issue.priority, 'medium');

  await page.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('low');
  await ready();
  assert.equal(await rows.count(), 1);
  assert.equal(await active(), 'issue-row-' + fixtures[0].identifier, 'The first rendered row receives focus when the old row is excluded');
  const search = page.getByRole('searchbox', { name: 'Title or identifier', exact: true });
  await search.focus();
  await search.press('End');
  await page.keyboard.insertText(' s');
  await ready();
  assert.equal(await search.evaluate(node => document.activeElement === node), true, 'Typing in filters retains DOM focus');
  assert.equal(await page.getByRole('dialog').count(), 0);
  record('CMD-003', 'Rendered-group arrows, X selection, Enter detail and Escape return preserve the mounted list and selection; grouping/sort preserve row DOM focus, exclusion focuses the first row, and filter typing keeps its own focus.');
  record('CMD-004', 'Two selected real issues change status, assignee, priority, labels, estimate and due date without a mouse; native API reads verify saved fields, ? opens help, and Control-. copies one branch name per selected issue. Multi-team move and duplicate shortcuts remain partial.');
  record('VIEW-004', 'Keyboard bulk status is one atomic request; a genuine concurrent version conflict names the stale issue and changes neither issue or activity. The dialog blocks retry until current values are explicitly reviewed and accepted. Undo remains partial.');
}
