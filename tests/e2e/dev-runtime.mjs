import { openAccountMenu } from './ui-controls-checks.mjs';
import { reviewDevelopmentImport } from './data-development-journey.mjs';
import { finishFirstRun } from './first-run-fixture.mjs';
import { openGate, readCheckoutKey } from './dev-gate.mjs';
import { navigate, settleReads } from "./collaboration-navigation.mjs";
import { verificationDirectory } from '../../scripts/verification-paths.mjs';
import { observeUiFailure, writeUiFailureDiagnostic } from "./ui-failure-diagnostics.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { developmentOrigin } from '../../scripts/development-origin.mjs';
import { settingsSchema } from '../../src/core/features/settings/schema.ts';
const base = await developmentOrigin(), evidence = verificationDirectory;
await mkdir(evidence, { recursive: true });
assert.equal((await fetch(base + "/health")).status, 200);
for(const path of ["/","/signin","/does-not-exist"])assert.equal((await fetch(base+path)).status,path==="/does-not-exist"?404:200);
const sent = await fetch(base + "/auth/request", {
  method: "POST",
  headers: { Origin: base, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "sarah@vector.test" }),
});
assert.equal(sent.status, 202);
const settingsActionBudgetMs = 30_000;
const remainingSettingsActionMs = (deadline) => {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Workspace time action exceeded its original 30-second budget.");
  return remaining;
};
const responseJsonWithinSettingsBudget = async (response, deadline) => {
  let timer;
  try {
    return await Promise.race([
      response.json(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Settings response body exceeded the original action budget.")),
          remainingSettingsActionMs(deadline),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const output = execFileSync(
  "pnpm",
  [
    "exec",
    "wrangler",
    "d1",
    "execute",
    "vector-local",
    "--local",
    "--config",
    "wrangler.jsonc",
    "--persist-to",
    ".wrangler/state",
    "--command",
    "SELECT json_extract(message,'$.text') AS sign_in_url FROM rer_mail_development_outbox ORDER BY created_at DESC LIMIT 1",
    "--json",
  ],
  { encoding: "utf8" },
);
const link = JSON.parse(output)[0].results[0].sign_in_url.match(/https?:\/\/[^\s]+/)[0];
const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
let trace, capturePage, observed;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(),
    errors = [],
    failed = [],
    paths = new Set(), badResponses = [];
  capturePage = page;
  // Vite serves route modules as scripts, so a stalled module load is recorded too.
  observed = observeUiFailure(page, base, ["fetch", "xhr", "script"]);
  trace = { errors, failed, badResponses, paths };
  page.on('response', r => { if (r.status() >= 400) badResponses.push({url:r.url(),status:r.status()}) });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("requestfailed", (r) => failed.push(r.url()));
  page.on("request", (r) => {
    paths.add(new URL(r.url()).pathname);
  });
  await navigate(page, link);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", {name:"Confirm",exact:true}).click();
  await page.waitForURL(url=>["/app","/setup"].includes(new URL(url).pathname));
  await page.waitForLoadState("networkidle");
  await finishFirstRun(page,base);await page.goto(base+"/app");
  await page.getByRole("heading", { name: "Current", exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "Why this needs attention", exact: true })
    .waitFor();
  // Leaving Current unmounts the inspector; let its reads finish first.
  await settleReads(page);
  // SSR now contains Current’s data before Vite finishes loading the client.
  // Begin the client-navigation assertion after its scripts have loaded.
  await page.waitForLoadState("networkidle");
  let origin = await page.evaluate(() => performance.timeOrigin);
  await settleReads(page);
  await page
    .getByRole("link", { name: "My work", exact: true })
    .first()
    .click();
  await page.getByRole("heading", { name: "My work", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  await settleReads(page);
  await page
    .getByRole("link", { name: "Projects", exact: true })
    .first()
    .click();
  await page.getByRole("heading", { name: "Projects", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  // VIEW-001/002/005 and SEARCH-001: new modules load through hydrated client navigation.
  await settleReads(page);
  await page.getByRole("link", { name: "Issues", exact: true }).filter({ visible: true }).first().click();
  await page.getByRole("heading", { name: "Issues", exact: true }).waitFor();
  await page.getByLabel("Title or identifier").waitFor();
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  await settleReads(page);
  await page.getByRole("link", { name: "Board", exact: true }).filter({ visible: true }).first().click();
  await page.getByRole("heading", { name: "Board", exact: true }).waitFor();
  await page.getByLabel("Team", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await page.getByLabel("View name", { exact: true }).fill(`Development navigation ${Date.now()}`);
  // Read the body as it arrives; the page navigates to the new view next.
  let viewBody;
  const viewReceipt = page.waitForResponse(r => {
    const hit = new URL(r.url()).pathname === "/api/views" && r.request().method() === "POST";
    if (hit) viewBody = r.json();
    return hit;
  });
  await page.getByRole("button", { name: "Create view", exact: true }).click();
  const viewResponse = await viewReceipt;
  assert.equal(viewResponse.status(), 201);
  const devView = await viewBody;
  await page.waitForURL(base + `/app/views/${devView.id}`);
  await page.getByRole("heading", { name: devView.name, exact: true }).waitFor();
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin, "saved view creation uses client navigation");
  await settleReads(page);
  await page.getByRole("link", { name: "Issues", exact: true }).filter({ visible: true }).first().click();
  await page.getByRole("heading", { name: "Issues", exact: true }).waitFor();
  await settleReads(page);
  await page.getByRole("navigation", { name: "Saved views", exact: true }).getByRole("link", { name: new RegExp(devView.name) }).filter({ visible: true }).first().click();
  await page.getByRole("heading", { name: devView.name, exact: true }).waitFor();
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin, "saved view navigation remains hydrated");
  await settleReads(page);
  await page.getByRole("button", { name: /Search/ }).filter({ visible: true }).first().click();
  const devPalette = page.getByRole("dialog", { name: "Command palette" });
  await devPalette.getByRole("textbox", { name: "Search issues, projects, and commands" }).fill("Open Search");
  // Choosing closes the palette; let its search read finish first.
  await settleReads(page);
  await devPalette.getByRole("option", { name: /^Open Search/ }).click();
  await page.getByRole("heading", { name: "Search", exact: true }).waitFor();
  await page.getByLabel("Search workspace", { exact: true }).fill("FLW-842");
  await page.getByRole("link", { name: /FLW-842/ }).waitFor();
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin, "search navigation remains hydrated");
  await settleReads(page);
  await openAccountMenu(page);
  await page.getByRole("link", { name: "Settings", exact: true }).filter({ visible: true }).first().click();
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  // The section list opens each page in the pane without a new document.
  const settingsSections = page.getByRole("navigation", { name: "Settings sections" });
  await settingsSections.getByRole("link", { name: "Workspace", exact: true }).click();
  await page.getByRole("heading", { name: "Workspace", exact: true, level: 1 }).waitFor();
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin, "Settings navigation remains hydrated");
  const initialSettings = await page.evaluate(async () => {
    const response = await fetch("/api/settings");
    return { status: response.status, body: await response.json() };
  });
  assert.equal(initialSettings.status, 200);
  const initialWorkspace = settingsSchema.parse(initialSettings.body).workspace;
  assert.equal(typeof initialWorkspace.timezone, "string");
  assert.match(initialWorkspace.reminderTime, /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/);
  const timezone = page.getByLabel("Time zone", { exact: true });
  const reminderTime = page.getByLabel("Daily reminder", { exact: true });
  assert.equal(await timezone.inputValue(), initialWorkspace.timezone);
  assert.equal(await reminderTime.inputValue(), initialWorkspace.reminderTime);
  const savedTimezone =
    initialWorkspace.timezone === "Australia/Brisbane" ? "UTC" : "Australia/Brisbane";
  assert.notEqual(savedTimezone, initialWorkspace.timezone);
  await timezone.fill(savedTimezone);
  // The zone saves when the field is left: no Save button.
  const settingsActionDeadline = Date.now() + settingsActionBudgetMs;
  const settingsSave = page
    .waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/settings" &&
        response.request().method() === "PATCH",
      { timeout: remainingSettingsActionMs(settingsActionDeadline) },
    )
    .then(async (response) => {
      const receivedBody = await responseJsonWithinSettingsBudget(
        response,
        settingsActionDeadline,
      );
      return {
        response,
        body: response.ok() ? settingsSchema.parse(receivedBody) : receivedBody,
      };
    });
  const settingsSaveClick = Promise.resolve().then(() =>
    timezone.blur({
      timeout: remainingSettingsActionMs(settingsActionDeadline),
    }),
  );
  const [clickOutcome, saveOutcome] = await Promise.allSettled([
    settingsSaveClick,
    settingsSave,
  ]);
  if (clickOutcome.status === "rejected" || saveOutcome.status === "rejected")
    throw new AggregateError(
      [clickOutcome, saveOutcome]
        .filter((outcome) => outcome.status === "rejected")
        .map((outcome) => outcome.reason),
      "Workspace time submission did not settle successfully.",
    );
  const saveReceipt = saveOutcome.value;
  assert.equal(saveReceipt.response.status(), 200);
  assert.equal(saveReceipt.body.workspace.timezone, savedTimezone);
  assert.equal(saveReceipt.body.workspace.reminderTime, initialWorkspace.reminderTime);
  // A quiet Saved appears beside the zone and fades; nothing echoes the value.
  await page.locator(".field-saved:not(:empty)").first()
    .waitFor({ timeout: remainingSettingsActionMs(settingsActionDeadline) });
  assert.equal(await page.getByRole("button", { name: /^Save/ }).count(), 0);
  const persistedSettings = await page.evaluate(async () => {
    const response = await fetch("/api/settings");
    return { status: response.status, body: await response.json() };
  });
  assert.equal(persistedSettings.status, 200);
  const persistedWorkspace = settingsSchema.parse(persistedSettings.body).workspace;
  assert.equal(persistedWorkspace.timezone, savedTimezone);
  assert.equal(persistedWorkspace.reminderTime, initialWorkspace.reminderTime);
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  await settingsSections.getByRole("link", { name: "Move in", exact: true }).click();
  await page.getByRole("heading", { name: "Move in", exact: true, level: 1 }).waitFor();
  await reviewDevelopmentImport(page, base);
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin, "Data preflight remains hydrated");
  await settingsSections.getByRole("link", { name: "Developers", exact: true }).click();
  await page.getByRole("heading", { name: "Developers", exact: true, level: 1 }).waitFor();
  const integrations = page.locator("#integrations");
  await integrations.getByRole("heading", {name:"API tokens",exact:true}).waitFor();
  const usage = page.waitForResponse(r => new URL(r.url()).pathname === "/api/settings/integrations/tokens/usage");
  await integrations.getByRole("button", {name:"Refresh token usage",exact:true}).click();
  assert.equal((await usage).status(),200);
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin, "Integration usage remains hydrated");
  await settingsSections.getByRole("link", { name: "Notifications", exact: true }).click();
  await page.getByRole("region", { name: "Notifications", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin, "Settings sections remain hydrated");
  await settleReads(page);
  await page.getByRole("link", { name: /^Inbox/ }).filter({ visible: true }).first().click();
  await page.getByRole("heading", { name: "Inbox", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  await settleReads(page);
  await openAccountMenu(page);
  await page.getByRole("link", { name: "Settings", exact: true }).filter({ visible: true }).first().click();
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Workspace", exact: true }).click();
  await page.getByRole("heading", { name: "Workspace", exact: true, level: 1 }).waitFor();
  await page.getByLabel("Time zone", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Time zone", { exact: true }).inputValue(), savedTimezone);
  assert.equal(await page.getByLabel("Daily reminder", { exact: true }).inputValue(), initialWorkspace.reminderTime);
  await settleReads(page);
  // Cycles are no longer a Settings section, so there is no in-app link from here yet; open the list in a fresh document.
  await navigate(page, base + "/app/cycles");
  await page.waitForLoadState("networkidle");
  origin = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole("heading", { name: "Cycles", exact: true, level: 1 }).waitFor();
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  const cycleLink = page.getByRole("link", { name: /^Open / }).first();
  await cycleLink.waitFor();
  const cycleName = (await cycleLink.textContent()).trim().replace(/^Open /, "");
  await settleReads(page);
  await cycleLink.click();
  await page.waitForURL(new RegExp("/app/cycles/[^/]+$"));
  await page.getByRole("heading", { name: cycleName, exact: true, level: 1 }).waitFor();
  await page.getByRole("form", { name: "Commit issue to cycle", exact: true }).waitFor();
  // The commit picker reads candidates on arrival; let it finish before leaving.
  await settleReads(page);
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  await settleReads(page);
  await page.getByRole("link", { name: "← Cycles", exact: true }).click();
  await page.waitForURL(base + "/app/cycles");
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  await settleReads(page);
  await page
    .getByRole("link", { name: /New issue/ })
    .first()
    .click();
  await page.getByRole("heading", { name: "New issue", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  await settleReads(page);
  await page
    .getByRole("link", { name: "Current", exact: true })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "Why this needs attention", exact: true })
    .waitFor();
  await page.screenshot({ path: evidence + "/current-dev-1440.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: evidence + "/current-dev-mobile.png" });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForLoadState("networkidle");
  // Dev v2 uses the checkout key and one-click owner entry, including when
  // this journey previously exercised an ordinary email confirmation session.
  await openGate(page.context(), base, await readCheckoutKey(process.cwd()));
  await navigate(page, base + "/signin");
  // Base's one-click page lists the owner first, then other local people.
  await page.getByRole("heading", { name: /^Sign in to / }).waitFor();
  // Let the public document's resources finish before leaving it. Otherwise
  // an immediate sign-in click can cancel a still-loading branding resource.
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: /^Sign in as / }).first().click();
  await page.waitForURL(base + "/app");
  await page.getByRole("heading", { name: "Current", exact: true }).waitFor();
  const localSession = await page.request.get(base + "/auth/session");
  assert.equal(localSession.status(), 200);
  const identity = await localSession.json();
  assert.equal(identity.kind, "dev");
  assert.equal(identity.operator.email, "sarah@vector.test");
  assert.equal((await page.request.get(base + "/__dev/outbox")).status(), 404);
  await settleReads(page);
  await navigate(page, base + "/");
  await page.waitForURL(base + "/");
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  assert.deepEqual(badResponses, [], "development navigation has no failed responses");
  await writeFile(
    evidence + "/dev-runtime-results.json",
    JSON.stringify(
      { passed: true, errors, failed, requestedPaths: [...paths].sort() },
      null,
      2,
    ),
  );
  console.log(
    "Vite development hydration, native sessions, client navigation and responsive capture passed.",
  );
} catch (error) {
  await writeFile(evidence + '/dev-failure.json', JSON.stringify({passed:false, message:error.message,errors:trace?.errors, failed:trace?.failed,badResponses:trace?.badResponses,requestedPaths:[...trace?.paths ?? []].sort()},null,2));
  if (observed) {
    try { await writeUiFailureDiagnostic(evidence + '/dev-runtime-failure-safe.json', browser, observed); }
    catch { console.error('Development failure diagnostics could not be written.'); }
  }
  if (capturePage) {
    try { await capturePage.screenshot({path:evidence+'/dev-failure.png'}); }
    catch { console.error('Failure capture unavailable; preserving the original journey error.'); }
  }
  throw error;
} finally {
  await browser.close();
}
