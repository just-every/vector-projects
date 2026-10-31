export {triageResponsibilityJourney} from './triage-responsibility-journey.mjs';
import {inviteReader,readerResponse} from './role-reader-support.mjs';
import {teamCreationReaderCell,teamJoinReaderCells,privateTeamCreationCells} from './team-reader-cells.mjs';
// Settle native polling before replacing an authorized private document.
import { beforePrivateNavigation, navigate } from "./collaboration-navigation.mjs";
import assert from "node:assert/strict";
import { poll } from "./admin-runtime-support.mjs";
import { openAdministrationForm } from "./ui-administration-form.mjs";
import { openDisclosures } from "./ui-controls-checks.mjs";
import { roleScreens } from "./role-ui-support.mjs";
export async function createTeamWorkflow({ page, runtime, capture, clause }) {
  const { base, sql } = runtime;

  await beforePrivateNavigation(page, base + "/app/settings");
  await page.goto(base + "/app/settings");
  await page.getByRole("form", { name: "Create team", exact: true }).waitFor();
  await clause(
    "TEAM-001",
    "create team with uppercase prefix and seven categories",
    async () => {
      const form = page.getByRole("form", { name: "Create team", exact: true });
      await form.getByLabel("Team name", { exact: true }).fill("Research");
      await form.getByLabel("Identifier prefix", { exact: true }).fill("RND");
      const receipt = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === "/api/settings/teams" &&
          r.request().method() === "POST",
      );
      await form
        .getByRole("button", { name: "Create team", exact: true })
        .click();
      assert.equal((await receipt).status(), 200);
      await poll(
        () => sql("SELECT * FROM teams WHERE name='Research'"),
        (rows) => rows.length === 1,
        "created team",
      );
    },
  );
  const team = sql("SELECT * FROM teams WHERE name='Research'")[0];
  const statuses = sql(
    `SELECT * FROM workflow_statuses WHERE team_id='${team.id}' ORDER BY position`,
  );
  assert.equal(team.identifier_prefix, "RND");
  assert.deepEqual(
    statuses.map((s) => s.category),
    [
      "intake",
      "backlog",
      "unstarted",
      "started",
      "completed",
      "canceled",
      "duplicate",
    ],
  );
  await openAdministrationForm(page, "Edit Research");
  await capture("team-seven-categories");
  await clause(
    "TEAM-002",
    "rename team; add rename and reorder workflow status",
    async () => {
      const edit = await openAdministrationForm(page, "Edit Research");
      await edit
        .getByLabel("Team name", { exact: true })
        .fill("Research delivery");
      await edit
        .getByRole("button", { name: "Save team", exact: true })
        .click();
      await poll(
        () => sql(`SELECT name FROM teams WHERE id='${team.id}'`),
        (rows) => rows[0]?.name === "Research delivery",
        "renamed team",
      );
      const add = await openAdministrationForm(
        page,
        "Add status to Research delivery",
      );
      await add.getByLabel("Status name", { exact: true }).fill("Review ready");
      await add
        .getByRole("combobox", { name: "Status category", exact: true })
        .selectOption("started");
      await add
        .getByRole("button", { name: "Add status", exact: true })
        .click();
      await poll(
        () =>
          sql(
            `SELECT * FROM workflow_statuses WHERE team_id='${team.id}' AND name='Review ready'`,
          ),
        (rows) => rows.length === 1,
        "added status",
      );
      const rename = await openAdministrationForm(page, "Rename Review ready");
      await rename.getByLabel("Status name", { exact: true }).fill("Reviewing");
      await rename
        .getByRole("button", { name: "Rename status", exact: true })
        .click();
      await poll(
        () =>
          sql(
            `SELECT * FROM workflow_statuses WHERE team_id='${team.id}' AND name='Reviewing'`,
          ),
        (rows) => rows.length === 1,
        "renamed status",
      );
      await openAdministrationForm(page, "Rename Reviewing");
      const status = sql(
        `SELECT * FROM workflow_statuses WHERE team_id='${team.id}' AND name='Reviewing'`,
      )[0];
      const before = status.position;
      await page
        .getByRole("group", { name: "Workflow status Reviewing", exact: true })
        .getByRole("button", { name: "Move up", exact: true })
        .click();
      await poll(
        () =>
          sql(`SELECT position FROM workflow_statuses WHERE id='${status.id}'`),
        (rows) => rows[0]?.position === before - 1,
        "reordered status",
      );
      const ordered = sql(
        `SELECT position FROM workflow_statuses WHERE team_id='${team.id}' ORDER BY position`,
      ).map((s) => s.position);
      assert.equal(new Set(ordered).size, 8, "collision-free full workflow");
    },
  );
  await openAdministrationForm(page, "Rename Reviewing");
  await capture("team-workflow-authored");
  return {
    ...team,
    name: "Research delivery",
    statuses: sql(
      `SELECT * FROM workflow_statuses WHERE team_id='${team.id}' ORDER BY position`,
    ),
  };
}
export async function removeUsedStatus({
  page,
  runtime,
  capture,
  clause,
  team,
  issue,
}) {
  const { base, sql } = runtime;
  const from = team.statuses.find((s) => s.name === "Reviewing");
  const to = team.statuses.find(
    (s) => s.category === "started" && s.id !== from.id,
  );

  await beforePrivateNavigation(page, base + "/app/settings");
  await page.goto(base + "/app/settings");
  await openAdministrationForm(page, "Edit " + team.name);
  await clause(
    "TEAM-001",
    "issued identifiers freeze the team prefix in administration",
    async () => {
      const edit = await openAdministrationForm(page, "Edit " + team.name);
      assert.equal(
        await edit.getByLabel("Identifier prefix", { exact: true }).count(),
        0,
      );
      await edit
        .getByText(
          `Identifier prefix ${team.identifier_prefix} is frozen because this team has issued an identifier.`,
          { exact: true },
        )
        .waitFor();
      assert.equal(
        sql(`SELECT identifier FROM issues WHERE id='${issue.id}'`)[0]
          .identifier,
        issue.identifier,
      );
    },
  );
  await clause(
    "TEAM-004",
    "used status remaps to same-category destination and protects last category status",
    async () => {
      const before = sql(`SELECT version FROM issues WHERE id='${issue.id}'`)[0]
        .version;
      await openAdministrationForm(page, "Rename Reviewing");
      const group = page.getByRole("group", {
        name: "Workflow status Reviewing",
        exact: true,
      });
      await group.waitFor({ state: "visible" });
      assert.deepEqual(
        await group
          .getByRole("combobox", { name: "Destination status", exact: true })
          .locator("option")
          .evaluateAll((options) =>
            options.map((option) => option.value).filter(Boolean),
          ),
        team.statuses
          .filter(
            (status) =>
              status.category === from.category && status.id !== from.id,
          )
          .map((status) => status.id),
        "only same-category destinations offered",
      );
      await group
        .getByRole("combobox", { name: "Destination status", exact: true })
        .selectOption(to.id);
      const receipt = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname.endsWith("/statuses/" + from.id) &&
          r.request().method() === "DELETE",
      );
      await group
        .getByRole("button", { name: "Remove status", exact: true })
        .click();
      assert.equal((await receipt).status(), 200);
      await poll(
        () =>
          sql(`SELECT status_id,version FROM issues WHERE id='${issue.id}'`),
        (rows) =>
          rows[0]?.status_id === to.id && rows[0].version === before + 1,
        "status remap",
      );
      assert.equal(
        sql(`SELECT count(*) n FROM workflow_statuses WHERE id='${from.id}'`)[0]
          .n,
        0,
      );
      const teamRow = page.locator("details").filter({ has: page.getByRole("form", {
        name: "Edit " + team.name, exact: true, includeHidden: true,
      }) });
      const last = teamRow.getByRole("group", {
        name: "Workflow status " + to.name,
        exact: true,
      });
      await last.waitFor({ state: "visible" });
      await last
        .getByText("This category’s last status cannot be removed.", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await last
          .getByRole("button", { name: "Remove status", exact: true })
          .count(),
        0,
        "last status has explicit refusal",
      );
      const audit = sql(
        `SELECT * FROM issue_activity WHERE issue_id='${issue.id}' AND previous_value_json LIKE '%${from.id}%' AND next_value_json LIKE '%${to.id}%'`,
      );
      assert.equal(audit.length, 1, "immutable status mapping receipt");
      assert.ok(audit[0].actor_operator_id);
      assert.ok(audit[0].created_at);
      const retained = sql(
        `SELECT a.*,d.previous_value_json,d.next_value_json FROM audit_records a JOIN administration_audit_details d ON d.audit_id=a.id WHERE action='workflow.status_removed' AND previous_value_json LIKE '%${from.id}%' AND next_value_json LIKE '%${to.id}%'`,
      );
      assert.equal(
        retained.length,
        1,
        "destructive audit independently retains old and destination IDs",
      );
    },
  );
  await capture("status-remap-last-category-refusal");
}

