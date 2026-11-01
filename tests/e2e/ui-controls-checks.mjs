import { expect } from '@playwright/test';
import assert from "node:assert/strict";

export async function openDisclosures(page) {
  // Page disclosures may be nested; opening a parent reveals children. Shell menus stay user-controlled.
  await page.locator("main:visible").waitFor({ state: "visible" });
  await page.locator("main:visible details").evaluateAll((elements) => {
    for (const element of elements)
      if (element.getClientRects().length) element.open = true;
  });
}

export { openAdministrationForm } from "./ui-administration-form.mjs";
export async function openAccountMenu(page) {
  const trigger = page.locator('.app-mobile-account-trigger');
  if (await trigger.isVisible() && await trigger.getAttribute('aria-expanded') === 'false') {
    await expect(trigger).toBeEnabled({ timeout: 30_000 });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await page.locator('.app-mobile-account-menu').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    assert.equal(await trigger.evaluate(element => document.activeElement === element), true,
      'Escape returns focus to the account control');
    await page.keyboard.press('Space');
    await page.locator('.app-mobile-account-menu').waitFor({ state: 'visible' });
  }
}

export async function assertSettingsSections(page, label) {
  // The one section list: every section an Owner opens, no Projects or Cycles, and Restore only while pending.
  await page.goto(new URL("/app/settings", page.url()).href);
  const list = page.getByRole("navigation", { name: "Settings sections" });
  await list.waitFor();
  for (const name of ["Profile", "Notifications", "Workspace", "People", "Teams", "Labels", "Connections", "Developers", "Move in", "Audit log"])
    assert.equal(await list.getByRole("link", { name: new RegExp("^" + name + "( |$)") }).count(), 1, `${label}: ${name} entry`);
  for (const name of ["Projects", "Cycles", "Restore"])
    assert.equal(await list.getByRole("link", { name: new RegExp("^" + name + "( |$)") }).count(), 0, `${label}: no ${name} entry`);
  await openAccountMenu(page);
  const settings = page
    .getByRole("link", { name: "Settings", exact: true })
    .filter({ visible: true })
    .first();
  assert.equal(
    await settings.getAttribute("aria-current"),
    "page",
    `${label}: visible Settings current navigation state`,
  );
  await settings.focus();
  assert.equal(
    await settings.evaluate((element) => element === document.activeElement),
    true,
    `${label}: Settings reachable by keyboard`,
  );
}
