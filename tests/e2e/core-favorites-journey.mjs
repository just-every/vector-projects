import assert from 'node:assert/strict';
import { navigate, settleReads, trackRequests } from './collaboration-navigation.mjs';
import { inviteReader, readerApi } from './role-reader-support.mjs';
import { readDevelopmentLink } from './outbox-session.mjs';
import { roleScreens } from './role-ui-support.mjs';
import { readLocalD1 } from './local-d1-read.mjs';

// Independent native sign-ins, never a copied profile or session. The same
// helper is reached by the ordinary core keyboard journey in push Verify.
export async function favoritesJourney({ page, context, base, state, sql, evidence, record }) {
  const owner = readerApi(page, base), firstBrowser = context.browser();
  const marker = 'synthetic-vector-' + Date.now();
  const email = [marker, 'vector.test'].join(String.fromCharCode(64));
  const team = (await owner('/settings/teams', 'POST', { name: marker + ' private', identifierPrefix: 'FAV' + marker.slice(-6).replaceAll(/\d/g, n => String.fromCharCode(65 + Number(n))), isPrivate: true })).teams.find(t => t.name === marker + ' private');
  const ownerId = (await owner('/session')).operatorId;
  const project = (await owner('/settings/projects', 'POST', { name: marker + ' project', leadOperatorId: ownerId })).projects.find(p => p.name === marker + ' project');
  await owner('/issues', 'POST', { teamId: team.id, projectId: project.id, title: marker + ' private work' }, 201);
  const publicTeam = (await owner('/options')).teams.find(t => !t.isPrivate && !t.archivedAt);
  const issue = await owner('/issues', 'POST', { teamId: publicTeam.id, title: marker + ' issue' }, 201);
  const member = await inviteReader({ owner: page, browser: firstBrowser, runtime: { base, state, sql }, email, name: marker + ' member', role: 'member' });
  await owner(`/settings/teams/${team.id}/members/${member.id}`, 'PUT', { role: 'member' });
  const view = await member.api('/views', 'POST', { name: marker + ' view', query: { team: publicTeam.id, priority: 'none' } }, 201);
  const definition = await member.api('/views/' + view.id);
  let secondBrowser, secondContext, secondPage;
  const errors = [];
  member.page.on('pageerror', error => errors.push(error.message));
  trackRequests(member.page);
  const nav = target => target.locator('nav[aria-label="Favorites"]:visible');
  const ready = async target => { await nav(target).locator(':scope[data-favorites-state="ready"]').waitFor(); await settleReads(target); };
  const pin = async (path, kind, id) => {
    await navigate(member.page, base + path);
    await nav(member.page).getByRole('button', { name: 'Pin this ' + kind, exact: true }).waitFor();
    const saved = member.page.waitForResponse(r => r.url() === base + '/api/favorites' && r.request().method() === 'PUT');
    await nav(member.page).getByRole('button', { name: 'Pin this ' + kind, exact: true }).focus();
    await member.page.keyboard.press('Enter');
    assert.equal((await saved).status(), 200);
    await nav(member.page).locator(`[data-favorite-id="${id}"]`).waitFor();
  };
  try {
    const subjectReads = [];
    const observeSubject = request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/favorites/subjects/')) subjectReads.push(path);
    };
    member.page.on('request', observeSubject);
    try {
      for (const path of ['/app/issues/backlog', '/app/projects/new']) {
        await navigate(member.page, base + path);
        await ready(member.page);
        assert.equal(await nav(member.page).getByRole('button', { name: /^(?:Pin|Unpin) this / }).count(), 0,
          'Collection and creation pages have no pinnable subject');
      }
      assert.deepEqual(subjectReads, [], 'Static routes never request a favorite subject');
    } finally {
      member.page.off('request', observeSubject);
    }
    await pin('/app/issues/' + issue.identifier, 'issue', issue.id);
    await pin('/app/projects/' + project.id, 'project', project.id);
    await pin('/app/views/' + view.id, 'view', view.id);
    await nav(member.page).getByRole('button', { name: 'Organize', exact: true }).click();
    await nav(member.page).getByLabel('Folder name', { exact: true }).fill('Delivery work');
    const folderSaved = member.page.waitForResponse(r => r.url() === base + '/api/favorites' && r.request().method() === 'PUT');
    await nav(member.page).getByRole('button', { name: 'Create folder', exact: true }).focus();
    await member.page.keyboard.press('Enter');
    assert.equal((await folderSaved).status(), 200);
    const collection = await member.api('/favorites');
    const folderId = collection.folders.find(f => f.name === 'Delivery work').id;
    const moved = member.page.waitForResponse(r => r.url() === base + '/api/favorites' && r.request().method() === 'PUT');
    await nav(member.page).getByRole('combobox', { name: 'Folder for ' + view.name, exact: true }).selectOption(folderId);
    assert.equal((await moved).status(), 200);
    await nav(member.page).getByRole('region', { name: 'Delivery work', exact: true }).getByRole('link', { name: view.name, exact: true }).waitFor();
    const reordered = member.page.waitForResponse(r => r.url() === base + '/api/favorites' && r.request().method() === 'PUT');
    await nav(member.page).getByRole('button', { name: 'Move ' + project.name + ' up', exact: true }).focus();
    await member.page.keyboard.press('Enter');
    assert.equal((await reordered).status(), 200);
    const expected = [project.id, issue.id, view.id];
    assert.deepEqual((await member.api('/favorites')).entries.map(e => e.subjectId), expected);
    await navigate(member.page, base + '/app/views/' + view.id);
    await ready(member.page);
    assert.deepEqual(await nav(member.page).locator('[data-favorite-id]').evaluateAll(rows => rows.map(r => r.dataset.favoriteId)), expected);
    await nav(member.page).getByRole('region', { name: 'Delivery work', exact: true }).getByRole('link', { name: view.name, exact: true }).waitFor();
    assert.deepEqual(await member.api('/views/' + view.id), definition, 'Pinning and organization never mutate the saved definition');
    assert.deepEqual((await owner('/favorites')).entries, [], 'Another member does not receive this collection');

    secondBrowser = await firstBrowser.browserType().launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
    secondContext = await secondBrowser.newContext({ viewport: { width: 1440, height: 1000 } });
    secondPage = await secondContext.newPage();
    secondPage.setDefaultTimeout(20000);
    secondPage.on('pageerror', error => errors.push(error.message));
    trackRequests(secondPage);
    await secondPage.goto(base + '/signin');
    await secondPage.getByLabel('Email', { exact: true }).fill(email);
    const requested = secondPage.waitForResponse(r => new URL(r.url()).pathname === '/auth/request' && r.request().method() === 'POST');
    await secondPage.getByRole('button', { name: 'Send sign-in link', exact: true }).click();
    assert.equal((await requested).status(), 202);
    const link = await readDevelopmentLink(base, secondContext.request, email, state);
    await secondPage.goto(link);
    await secondPage.getByRole('button', { name: 'Confirm', exact: true }).click();
    await secondPage.waitForURL(base + '/app');
    const secondApi = readerApi(secondPage, base);
    assert.equal((await secondApi('/session')).operatorId, member.id);
    const sessions = readLocalD1(state, `SELECT count(DISTINCT s.id) n FROM oa_sessions s JOIN vector_auth_operators m ON m.auth_id=s.operator_id WHERE m.operator_id='${member.id}' AND s.revoked_at IS NULL`);
    assert.ok(sessions[0].n >= 2, 'Two independent native sessions exist');
    await navigate(secondPage, base + '/app/views/' + view.id);
    await ready(secondPage);
    assert.deepEqual(await nav(secondPage).locator('[data-favorite-id]').evaluateAll(rows => rows.map(r => r.dataset.favoriteId)), expected);
    await nav(secondPage).getByRole('region', { name: 'Delivery work', exact: true }).getByRole('link', { name: view.name, exact: true }).waitFor();
    await nav(secondPage).getByRole('button', { name: 'Organize', exact: true }).click();
    // Assertions run at 1440; the same changed navigation is inspected once at
    // desktop and phone widths, including keyboard focus and hydration.
    const inspect = roleScreens(evidence);
    await inspect(secondPage, secondPage.locator('main:visible').first(), 'favorites-view');
    await secondPage.setViewportSize({ width: 390, height: 844 });
    await secondPage.locator('.app-mobile-favorites > summary').click();
    await nav(secondPage).getByRole('button', { name: 'Organize', exact: true }).click();
    await nav(secondPage).getByRole('combobox', { name: 'Folder for ' + view.name, exact: true }).focus();
    assert.ok(await nav(secondPage).getByRole('combobox', { name: 'Folder for ' + view.name, exact: true }).evaluate(el => el === document.activeElement));
    assert.ok(await secondPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await secondPage.screenshot({ path: evidence + '/favorites-navigation-390.png' });
    await secondPage.setViewportSize({ width: 1440, height: 1000 });
    await secondPage.screenshot({ path: evidence + '/favorites-navigation-1440.png' });

    await owner(`/settings/teams/${team.id}/members/${member.id}`, 'DELETE');
    const withdrawn = await secondApi('/favorites');
    assert.deepEqual(withdrawn.entries.map(e => e.subjectId), [issue.id, view.id]);
    assert.ok(!JSON.stringify(withdrawn).includes(project.name));
    await navigate(secondPage, base + '/app/views/' + view.id);
    await ready(secondPage);
    assert.equal(await nav(secondPage).getByRole('link', { name: project.name, exact: true }).count(), 0);
    assert.ok(!(await secondPage.locator('body').innerText()).includes(project.name));
    await member.api('/views/' + view.id, 'DELETE');
    const deletion = await secondApi('/favorites');
    assert.deepEqual(deletion.entries.map(e => e.subjectId), [issue.id]);
    assert.ok(!JSON.stringify(deletion).includes(view.name));
    await navigate(secondPage, base + '/app/issues/' + issue.identifier);
    await ready(secondPage);
    assert.equal(await nav(secondPage).getByRole('link', { name: view.name, exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(member.errors, []);
    record('VIEW-010', 'A Member pins issue, project and saved view by keyboard, folders the view and reorders the project; a separate Chromium and independent native sign-in reload the same exact order and folder. Saved definitions are unchanged, another member is isolated, private-project withdrawal and view deletion remove titles from HTTP and navigation. Both widths pass accessibility, keyboard, overflow and hydration proof.');
    console.log('PROBE VIEW-010 subject-admission: Backlog and New project pages -> no pin control and no favorite-subject request');
    console.log('PROBE VIEW-010 pins-and-sync: native Member pages and second independently authenticated Chromium -> issue, project, view, Delivery work folder and exact project then issue then view order retained');
    console.log('PROBE VIEW-010 current-visibility: private-project membership withdrawal and view deletion -> subject and former title absent in HTTP and rendered Favorites');
  } finally {
    await member.context.close();
    if (secondBrowser) await secondBrowser.close();
  }
}