/** ROLE-007 and ROLE-009 in Settings → Teams: a Member joins and leaves a
 * public team from the directory and finds its settings locked, the last team
 * owner stays, and a team owner adds members, names owners and sets the two
 * permissions. */
export async function exerciseTeamRoles({ page, runtime, clause, evidence, refusals, peer, memberId }) {
  const { base, sql } = runtime;
  const inspect = roleScreens(evidence);
  const team = sql("SELECT id,name FROM teams WHERE name='Research delivery'")[0];
  const membership = () => sql(`SELECT role FROM team_members WHERE team_id='${team.id}' AND operator_id='${memberId}'`)[0]?.role;
  const peerTeams = peer.getByRole("region", { name: "Teams", exact: true });
  const toggle = async (actor, region, action, status) => {
    const path = `/api/teams/${team.id}/${action}`;
    if (status !== 200) refusals.add(base + path);
    const done = actor.waitForResponse((r) => new URL(r.url()).pathname === path);
    await region.getByRole("button", { name: `${action === "join" ? "Join" : "Leave"} ${team.name}`, exact: true }).click();
    assert.equal((await done).status(), status);
  };
  await navigate(peer, base + "/app/settings");
  for (const width of [1440, 390]) {
    await peer.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await clause("ROLE-007", `a Member joins a public team from the directory at ${width} and finds its settings, members and permissions locked`, async () => {
      await toggle(peer, peerTeams, "join", 200);
      await peerTeams.getByRole("button", { name: `Leave ${team.name}`, exact: true }).waitFor();
      assert.equal(membership(), "member");
      await openDisclosures(peer);
      assert.equal(await peer.getByRole("form", { name: `Edit ${team.name}`, exact: true }).getByRole("button", { name: "Save team", exact: true }).isDisabled(), true);
      assert.equal(await peer.getByRole("form", { name: `Permissions for ${team.name}`, exact: true }).getByRole("button", { name: "Save permissions", exact: true }).isDisabled(), true);
      assert.equal(await peer.getByRole("form", { name: `Add member to ${team.name}`, exact: true }).count(), 0);
      await peerTeams.getByText("Only this team's owners and Admins change its settings.", { exact: true }).first().waitFor();
    });
    if (width === 1440) {
      await inspect(peer, peerTeams, "team-member-view");
      await peer.setViewportSize({ width, height: 1000 });
    }
    await clause("ROLE-007", `the Member leaves the team from the directory at ${width}`, async () => {
      await toggle(peer, peerTeams, "leave", 200);
      await peerTeams.getByRole("button", { name: `Join ${team.name}`, exact: true }).waitFor();
      assert.equal(membership(), undefined);
    });
  }
  await navigate(page, base + "/app/settings");
  const teams = page.getByRole("region", { name: "Teams", exact: true });
  await clause("ROLE-007", "the last team owner cannot leave until another is named", async () => {
    await toggle(page, teams, "leave", 409);
    await teams.getByRole("alert").filter({ hasText: "Name another team owner before the last one leaves." }).waitFor();
  });
  await inspect(page, teams, "team-last-owner-refused");
  await clause("ROLE-007 ROLE-009", "a team owner adds a member, names a team owner and sets the two permissions, each audited once", async () => {
    await openDisclosures(page);
    const add = page.getByRole("form", { name: `Add member to ${team.name}`, exact: true });
    await add.getByRole("combobox", { name: "Member to add", exact: true }).selectOption({ label: "Role member" });
    await add.getByRole("combobox", { name: "Team role", exact: true }).selectOption("member");
    await add.getByRole("button", { name: "Add member", exact: true }).click();
    await poll(() => [membership()], ([role]) => role === "member", "member added");
    await page.getByRole("group", { name: `${team.name} members`, exact: true }).getByRole("button", { name: "Make Role member a team owner", exact: true }).click();
    await poll(() => [membership()], ([role]) => role === "owner", "team owner named");
    const permissions = page.getByRole("form", { name: `Permissions for ${team.name}`, exact: true });
    await permissions.getByRole("combobox", { name: "Who manages team settings", exact: true }).selectOption("all_members");
    await permissions.getByRole("button", { name: "Save permissions", exact: true }).click();
    await poll(() => sql(`SELECT settings_permission AS value FROM teams WHERE id='${team.id}'`), (rows) => rows[0]?.value === "all_members", "settings permission");
    assert.equal(sql(`SELECT count(*) AS n FROM audit_records WHERE action='team.permission_changed' AND subject_id='${team.id}'`)[0].n, 1);
  });
  await inspect(page, teams, "team-owner-controls");
  await clause("ROLE-007", "once another team owner is named, the former last owner leaves", async () => {
    await toggle(page, teams, "leave", 200);
    assert.equal(sql(`SELECT count(*) AS n FROM team_members WHERE team_id='${team.id}' AND role='owner'`)[0].n, 1);
  });
}

