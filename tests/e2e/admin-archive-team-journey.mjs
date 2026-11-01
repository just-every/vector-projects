// Settle native polling before replacing an authorized private document.
import { beforePrivateNavigation } from "./collaboration-navigation.mjs";
import assert from "node:assert/strict";
import { poll } from "./admin-runtime-support.mjs";
import { openAdministrationForm } from "./ui-administration-form.mjs";
export async function archiveRestoreTeam({
  page,
  runtime,
  capture,
  clause,
  team,
  issue,
}) {
  const { base, sql } = runtime;

  await beforePrivateNavigation(page, base + "/app/settings/teams");
  await page.goto(base + "/app/settings/teams");
  await openAdministrationForm(page, "Edit " + team.name);
  await clause(
    "TEAM-003",
    "archive excludes authoring rejects intake with 409 and preserves issue then restore",
    async () => {
      const before = sql(`SELECT * FROM issues WHERE id='${issue.id}'`)[0];
      const edit = await openAdministrationForm(page, "Edit " + team.name);
      await edit
        .getByRole("button", { name: "Archive team", exact: true })
        .click();
      await poll(
        () => sql(`SELECT archived_at FROM teams WHERE id='${team.id}'`),
        (rows) => Boolean(rows[0]?.archived_at),
        "archived team",
      );
      assert.deepEqual(
        sql(`SELECT * FROM issues WHERE id='${issue.id}'`)[0],
        before,
        "archive retains full issue",
      );
      const archived = await openAdministrationForm(page, "Edit " + team.name);
      await archived
        .getByRole("button", { name: "Unarchive team", exact: true })
        .waitFor({ state: "visible" });
      await capture("team-archived-preserved-workflow");
      const options = await page.request.get(base + "/api/options");
      assert.equal(options.status(), 200);
      assert.ok(
        !(await options.json()).teams.some((row) => row.id === team.id),
        "archived team excluded from options",
      );

      await beforePrivateNavigation(page, base + "/app/new-issue");
      await page.goto(base + "/app/new-issue");
      await page.getByLabel(/^Team/).waitFor();
      assert.equal(
        await page
          .getByLabel(/^Team/)
          .locator(`option[value="${team.id}"]`)
          .count(),
        0,
        "archived team excluded from authoring picker",
      );
      await capture("archived-team-authoring-exclusion");
      const intake = await page.request.post(base + "/api/intake", {
        headers: { Origin: base },
        data: {
          title: "Archive must reject",
          teamId: team.id,
          summary: "Archive rejection proof",
        },
      });
      assert.equal(intake.status(), 409, "archived operator intake rejects");
      assert.equal(
        sql(
          "SELECT count(*) n FROM issues WHERE title='Archive must reject'",
        )[0].n,
        0,
      );

      await beforePrivateNavigation(
        page,
        base + "/app/issues/" + issue.identifier,
      );
      await page.goto(base + "/app/issues/" + issue.identifier);
      await page
        .getByRole("heading", { name: issue.title, exact: true })
        .waitFor();
      await capture("archived-team-existing-issue");

      await beforePrivateNavigation(page, base + "/app/settings/teams");
      await page.goto(base + "/app/settings/teams");
      const restore = await openAdministrationForm(page, "Edit " + team.name);
      await restore
        .getByRole("button", { name: "Unarchive team", exact: true })
        .click();
      await poll(
        () => sql(`SELECT archived_at FROM teams WHERE id='${team.id}'`),
        (rows) => rows[0]?.archived_at === null,
        "team restored",
      );

      await beforePrivateNavigation(page, base + "/app/new-issue");
      await page.goto(base + "/app/new-issue");
      await page.getByLabel(/^Team/).waitFor();
      await page.getByLabel(/^Team/).selectOption(team.id);
      assert.equal(await page.getByLabel(/^Team/).inputValue(), team.id);
      await capture("team-restored-authoring");
    },
  );
}
