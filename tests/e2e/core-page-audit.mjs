import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { beforePrivateNavigation, settleReads } from './collaboration-navigation.mjs';
const require = createRequire(import.meta.url);

export async function pageAudit(page, base, issue, evidence, record) {
  const results = [];
  const source = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
  for (const path of ['/app', '/app/my-work', '/app/issues', '/app/issues/backlog', '/app/board', '/app/projects', '/app/projects/new', '/app/cycles', '/app/inbox', '/app/inbox/snoozed', '/app/views', '/app/settings', '/app/settings/people', '/app/search', '/app/new-issue', '/app/new', '/app/issues/' + issue]) {
    await beforePrivateNavigation(page, base + path);
    await page.goto(base + path);
    await beforePrivateNavigation(page, page.url());
    assert.equal((await page.reload()).status(), 200, path + ': destination survives a document reload');
    await page.locator('main:visible').first().waitFor();
    await settleReads(page);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(source => {
      const script = document.createElement('script');
      const nonce = document.querySelector('script[nonce]')?.nonce;
      if (nonce) script.nonce = nonce;
      script.textContent = source;
      document.head.append(script);
    }, source);
    const axe = await page.evaluate(async () => (await window.axe.run()).violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })));
    const geometry = [];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      geometry.push(await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth })));
    }
    results.push({ path, axe, geometry });
    await writeFile(evidence + '/core-page-audit.json', JSON.stringify(results, null, 2));
    assert.deepEqual(axe, [], path + ': no serious/critical axe violations');
    assert.ok(geometry.every(g => g.documentWidth <= g.width), path + ': no horizontal overflow');
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  record('RENDER-AUDIT', 'App pages and plausible route aliases survive document reloads, a serious/critical axe audit and desktop/mobile overflow checks.');
}
