import assert from 'node:assert/strict';
import { navigate, settleReads, trackRequests, beforePrivateNavigation } from './collaboration-navigation.mjs';
import { inviteReader, readerApi } from './role-reader-support.mjs';
import { roleScreens } from './role-ui-support.mjs';
import { groupingFixture } from './core-grouping-fixture.mjs';

export async function groupingJourney({ page, context, base, state, sql, evidence, record }) {
  const owner = readerApi(page, base);
  const { marker, teams, milestones, parents, issues } = await groupingFixture(owner);
  const readers = [], denials = new Set(), errors = [], failed = [], external = [];
  const invite = async (role, teamIds = []) => {
    const name = `${marker}-${role}`;
    const reader = await inviteReader({ owner: page, browser: context.browser(), runtime: { base, state, sql },
      name, email: [name, 'vector.test'].join(String.fromCharCode(64)), role, teams: teamIds });
    readers.push(reader);
    trackRequests(reader.page);
    reader.page.on('console', message => {
      if (message.type() === 'error' && !(denials.has(message.location().url) &&
        /^Failed to load resource: the server responded with a status of (403|404)(?: \([^)]*\))?$/.test(message.text()))) errors.push(message.text());
    });
    reader.page.on('requestfailed', request => failed.push(request.failure()?.errorText));
    await reader.context.route('**/*', async route => {
      if (new URL(route.request().url()).origin === base) await route.continue();
      else { external.push(new URL(route.request().url()).origin); await route.abort(); }
    });
    return reader;
  };
  const ready = async current => {
    await current.locator('.issues-browser[data-list-state="ready"]').waitFor();
    await settleReads(current);
  };
  const target = grouping => base + '/app/issues?' + new URLSearchParams({ q: marker, priority: 'high', sort: 'oldest', grouping });
  const inspect = roleScreens(evidence);
  const capture = async (current, name) => {
    await ready(current);
    await inspect(current, current.locator('.issues-browser'), 'grouping-' + name);
    await current.setViewportSize({ width: 1440, height: 1000 });
  };
  const expectedGroups = (grouping, privateAccess = false) => grouping === 'milestone'
    ? [{ key: milestones[0].id, name: 'Same milestone', count: 51 }, { key: milestones[1].id, name: 'Same milestone', count: 1 }, { key: 'none', name: 'No milestone', count: privateAccess ? 3 : 2 }]
    : [...parents.slice(0, privateAccess ? 3 : 2).map((parent, n) => ({ key: parent.id, name: parent.identifier + ': ' + parent.title, count: n === 0 ? 51 : n === 1 ? 1 : 2 })), { key: 'none', name: 'No parent', count: privateAccess ? 1 : 2 }];
  const sorted = groups => [...groups].sort((a, b) => a.key.localeCompare(b.key));
  const assertPage = async (reader, grouping, expected, privateAccess = false) => {
    await ready(reader.page);
    assert.equal(await reader.page.getByRole('combobox', { name: 'Group by', exact: true }).inputValue(), grouping);
    const actual = await reader.page.locator('.issues-row').evaluateAll(rows => rows.map(row => row.dataset.issueIdentifier));
    assert.deepEqual([...actual].sort(), expected.map(i => i.identifier).sort());
    assert.equal(await reader.page.locator('.issues-count').innerText(), `${privateAccess ? 55 : 54} issues`);
    const query = new URLSearchParams(await reader.page.locator('.issues-browser').getAttribute('data-list-query'));
    const result = await reader.api('/issues?' + query);
    assert.deepEqual(sorted(result.allGroups), sorted(expectedGroups(grouping, privateAccess)));
    assert.deepEqual(result.issues.map(i => i.identifier), actual);
    for (const group of result.groups) {
      const row = result.issues.find(i => i.groupKey === group.key);
      const section = reader.page.locator('.issues-group').filter({ has: reader.page.locator(`[data-issue-identifier="${row.identifier}"]`) });
      const count = result.issues.filter(i => i.groupKey === group.key).length;
      assert.equal(await section.getByRole('heading').innerText(), group.name + ' ' + (count < group.count ? `Showing ${count} of ${group.count}` : group.count));
    }
    if (!privateAccess) for (const secret of [parents[2].id, parents[2].identifier, parents[2].title, issues[53].identifier]) {
      assert.ok(!JSON.stringify(result).includes(secret));
      assert.ok(!(await reader.page.locator('main:visible').first().innerText()).includes(secret));
    }
    return result;
  };
  try {
    const member = await invite('member');
    const views = [];
    for (const grouping of ['milestone', 'parent']) {
      await navigate(member.page, target(grouping));
      const first = await readerApi(member.page, base)('/issues?' + new URLSearchParams({ q: marker, priority: 'high', sort: 'oldest', grouping }));
      await assertPage(member, grouping, first.issues);
      const focused = first.issues[0].identifier;
      await member.page.locator(`[data-issue-identifier="${focused}"]`).focus();
      await member.page.getByRole('combobox', { name: 'Group by', exact: true }).selectOption(grouping === 'parent' ? 'milestone' : 'parent');
      await ready(member.page);
      assert.equal(await member.page.evaluate(() => document.activeElement?.id), 'issue-row-' + focused);
      await member.page.getByRole('combobox', { name: 'Group by', exact: true }).selectOption(grouping);
      await ready(member.page);
      await member.page.keyboard.press('ArrowDown');
      assert.equal(await member.page.evaluate(() => document.activeElement?.id), 'issue-row-' + first.issues[1].identifier);
      await member.page.getByRole('button', { name: 'Next', exact: true }).click();
      const last = await readerApi(member.page, base)('/issues?' + new URLSearchParams({ q: marker, priority: 'high', sort: 'oldest', grouping, offset: '50', revision: first.revision }));
      await assertPage(member, grouping, last.issues);
      assert.deepEqual([...first.issues, ...last.issues].map(i => i.identifier).sort(), issues.filter((_, n) => n !== 53).map(i => i.identifier).sort());
      assert.equal(new Set([...first.issues, ...last.issues].map(i => i.id)).size, 54);
      await capture(member.page, grouping + '-paged');
      await member.page.getByRole('button', { name: 'Previous', exact: true }).click();
      await ready(member.page);
      await member.page.getByRole('button', { name: 'Save view', exact: true }).click();
      await member.page.getByRole('textbox', { name: 'View name', exact: true }).fill(marker + ' ' + grouping);
      await member.page.getByRole('checkbox', { name: 'Shared with workspace', exact: true }).check();
      const created = member.page.waitForResponse(r => r.url() === base + '/api/views' && r.request().method() === 'POST');
      await member.page.getByRole('button', { name: 'Create view', exact: true }).focus();
      await member.page.keyboard.press('Enter');
      const response = await created;
      assert.equal(response.status(), 201);
      const view = await response.json();
      views.push(view);
      assert.equal(view.query.grouping, grouping);
      assert.equal(view.query.q, marker);
      assert.equal(view.query.sort, 'oldest');
      await member.page.waitForURL(base + '/app/views/' + view.id);
      await beforePrivateNavigation(member.page, member.page.url());
      await member.page.reload();
      await assertPage(member, grouping, first.issues);
      assert.deepEqual(await member.api('/views/' + view.id), view);
    }
    const view = views[1];
    await owner(`/settings/teams/${teams[1].id}/members/${member.id}`, 'PUT', { role: 'member' });
    await beforePrivateNavigation(member.page, member.page.url());
    await member.page.reload();
    const privateResult = await member.api('/issues?' + new URLSearchParams({ ...view.query }));
    await assertPage(member, 'parent', privateResult.issues, true);
    await owner(`/settings/teams/${teams[1].id}/members/${member.id}`, 'DELETE');
    await member.page.waitForFunction(() => document.querySelector('.issues-count')?.textContent === '54 issues');
    const scoped = await member.api('/issues?' + new URLSearchParams({ ...view.query }));
    await assertPage(member, 'parent', scoped.issues);
    assert.deepEqual(await member.api('/views/' + view.id), view);
    await navigate(member.page, base + '/');
    const guest = await invite('guest', [teams[0].id]);
    const viewer = await invite('viewer');
    for (const reader of [guest, viewer]) for (const grouping of ['milestone', 'parent']) {
      const saved = views.find(v => v.query.grouping === grouping);
      await navigate(reader.page, reader === viewer ? base + '/app/views/' + saved.id : target(grouping));
      const data = await reader.api('/issues?' + new URLSearchParams({ ...saved.query }));
      await assertPage(reader, grouping, data.issues);
      if (reader === viewer) {
        for (const name of ['Save view', 'Update saved controls', 'Delete view']) assert.equal(await reader.page.getByRole('button', { name, exact: true }).count(), 0);
        const before = sql('SELECT * FROM saved_views ORDER BY id');
        for (const [path, method, data] of [
          ['/views', 'POST', { name: 'Refused', query: saved.query }],
          ['/views/' + saved.id, 'PATCH', { query: { ...saved.query, grouping: 'none' } }],
          ['/views/' + saved.id, 'DELETE', undefined],
        ]) { denials.add(base + '/api' + path); await reader.api(path, method, data, 403); }
        assert.deepEqual(sql('SELECT * FROM saved_views ORDER BY id'), before);
      }
      await capture(reader.page, reader === guest ? 'guest-' + grouping : 'viewer-' + grouping);
      await navigate(reader.page, base + '/');
    }
    for (const reader of readers) assert.deepEqual(reader.errors, []);
    assert.deepEqual(errors, []); assert.deepEqual(failed, []); assert.deepEqual(external, []);
    record('VIEW-008', 'Milestone and parent groups retain stable identities, complete filtered totals over two pages, duplicate names, unassigned groups and both saved modes after reload. Current private membership withdrawal hides parent identity, invited Guest queries stay scoped, and Viewers cannot change saved views. Grouped screens have desktop and phone accessibility and overflow proof.');
    console.log('PROBE VIEW-008 milestone: filtered native list and saved view -> 54 exact identifiers across two pages; duplicate-name milestone counts 51 and 1, unassigned 2; saved reload retains mode');
    console.log('PROBE VIEW-008 parent: filtered native list and saved view -> distinct equal-title parents, counts 51 and 1, unassigned 2; private admission 55 then withdrawal 54 without parent identity; Guest scoped and Viewer writes 403 unchanged');
  } finally { for (const reader of readers) await reader.context.close(); }
}