export async function teamCreationPermission({page,peer,runtime,clause,evidence}) {
  const {base,sql}=runtime, inspect=roleScreens(evidence);
  const viewer=await inviteReader({owner:page,browser:page.context().browser(),runtime,email:'synthetic-vector-1944@vector.test',name:'synthetic-vector-1944'});
  try{
  const set=async value=>{
    await navigate(page,base+"/app/settings");
    const form=page.getByRole("form",{name:"Team creation permission",exact:true});
    await form.getByLabel("Who may create teams",{exact:true}).selectOption(value?"members":"admins");
    const receipt=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/settings/teams/creation"&&r.request().method()==="PUT");
    await form.getByRole("button",{name:"Save team creation permission",exact:true}).click();
    assert.equal((await receipt).status(),200);
  };
  const before=sql("SELECT count(*) n FROM audit_records WHERE action='workspace.team_creation_changed'")[0].n;
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:width===390?844:1000});
    await peer.setViewportSize({width,height:width===390?844:1000});
    await clause("TEAM-008",`workspace policy controls a Member's public team creation at ${width}`,async()=>{
      await navigate(peer,base+"/app/settings");
      assert.equal(await peer.getByRole("form",{name:"Create team",exact:true}).count(),0);
      assert.equal(await peer.getByRole("form",{name:"Team creation permission",exact:true}).count(),0);
      await teamCreationReaderCell(viewer,runtime,width);
      await set(true);
      await teamCreationReaderCell(viewer,runtime,width);
      await privateTeamCreationCells({page,peer,runtime,width,evidence});
      assert.equal((await peer.request.post(base+'/api/settings/teams',{headers:{Origin:base},data:{name:'synthetic-vector-1945',identifierPrefix:'SYNPRIVATE',isPrivate:true}})).status(),403);
      await navigate(peer,base+"/app/settings");
      const create=peer.getByRole("form",{name:"Create team",exact:true});
      await create.getByLabel("Team name",{exact:true}).fill("synthetic-vector-team-"+width);
      await create.getByLabel("Identifier prefix",{exact:true}).fill(width===1440?"SYNVA":"SYNVB");
      assert.equal(await create.getByLabel("Create Slack channel",{exact:true}).count(),0);
      const receipt=peer.waitForResponse(r=>new URL(r.url()).pathname==="/api/settings/teams"&&r.request().method()==="POST");
      await create.getByRole("button",{name:"Create team",exact:true}).click();
      assert.equal((await receipt).status(),200);
      const owned=sql("SELECT t.id,t.is_private,m.role FROM teams t JOIN team_members m ON m.team_id=t.id JOIN operators o ON o.id=m.operator_id WHERE t.name='synthetic-vector-team-"+width+"' AND o.email='role-member@admin-runtime.test'");
      assert.equal(owned.length,1);
      assert.equal(owned[0].role,"owner");
      assert.equal(owned[0].is_private,0);
      assert.equal((await peer.request.put(base+"/api/settings/teams/creation",{headers:{Origin:base},data:{membersMayCreate:false}})).status(),403);
      await set(false);
      assert.equal((await peer.request.post(base+"/api/settings/teams",{headers:{Origin:base},data:{name:"synthetic-vector-refused-team-"+width,identifierPrefix:"REFUSE"}})).status(),403);
      await navigate(peer,base+"/app/settings");
      assert.equal(await peer.getByRole("form",{name:"Create team",exact:true}).count(),0);
      assert.equal(sql("SELECT count(*) n FROM teams WHERE id='"+owned[0].id+"'")[0].n,1);
    });
  }
  await inspect(page,page.getByRole("region",{name:"Teams",exact:true}),"team-creation-policy");
  await inspect(peer,peer.getByRole("region",{name:"Teams",exact:true}),"member-team-created");
  assert.equal(sql("SELECT count(*) n FROM audit_records WHERE action='workspace.team_creation_changed'")[0].n-before,4);
  }finally{await viewer.context.close();}
}

