import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createAdminRuntime, bootstrapOwner } from './admin-runtime-support.mjs';
import { beforePrivateNavigation, settleReads } from './collaboration-navigation.mjs';
import { contrastFailures, canvasLuminance } from './theme-contrast.mjs';
// VIEW-011: System follows the device before first paint, a saved choice follows the member, both themes pass AA for text and controls.
const output = resolve(process.env.VECTOR_THEME_SHOTS ?? '.artifacts/verification/theme');
await mkdir(output, { recursive: true });
const runtime = createAdminRuntime(1440, [], { port: 15976, inspectorPort: 15977 });
const launch = { headless: true, args: ['--use-mock-keychain', '--password-store=basic'] };
const isDark = async page => (await canvasLuminance(page)) < 0.2;
let browser, second, page;
async function signIn(target) {
  await target.goto(runtime.base + '/signin');
  await target.getByLabel('Email', { exact: true }).fill(runtime.config.FIRST_OWNER_EMAIL);
  const sent = target.waitForResponse(r => new URL(r.url()).pathname === '/auth/request' && r.request().method() === 'POST');
  await target.getByRole('button', { name: 'Send sign-in link', exact: true }).click();
  assert.equal((await sent).status(), 202);
  const link = runtime.sql("SELECT json_extract(message,'$.text') AS t FROM rer_mail_development_outbox ORDER BY created_at DESC,sequence DESC LIMIT 1")[0].t.match(/https?:\/\/[^\s]+/)[0];
  await target.goto(link);
  await target.getByRole('button', { name: 'Confirm', exact: true }).click();
  await target.waitForURL(url => url.pathname.startsWith('/app'));
}
async function show(target, path) {
  await beforePrivateNavigation(target, runtime.base + path);
  await target.goto(runtime.base + path);
  await target.locator('main:visible').first().waitFor();
  await settleReads(target);
  await target.evaluate(() => document.fonts.ready);
}
try {
  runtime.initialize(); await runtime.start();
  browser = await chromium.launch(launch);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  await bootstrapOwner(page, runtime);
  const api = context.request, headers = { Origin: runtime.base };
  const team = (await (await api.get(runtime.base + '/api/settings/administration')).json()).teams[0];
  const me = (await (await api.get(runtime.base + '/api/session')).json()).operatorId;
  const target = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const projects = await api.post(runtime.base + '/api/settings/projects', { headers, data: { name: 'Payment confirmations', leadOperatorId: me, description: 'Keep confirmations available during provider delays.', targetDate: target } });
  assert.equal(projects.status(), 200);
  const project = (await projects.json()).projects.find(p => p.name === 'Payment confirmations');
  assert.equal((await api.patch(runtime.base + '/api/settings/projects/' + project.id, { headers, data: { lifecycle: 'active' } })).status(), 200);
  let issue;
  for (const [title, priority] of [['Reconcile October subscription invoices', 'high'], ['Draft the carrier rate review', 'urgent'], ['Archive last quarter shipping labels', 'low']]) {
    const response = await api.post(runtime.base + '/api/issues', { headers, data: { title, teamId: team.id, priority, projectId: project.id, dueDate: target,
      description: 'Compare the ledger export with the processor report.\n\n```js\nconst total = invoices.reduce((sum, item) => sum + item.amount, 0) // cents\n```' } });
    assert.equal(response.status(), 201); issue ??= await response.json();
  }
  assert.equal((await (await api.get(runtime.base + '/api/settings/appearance')).json()).theme, 'system', 'System is the default');

  // First paint: the server renders the choice on <html>; with scripts off the page is already dark.
  const html = await (await api.get(runtime.base + '/app/issues')).text();
  assert.match(html, /<html[^>]*data-theme="system"/);
  const noScript = await browser.newContext({ storageState: await context.storageState(), colorScheme: 'dark', javaScriptEnabled: false });
  const still = await noScript.newPage();
  await still.goto(runtime.base + '/app/issues'); await still.locator('main').first().waitFor();
  assert.ok(await isDark(still), 'dark before any script runs'); await noScript.close();

  const screens = [['issues', '/app/issues'], ['issue', '/app/issues/' + issue.identifier], ['board', '/app/board'], ['projects', '/app/projects'], ['project', '/app/projects/' + project.id], ['settings', '/app/settings']];
  async function auditTheme(theme) {
    const audit = {};
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const [name, path] of screens) {
        await show(page, path);
        assert.equal(await isDark(page), theme === 'dark', `${name} ${width} is ${theme}`);
        const failures = await contrastFailures(page);
        if (failures.length) audit[`${theme}-${name}-${width}`] = failures;
        await page.screenshot({ path: `${output}/${theme}-${name}-${width}.png`, fullPage: width === 390 && name !== 'settings' });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${width}: no horizontal overflow`);
      }
    }
    await writeFile(`${output}/contrast-${theme}.json`, JSON.stringify(audit, null, 2));
    assert.deepEqual(audit, {}, `${theme}: no AA text or control contrast failure on any screen`);
  }
  await auditTheme('dark');

  // Light is saved for the member: it survives a reload and reaches a second browser on a dark device.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await show(page, '/app/settings/profile');
  const saved = page.waitForResponse(r => r.url().endsWith('/api/settings/appearance') && r.request().method() === 'PATCH');
  await page.getByRole('radio', { name: /^Light/ }).check();
  assert.equal((await saved).status(), 200);
  assert.equal(await isDark(page), false, 'Light applies at once');
  await page.reload(); await page.locator('main:visible').first().waitFor();
  assert.equal(await isDark(page), false, 'Light after reload on a dark device');
  second = await chromium.launch(launch);
  const other = await (await second.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })).newPage();
  await signIn(other); await show(other, '/app/issues');
  assert.equal(await isDark(other), false, 'second browser of the same member is light');
  await other.screenshot({ path: `${output}/second-browser-light-390.png` });
  await auditTheme('light');

  // System follows a live device change without a reload.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await show(page, '/app/settings/profile');
  await page.getByRole('radio', { name: /^System/ }).check();
  await page.locator('.field-saved:not(:empty)').first().waitFor();
  await page.evaluate(() => { window.__sameDocument = true; });
  assert.ok(await isDark(page), 'System on a dark device');
  await page.emulateMedia({ colorScheme: 'light' });
  assert.equal(await isDark(page), false, 'System follows the device to light');
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.ok(await isDark(page), 'System follows the device back to dark');
  assert.equal(await page.evaluate(() => window.__sameDocument), true, 'no reload');
  assert.equal((await (await api.get(runtime.base + '/api/settings/appearance')).json()).theme, 'system');
  assert.equal((await api.patch(runtime.base + '/api/settings/appearance', { headers, data: { theme: 'sepia' } })).status(), 400);
  console.log('[VIEW-011] dark first paint, per-member Light across reload and a second browser, live System, AA text and control contrast in both themes at 1440/390');
} catch (error) { if (page) await page.screenshot({ path: output + '/failure.png' }).catch(() => {}); throw error; }
finally { if (browser) await browser.close(); if (second) await second.close(); await runtime.stop(); }
