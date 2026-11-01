import { openAccountMenu } from './ui-controls-checks.mjs';
import { withOperatorClient } from './operator-request.mjs';
import {rolePrivateCells} from './role-private-cells.mjs';
import {viewerRoleJourney} from './viewer-role-journey.mjs';
import {privateTeamJourney} from './private-team-journey.mjs';
// Settle native polling before replacing an authorized private document.
import {
  beforePrivateNavigation,
  navigate,
  settleReads,
} from "./collaboration-navigation.mjs";
import { roleScreens, exerciseGuestRoles } from "./role-ui-support.mjs";
import assert from "node:assert/strict";
import { poll } from "./admin-runtime-support.mjs";
import { saveWorkspaceTime } from "./admin-workspace-time-journey.mjs";
import { invitePerson, openPerson, teamList } from "./settings-pane-support.mjs";
import {
  openAdministrationForm,
  assertSettingsSections,
} from "./ui-controls-checks.mjs";
export async function auditEmptyWorkspace({ page, runtime, capture, clause }) {
  const { base } = runtime;

  await beforePrivateNavigation(page, base + "/app/projects");
  await page.goto(base + "/app/projects");
  await page.getByRole("heading", { name: "Projects", exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "Create your first project", exact: true })
    .waitFor();
  await clause(
    "PROJ-007",
    "empty portfolio invites a first project with creation closed",
    async () => {
      assert.equal(
        await page
          .getByRole("heading", {
            name: "Create your first project",
            exact: true,
          })
          .isVisible(),
        true,
        "empty-project invitation is visible before opening creation",
      );
      await page
        .getByText("Choose New project to start planning your work.", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page.getByText("No projects match these filters.").count(),
        0,
        "empty portfolio does not imply a filtered result",
      );
      const trigger = page.getByRole("button", {
        name: "New project",
        exact: true,
      });
      assert.equal(await trigger.isVisible(), true);
      assert.equal(await trigger.getAttribute("aria-expanded"), "false");
      assert.equal(
        await page
          .getByRole("form", {
            name: "Create project",
            exact: true,
            includeHidden: true,
          })
          .count(),
        0,
        "creation form is absent before New project is clicked",
      );
      assert.equal(await page.locator("#project-create-panel").count(), 0);
    },
  );
  await capture("empty-projects-invitation");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .waitFor();
  await capture("empty-projects-create-cta");

  await beforePrivateNavigation(page, base + "/app/cycles");
  await page.goto(base + "/app/cycles");
  await page
    .getByRole("heading", { name: "Cycles", exact: true, level: 1 })
    .waitFor();
  await page
    .getByRole("button", { name: "Create cycle", exact: true })
    .waitFor();
  await page
    .getByText("No cycles yet. Create your first cycle below.", { exact: true })
    .waitFor();
  await capture("empty-cycles-create-cta");
  await openAccountMenu(page);
  await page
    .getByRole("link", { name: "Settings", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await page.waitForURL(base + "/app/settings");
  await page.goto(base + "/app/settings/teams");
  await teamList(page).getByRole("link", { name: runtime.config.DEFAULT_TEAM_NAME }).waitFor();
  await assertSettingsSections(page, "empty workspace Settings");
  await clause(
    "OPS-003",
    "responsive signed operator settings access",
    async () => {
      await openAccountMenu(page);
      await page
        .getByRole("link", { name: "Settings", exact: true })
        .filter({ visible: true })
        .first()
        .waitFor();
      await openAccountMenu(page);
      await page
        .getByRole("button", { name: "Sign out", exact: true })
        .filter({ visible: true })
        .waitFor();
      await page
        .getByText(runtime.config.FIRST_OWNER_NAME, { exact: true })
        .filter({ visible: true })
        .first()
        .waitFor();
    },
  );
  await capture("empty-settings-six-sections");
  await saveWorkspaceTime({ page, runtime, capture, clause });
}
export async function inviteProjectLead({
  page,
  browser,
  runtime,
  capture,
  clause,
  project,
}) {
  const { base, sql } = runtime;

  await beforePrivateNavigation(page, base + "/app/settings/people");
  await page.goto(base + "/app/settings/people");
  await clause(
    "PROJ-002",
    "project lead transfers to a genuinely invited Member",
    async () => {
      const invited = await invitePerson(page, { name: "Delivery lead", email: "lead@admin-runtime.test" });
      assert.equal(invited.status(), 202);
      const link = sql(
        "SELECT json_extract(message,'$.text') AS sign_in_url FROM rer_mail_development_outbox WHERE json_extract(message,'$.to[0]')='lead@admin-runtime.test' ORDER BY created_at DESC,sequence DESC LIMIT 1",
      )[0].sign_in_url.match(/https?:\/\/[^\s]+/)[0];
      const context = await browser.newContext({
        viewport: page.viewportSize(),
      });
      try {
        const peer = await context.newPage();
        await peer.goto(link);
        await peer
          .getByRole("button", { name: "Confirm", exact: true })
          .click();
        await peer.waitForURL(base + "/app");
      } finally {
        await context.close();
      }
      const lead = sql(
        "SELECT * FROM operators WHERE email='lead@admin-runtime.test'",
      )[0];
      assert.ok(lead && !lead.removed_at);
      await beforePrivateNavigation(page, base + "/app/projects/" + project.id);
      await page.goto(base + "/app/projects/" + project.id);
      await openAdministrationForm(page, "Edit project " + project.name);
      const edit = page.getByRole("form", {
        name: "Edit project " + project.name,
        exact: true,
      });
      await edit
        .getByRole("combobox", { name: "Project lead", exact: true })
        .selectOption(lead.id);
      await edit
        .getByRole("button", { name: "Save project", exact: true })
        .click();
      await poll(
        () =>
          sql(`SELECT lead_operator_id FROM projects WHERE id='${project.id}'`),
        (rows) => rows[0]?.lead_operator_id === lead.id,
        "lead transfer",
      );
      const audit = sql(
        `SELECT * FROM project_activity WHERE project_id='${project.id}'`,
      );
      assert.ok(
        audit.some(
          (row) =>
            row.actor_operator_id &&
            row.created_at &&
            JSON.parse(row.previous_value_json ?? "null")?.leadOperatorId ===
              project.lead_operator_id &&
            JSON.parse(row.next_value_json ?? "null")?.leadOperatorId ===
              lead.id,
        ),
        "lead actor old/new audit",
      );
    },
  );
  await capture("project-invited-lead-transfer");
}
export async function assertSignOut({ page, runtime, capture }) {
  await beforePrivateNavigation(page, runtime.base + "/app/settings/teams");
  await page.goto(runtime.base + "/app/settings/teams");
  await teamList(page).getByRole("link", { name: runtime.config.DEFAULT_TEAM_NAME }).waitFor();
  await assertSettingsSections(page, "final Settings");
  await capture("settings-final-signout-reachable");
  await settleReads(page);
  await openAccountMenu(page);
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .filter({ visible: true })
    .click();
  await page.waitForURL(runtime.base + "/signin");
  assert.equal(
    (await page.request.get(runtime.base + "/api/session")).status(),
    401,
    "signout revokes browser admission",
  );
}

/** ROLE-001 in Settings → Members: an invitation names its role, an Owner
 * promotes and demotes a Member whose open session follows on its next
 * request, the last Owner stays, and a Member reads only what they may. The
 * returned Member's browser context is the caller's to close. */
export async function exerciseWorkspaceRoles({ page, browser, runtime, clause, evidence, refusals }) {
  const { base, sql } = runtime;
  const inspect = roleScreens(evidence);
  const owner = sql("SELECT o.id,o.name FROM operators o JOIN workspace_installation i ON i.setup_operator_id=o.id")[0];
  await navigate(page, base + "/app/settings/people");
  const members = page.getByRole("list", { name: "People", exact: true });
  let context, peer;
  await clause("ROLE-001", "an invitation names its role, Member by default", async () => {
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    const form = page.getByRole("form", { name: "Invite someone", exact: true });
    const role = form.getByLabel("Role", { exact: true });
    assert.equal(await role.inputValue(), "member");
    await role.selectOption("viewer");
    await role.selectOption("member");
    await form.getByLabel("Name", { exact: true }).fill("Role member");
    await form.getByLabel("Email", { exact: true }).fill("role-member@admin-runtime.test");
    await form.getByRole("button", { name: "Send invitation", exact: true }).click();
    const invited = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/settings/operators/invite");
    await page.getByRole("button", { name: "Confirm and send", exact: true }).click();
    assert.equal((await invited).status(), 202);
    await page.getByText("Invitation submitted for delivery.").waitFor();
    const link = sql("SELECT json_extract(message,'$.text') AS text FROM rer_mail_development_outbox WHERE json_extract(message,'$.to[0]')='role-member@admin-runtime.test' ORDER BY created_at DESC,sequence DESC LIMIT 1")[0].text.match(/https?:\/\/[^\s]+/)[0];
    context = await browser.newContext({ viewport: page.viewportSize() });
    peer = await context.newPage();
    await peer.goto(link);
    await peer.getByRole("button", { name: "Confirm", exact: true }).click();
    await peer.waitForURL(base + "/app");
    assert.equal(sql("SELECT role FROM operators WHERE email='role-member@admin-runtime.test'")[0].role, "member");
  });
  const memberId = sql("SELECT id FROM operators WHERE email='role-member@admin-runtime.test'")[0].id;
  // The accepted member joins the directory on the Owner's next Settings visit.
  await navigate(page, base + "/app/settings/people");
  await page.getByRole("link", { name: /Role member/ }).waitFor();
  // A workspace settings write that saves the current timezone: only the role decides its answer.
  const settingsRequest = async () => withOperatorClient(peer.context(), async client => {
    const response = await client.patch(base + "/api/settings", {
      headers: { Origin: base }, data: { timezone: sql("SELECT timezone FROM workspace_settings")[0].timezone },
    });
    await response.body();
    return response.status();
  });
  // A role is a select on the person's own page that stores as it changes: no Change role button.
  const changeRole = async (name, id, role, status) => {
    await openPerson(page, base, id);
    assert.equal(await page.getByRole("button", { name: /^Change role/ }).count(), 0);
    const path = `/api/settings/operators/${id}/role`;
    if (status !== 200) refusals.add(base + path);
    const changed = page.waitForResponse((r) => new URL(r.url()).pathname === path);
    await page.getByLabel("Role", { exact: true }).selectOption(role);
    assert.equal((await changed).status(), status);
  };
  await clause("ROLE-001", "an Owner promotes a Member at 1440 and demotes them at 390; the Admin's promotions are refused 403; the demoted member's next settings request returns 403", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await changeRole("Role member", memberId, "admin", 200);
    await page.getByText("Saved", { exact: true }).first().waitFor();
    assert.equal(await settingsRequest(), 200);
    // The new Admin promotes no one to Admin or Owner; the project lead stays a Member.
    const lead = sql("SELECT id FROM operators WHERE email='lead@admin-runtime.test'")[0].id;
    for (const role of ["admin", "owner"])
      assert.equal((await peer.request.patch(base + `/api/settings/operators/${lead}/role`, { headers: { Origin: base }, data: { role } })).status(), 403, `an Admin's promotion to ${role}`);
    assert.equal(sql(`SELECT role FROM operators WHERE id='${lead}'`)[0].role, "member");
    await page.setViewportSize({ width: 390, height: 844 });
    await changeRole("Role member", memberId, "member", 200);
    await page.getByText("Saved", { exact: true }).first().waitFor();
    assert.equal(await settingsRequest(), 403);
    assert.equal((await peer.request.get(base + "/api/session")).status(), 200, "the session itself survives the role change");
    const audit = sql(`SELECT d.previous_value_json AS previous,d.next_value_json AS next FROM audit_records a JOIN administration_audit_details d ON d.audit_id=a.id WHERE a.action='operator.role_changed' AND a.subject_id='${memberId}' ORDER BY a.id`);
    assert.deepEqual(audit.map((row) => [JSON.parse(row.previous).role, JSON.parse(row.next).role]), [["member", "admin"], ["admin", "member"]]);
  });
  await inspect(page, page.locator(".settings-pane"), "members-owner");
  await clause("ROLE-001", "the last Owner's demotion is refused and changes nothing", async () => {
    const before = sql("SELECT id,role FROM operators ORDER BY id");
    // The page says why in a plain line and sends nothing; the server refuses the same request with 409.
    await openPerson(page, base, owner.id);
    await page.getByText("The last Owner cannot be demoted or removed. Make another member an Owner first.", { exact: true }).waitFor();
    await page.getByLabel("Role", { exact: true }).selectOption("admin");
    assert.equal(await page.getByLabel("Role", { exact: true }).inputValue(), "owner", "the refused choice gives way to the actual role");
    const path = `/api/settings/operators/${owner.id}/role`;
    refusals.add(base + path);
    assert.equal((await page.request.patch(base + path, { headers: { Origin: base }, data: { role: "admin" } })).status(), 409);
    assert.deepEqual(sql("SELECT id,role FROM operators ORDER BY id"), before);
  });
  await inspect(page, page.locator(".settings-pane"), "members-last-owner-refused");
  const labelCreated = await page.request.post(base + "/api/settings/labels", {
    headers: { Origin: base }, data: { name: "synthetic-vector-15", color: "#224466" },
  });
  assert.equal(labelCreated.status(), 200);
  await clause("ROLE-001", "a Member reads the member directory without managing anyone and opens only their own Settings pages", async () => {
    await navigate(peer, base + "/app/settings/people");
    const directory = peer.getByRole("list", { name: "People", exact: true });
    await directory.getByText("Role member (you)", { exact: true }).waitFor();
    assert.equal(await peer.getByRole("button", { name: "Change role", exact: true }).count(), 0);
    assert.equal(await peer.getByRole("button", { name: "Invite", exact: true }).count(), 0);
    // A Member's only control is leaving: on their own record, never on anyone else's.
    await peer.getByRole("link", { name: /Role member \(you\)/ }).click();
    await peer.getByRole("button", { name: "Leave workspace", exact: true }).waitFor();
    assert.equal(await peer.getByLabel("Role", { exact: true }).count(), 0, "a Member does not change roles");
    await navigate(peer, base + "/app/settings/people");
    await peer.getByRole("link", { name: new RegExp(owner.name) }).first().click();
    assert.equal(await peer.getByRole("button", { name: /^(Remove|Leave)/ }).count(), 0);
    // A Member's list holds only their own sections; a denied path is one plain line, not a page.
    await navigate(peer, base + "/app/settings");
    const entries = peer.getByRole("navigation", { name: "Settings sections" }).locator(".settings-nav-name");
    await entries.filter({ hasText: "Developers" }).waitFor();
    assert.deepEqual(await entries.allTextContents(), ["Profile", "Notifications", "People", "Teams", "Labels", "Developers"]);
    for (const denied of ["workspace", "connections", "move-in"]) {
      await navigate(peer, base + "/app/settings/" + denied);
      await peer.getByText("You can’t open this page.").waitFor();
    }
    await navigate(peer, base + "/app/settings/labels");
    const labels = peer.getByRole("list", { name: "Labels", exact: true });
    await labels.getByText("synthetic-vector-15", { exact: true }).waitFor();
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await peer.setViewportSize(viewport);
      assert.equal(await labels.getByRole("form").count(), 0, "a Member has no label creation or management form in Settings");
      assert.equal(await labels.getByRole("button").count(), 0, "a Member has no label management controls");
      const response = await peer.request.get(base + "/api/settings/administration");
      assert.equal(response.status(), 200);
      for (const label of (await response.json()).labels)
        await labels.getByText(label.name, { exact: true }).waitFor();
    }
    await inspect(peer, labels, "member-labels-read-only");
    await navigate(peer, base + "/app/settings/developers");
    await peer.getByRole("region", { name: "Integrations", exact: true }).getByRole("heading", { name: "API tokens", exact: true }).waitFor();
  });
  await navigate(peer, base + "/app/settings/people");
  await inspect(peer, peer.getByRole("list", { name: "People", exact: true }), "members-member-view");
  await exerciseGuestRoles({page,browser,runtime,clause,evidence});
  await privateTeamJourney({page,peer,memberId,runtime,clause,evidence});
  await rolePrivateCells({page,peer,memberId,runtime,clause});
  await viewerRoleJourney({page,peer,memberId,browser,runtime,clause,evidence});
  return { context, peer, memberId };
}