export async function teamJoinPermissions({page,peer,browser,runtime,clause,evidence}) {
 const {base,sql}=runtime,inspect=roleScreens(evidence);
 const viewer=await inviteReader({owner:page,browser,runtime,email:'synthetic-vector-1946@vector.test',name:'synthetic-vector-1946'});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 try {
  const requester=await context.newPage();
  await requester.goto(base+"/signin");
  await requester.getByLabel("Email",{exact:true}).fill("lead@admin-runtime.test");
  const sent=requester.waitForResponse(r=>new URL(r.url()).pathname==="/auth/request"&&r.request().method()==="POST");
  await requester.getByRole("button",{name:"Send sign-in link",exact:true}).click();
  assert.equal((await sent).status(),202);
  const link=sql("SELECT json_extract(message,'$.text') AS text FROM rer_mail_development_outbox WHERE json_extract(message,'$.to[0]')='lead@admin-runtime.test' ORDER BY created_at DESC,sequence DESC LIMIT 1")[0].text.match(/https?:\/\/[^\s]+/)[0];
  await requester.goto(link);await requester.getByRole("button",{name:"Confirm",exact:true}).click();await requester.waitForURL(base+"/app");
  const member=sql("SELECT id FROM operators WHERE email='lead@admin-runtime.test'")[0].id;
  const owner=sql("SELECT id FROM operators WHERE email='role-member@admin-runtime.test'")[0].id;
  for(const width of [1440,390]) {
   await peer.setViewportSize({width,height:width===390?844:1000});
   await requester.setViewportSize({width,height:width===390?844:1000});
   const name="synthetic-vector-join-"+width;
   const made=await page.request.post(base+"/api/settings/teams",{headers:{Origin:base},data:{name,identifierPrefix:width===1440?"JOINA":"JOINB"}});
   assert.equal(made.status(),200);const team=(await made.json()).teams.find(team=>team.name===name);
   assert.equal((await page.request.put(base+`/api/settings/teams/${team.id}/members/${owner}`,{headers:{Origin:base},data:{role:"owner"}})).status(),200);
   await clause("TEAM-007",`a Member requests an invite-only public team and a Member team owner approves once at ${width}`,async()=>{
    await navigate(peer,base+"/app/settings");await openAdministrationForm(peer,"Edit "+name);
    const mode=peer.getByRole("form",{name:"Membership mode for "+name,exact:true});
    await mode.getByLabel("Membership mode",{exact:true}).selectOption("invite_only");
    await mode.getByLabel("Accept membership requests",{exact:true}).check();
    const changed=peer.waitForResponse(r=>new URL(r.url()).pathname===`/api/settings/teams/${team.id}/membership`);
    await mode.getByRole("button",{name:"Save membership mode",exact:true}).click();assert.equal((await changed).status(),200);
    assert.equal((await requester.request.post(base+`/api/teams/${team.id}/join`,{headers:{Origin:base},data:{}})).status(),403);
    await navigate(requester,base+"/app/settings");
    const requested=requester.waitForResponse(r=>new URL(r.url()).pathname===`/api/teams/${team.id}/requests`);
    await requester.getByRole("button",{name:"Request to join "+name,exact:true}).click();assert.equal((await requested).status(),200);
    await requester.getByRole("button",{name:"Request pending for "+name,exact:true}).waitFor();
    assert.equal(sql(`SELECT count(*) n FROM team_members WHERE team_id='${team.id}' AND operator_id='${member}'`)[0].n,0);
    if(width===1440)await inspect(requester,requester.getByRole("region",{name:"Teams",exact:true}),"public-team-request-pending");
    await navigate(peer,base+"/app/settings");await openAdministrationForm(peer,"Edit "+name);
    let group=peer.getByRole("group",{name:"Request from Delivery lead",exact:true});
    const decide=async decision=>{
     const receipt=peer.waitForResponse(r=>new URL(r.url()).pathname===`/api/settings/teams/${team.id}/requests/${member}/decision`);
     await group.getByRole("button",{name:(decision==="approved"?"Approve ":"Decline ")+"Delivery lead",exact:true}).click();assert.equal((await receipt).status(),200);
    };
    if(width===390) {
     await decide("declined");
     assert.equal(sql(`SELECT count(*) n FROM team_members WHERE team_id='${team.id}' AND operator_id='${member}'`)[0].n,0);
     await navigate(requester,base+"/app/settings");
     const retry=requester.waitForResponse(r=>new URL(r.url()).pathname===`/api/teams/${team.id}/requests`);
     await requester.getByRole("button",{name:"Request to join "+name,exact:true}).click();assert.equal((await retry).status(),200);
     await navigate(peer,base+"/app/settings");await openAdministrationForm(peer,"Edit "+name);
     group=peer.getByRole("group",{name:"Request from Delivery lead",exact:true});
    }
    if(width===1440)await inspect(peer,peer.getByRole("region",{name:"Membership for "+name,exact:true}),"team-owner-request-decision");
    await decide("approved");
    const before=sql(`SELECT count(*) n FROM audit_records WHERE action='team.join_request_approved' AND subject_id='${team.id}'`)[0].n;
    assert.equal(before,1);
    assert.equal((await peer.request.post(base+`/api/settings/teams/${team.id}/requests/${member}/decision`,{headers:{Origin:base},data:{decision:"approved"}})).status(),200);
    assert.equal(sql(`SELECT count(*) n FROM audit_records WHERE action='team.join_request_approved' AND subject_id='${team.id}'`)[0].n,before);
    assert.equal(sql(`SELECT count(*) n FROM team_members WHERE team_id='${team.id}' AND operator_id='${member}'`)[0].n,1);
    await navigate(requester,base+"/app/settings");await requester.getByRole("button",{name:"Leave "+name,exact:true}).waitFor();
    assert.equal(sql(`SELECT count(*) n FROM audit_records WHERE action='team.membership_mode_changed' AND subject_id='${team.id}'`)[0].n,1);
   });
   await clause('TEAM-007',`private and Viewer membership cells at ${width}`,()=>teamJoinReaderCells({page,peer,requester,viewer,runtime,team,member,width}));
  }
 } finally {await context.close();await viewer.context.close();}
}

