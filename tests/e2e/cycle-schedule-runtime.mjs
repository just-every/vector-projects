import assert from "node:assert/strict";
import { mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import {
  createAdminRuntime,
  bootstrapOwner,
} from "./admin-runtime-support.mjs";
const evidence = resolve(".artifacts/verification/cycle-schedule");
await mkdir(evidence, { recursive: true });
const runtime = createAdminRuntime(1440, [], {
  port: 15966,
  inspectorPort: 15967,
});
let browser, page;
try {
  runtime.initialize();
  await runtime.start();
  browser = await chromium.launch({
    headless: true,
    args: ["--use-mock-keychain", "--password-store=basic"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  await bootstrapOwner(page, runtime);
  const state = await (
    await context.request.get(runtime.base + "/api/settings/administration")
  ).json();
  const team = state.teams[0];
  // The schedule is four choices in the team's Planning tab; each stores as it changes (no Save button) and sends the whole record.
  const planning = `${runtime.base}/app/settings/teams/${team.id}/planning`;
  const choose = async (label, value) => {
    const field = page.getByLabel(label, { exact: true });
    if ((await field.inputValue()) === value) return;
    const stored = page.waitForResponse(
      (r) => r.url().endsWith("/cycle-schedule") && r.request().method() === "PUT",
    );
    await field.selectOption(value);
    assert.equal((await stored).status(), 200);
    await page.getByText("Saved", { exact: true }).first().waitFor();
    assert.equal(await field.inputValue(), value);
  };
  const create = await context.request.post(runtime.base + "/api/issues", {
    headers: { Origin: runtime.base },
    data: {
      title: "Prepare the October billing reconciliation",
      teamId: team.id,
      description:
        "Reconcile invoice totals and document any exceptions before the next delivery cycle.",
      priority: "high",
    },
  });
  assert.equal(create.status(), 201);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(planning);
    assert.equal(await page.getByRole("button", { name: /^Save(?!d)/ }).count(), 0);
    await choose("Cycle length", "2");
    await choose("Starts on", "1");
    await choose("Cooldown", "1");
    await choose("Keep upcoming", "3");
    await page.getByLabel("Cycle length", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${evidence}/CYCLE-007-scheduled-${width}.png`,
    });
    let saved = await (
      await context.request.get(runtime.base + "/api/settings/administration")
    ).json();
    let cycles = saved.cycles.filter((c) => c.teamId === team.id);
    assert.equal(cycles.length, 3);
    assert.equal(
      Date.parse(cycles[1].startsAt) - Date.parse(cycles[0].endsAt),
      7 * 86400000,
    );
    await choose("Cycle length", "1");
    await choose("Cooldown", "0");
    saved = await (
      await context.request.get(runtime.base + "/api/settings/administration")
    ).json();
    assert.deepEqual(
      saved.cycles
        .filter((c) => c.teamId === team.id)
        .map((c) => c.id)
        .sort(),
      cycles.map((c) => c.id).sort(),
    );
    assert.equal(
      Date.parse(saved.cycles[0].endsAt) - Date.parse(saved.cycles[0].startsAt),
      7 * 86400000,
    );
    await page.screenshot({
      path: `${evidence}/CYCLE-007-changed-${width}.png`,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.goto(planning);
    await page
      .getByRole("heading", { name: "Automatic cycle schedule", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${evidence}/CYCLE-007-settings-${width}.png`,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    console.log(
      `[CYCLE-007] ${width}: save three cycles with cooldown, change cadence, preserve identities, read in the team's Planning tab`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    runtime.base + "/app/issues/" + (await create.json()).identifier,
  );
  await page
    .getByRole("heading", {
      name: "Prepare the October billing reconciliation",
      exact: true,
    })
    .waitFor();
  await page.waitForFunction(
    () => !document.body.textContent.includes("Loading personal reminders"),
  );
  await page.screenshot({ path: `${evidence}/1440-app.png` });
  if (process.env.VECTOR_LISTING_CAPTURE === "true") {
    await mkdir("docs/retained-verification/ui", { recursive: true });
    await copyFile(
      `${evidence}/1440-app.png`,
      "docs/retained-verification/ui/1440-app.png",
    );
  }
} catch (error) {
  if (page)
    await page
      .screenshot({ path: `${evidence}/CYCLE-007-failure.png` })
      .catch(() => {});
  throw error;
} finally {
  if (browser) await browser.close();
  await runtime.stop();
}
