import assert from "node:assert/strict";
import { settingsSchema } from "../../src/core/features/settings/schema.ts";
import { beforePrivateNavigation } from "./collaboration-navigation.mjs";
import { openDisclosures } from "./ui-controls-checks.mjs";

export async function saveWorkspaceTime({ page, runtime, clause, capture }) {
  const read = async () => {
    const response = await page.request.get(runtime.base + "/api/settings");
    assert.equal(response.status(), 200);
    return settingsSchema.parse(await response.json()).workspace;
  };
  const initial = await read();
  const open = async () => {
    await page.goto(runtime.base + "/app/settings/workspace");
    await openDisclosures(page);
    await page.getByLabel("Time zone", { exact: true }).waitFor();
  };
  await open();
  const timezone = page.getByLabel("Time zone", { exact: true });
  const reminder = page.getByLabel("Daily reminder", { exact: true });
  const changedTimezone = initial.timezone === "Europe/London" ? "UTC" : "Europe/London";
  // The zone saves when the field is left: no Save button, a quiet Saved beside it that fades, and no echoed value.
  async function submit(value) {
    await timezone.fill(value);
    const [response] = await Promise.all([
      page.waitForResponse(response =>
        new URL(response.url()).pathname === "/api/settings" &&
        response.request().method() === "PATCH"),
      timezone.blur(),
    ]);
    assert.equal(response.status(), 200);
    const saved = settingsSchema.parse(await response.json()).workspace;
    assert.equal(saved.timezone, value);
    assert.equal(saved.reminderTime, initial.reminderTime);
    await page.locator(".field-saved:not(:empty)").first().waitFor();
    assert.equal(await page.getByRole("button", { name: /^Save/ }).count(), 0, "no Save button on an autosaving field");
    const current = await read();
    assert.equal(current.timezone, value);
    assert.equal(current.reminderTime, initial.reminderTime);
  }
  await clause("OPS-003", "workspace time saves as it changes and survives restart without changing the reminder", async () => {
    assert.equal(await timezone.inputValue(), initial.timezone);
    assert.equal(await reminder.inputValue(), initial.reminderTime);
    await page.goto(runtime.base + "/app/settings/people");
    await page.getByRole("link", { name: new RegExp(runtime.config.FIRST_OWNER_NAME) }).first().click();
    await page.getByText("The last Owner cannot be removed.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", {
      name: /^(Remove|Leave)/,
    }).count(), 0, "the sole operator cannot be removed from Settings");
    await open();
    await submit(changedTimezone);
    await capture("workspace-time-saved");
    // Drain this origin's private reads, then unload the app without mounting
    // another hydrated document that can fetch assets while its Worker stops.
    // The browser context retains the native session for the restart readback.
    await beforePrivateNavigation(page, page.url());
    await page.goto("about:blank", { waitUntil: "load" });
    await runtime.stop();
    await runtime.start();
    await open();
    assert.equal(await timezone.inputValue(), changedTimezone);
    assert.equal(await reminder.inputValue(), initial.reminderTime);
    const persisted = await read();
    assert.equal(persisted.timezone, changedTimezone);
    assert.equal(persisted.reminderTime, initial.reminderTime);
    await capture("workspace-time-after-restart");
    // Later calendar journeys use the installation's original workspace zone.
    await submit(initial.timezone);
  });
}