/** An explicitly exposed private request grants metadata only until approval. */
export async function privateTeamRequest({page,peer,memberId,runtime,team,clause}) {
 const {base}=runtime;
 await navigate(page,base+'/app/settings');await openDisclosures(page);
 const form=page.getByRole('form',{name:'Membership mode for '+team.name,exact:true});
 await form.getByLabel('Membership mode',{exact:true}).selectOption('invite_only');
 await form.getByLabel('Accept membership requests',{exact:true}).check();
 let response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/settings/teams/${team.id}/membership`);
 await form.getByRole('button',{name:'Save membership mode',exact:true}).click();assert.equal((await response).status(),200);
 await navigate(peer,base+'/app/settings');
 response=peer.waitForResponse(r=>new URL(r.url()).pathname===`/api/teams/${team.id}/requests`);
 await peer.getByRole('button',{name:'Request to join '+team.name,exact:true}).click();assert.equal((await response).status(),200);
 await peer.getByRole('button',{name:'Request pending for '+team.name,exact:true}).waitFor();
 assert.equal((await readerResponse(peer,base,'/issues/'+team.identifier)).status,404);
 assert.equal(runtime.sql(`SELECT count(*) n FROM team_members WHERE team_id='${team.id}' AND operator_id='${memberId}'`)[0].n,0);
 await navigate(page,base+'/app/settings');await openDisclosures(page);
 response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/settings/teams/${team.id}/requests/${memberId}/decision`);
 await page.getByRole('button',{name:'Approve Role member',exact:true}).click();assert.equal((await response).status(),200);
 assert.equal((await readerResponse(peer,base,'/issues/'+team.identifier)).status,200);
}

/** ROLE-002(a): non-member Admin metadata has counts and membership, with no work form. */
export async function privateAdminMetadata({peer,name,team,api,inspect,width}) {
 const metadata=peer.getByRole('region',{name:'Metadata for '+name,exact:true});
 assert.ok((await metadata.innerText()).includes('1 members · 1 team owners · 1 issues'));
 assert.ok((await metadata.innerText()).includes('Team owner'));
 await inspect(peer,metadata,'private-team-admin-metadata-counts-'+width);
 const state=(await api(peer,'/settings/administration')).teams.find(t=>t.id===team.id);
 assert.equal(state.issueCount,1);assert.equal(state.canRead,false);assert.equal(state.members.length,1);
}
