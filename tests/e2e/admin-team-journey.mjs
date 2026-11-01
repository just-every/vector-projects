export {triageResponsibilityJourney} from './triage-responsibility-journey.mjs';
export { teamCyclesSettings } from './team-cycles-journey.mjs';
import {inviteReader,readerResponse} from './role-reader-support.mjs';
import {teamCreationReaderCell,teamJoinReaderCells,privateTeamCreationCells} from './team-reader-cells.mjs';
// Settle native polling before replacing an authorized private document.
import { beforePrivateNavigation, navigate } from "./collaboration-navigation.mjs";
import assert from "node:assert/strict";
import { poll } from "./admin-runtime-support.mjs";
import { inviteOnlyWithRequests, openTeam, storeText, teamList } from "./settings-pane-support.mjs";
import { roleScreens } from "./role-ui-support.mjs";
export async function createTeamWorkflow({ page, runtime, capture, clause }) {
  const { base, sql } = runtime;

  await beforePrivateNavigation(page, base + "/app/settings/teams");
  await page.goto(base + "/app/settings/teams");
  // New team opens in place, only when asked.
  assert.equal(await page.getByRole("form", { name: "Create team", exact: true }).count(), 0);
  await page.getByRole("button", { name: "New team", exact: true }).click();
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
  await openTeam(page, base, team, "workflow");
  await capture("team-seven-categories");
  await clause(
    "TEAM-002",
    "rename team; add rename and reorder workflow status",
    async () => {
      await openTeam(page, base, team, "details");
      await storeText(page, page.getByLabel("Name", { exact: true }), "Research delivery", `/api/settings/teams/${team.id}`);
      await poll(
        () => sql(`SELECT name FROM teams WHERE id='${team.id}'`),
        (rows) => rows[0]?.name === "Research delivery",
        "renamed team",
      );
      await openTeam(page, base, team, "workflow");
      await page.getByRole("button", { name: "Add status", exact: true }).click();
      const add = page.getByRole("form", { name: "Add status to Research delivery", exact: true });
      await add.getByLabel("Name", { exact: true }).fill("Review ready");
      await add.getByLabel("Category", { exact: true }).selectOption("started");
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
      await page.getByRole("button", { name: "Actions for Review ready", exact: true }).click();
      await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
      const rename = page.getByLabel("Status name Review ready", { exact: true });
      await rename.fill("Reviewing");
      await rename.press("Enter");
      await poll(
        () =>
          sql(
            `SELECT * FROM workflow_statuses WHERE team_id='${team.id}' AND name='Reviewing'`,
          ),
        (rows) => rows.length === 1,
        "renamed status",
      );
      const status = sql(
        `SELECT * FROM workflow_statuses WHERE team_id='${team.id}' AND name='Reviewing'`,
      )[0];
      const sibling = sql(
        `SELECT * FROM workflow_statuses WHERE team_id='${team.id}' AND category='started' AND id<>'${status.id}'`,
      )[0];
      assert.ok(status.position > sibling.position, "the new status starts after its category's first");
      // The drag handle's arrow keys move a status within its group and store the new order at once.
      const handle = page.getByRole("button", { name: "Reorder Reviewing", exact: true });
      await handle.focus();
      await page.keyboard.press("ArrowUp");
      await poll(
        () =>
          sql(`SELECT position FROM workflow_statuses WHERE id IN ('${status.id}','${sibling.id}') ORDER BY id='${status.id}' DESC`),
        (rows) => rows[0]?.position < rows[1]?.position,
        "reordered status",
      );
      const ordered = sql(
        `SELECT position FROM workflow_statuses WHERE team_id='${team.id}' ORDER BY position`,
      ).map((s) => s.position);
      assert.equal(new Set(ordered).size, 8, "collision-free full workflow");
    },
  );
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

  await openTeam(page, base, team, "details");
  await clause(
    "TEAM-001",
    "issued identifiers freeze the team prefix in administration",
    async () => {
      assert.equal(
        await page.getByLabel("Identifier prefix", { exact: true }).count(),
        0,
      );
      await page
        .getByText("Locked because this team has issued identifiers.", { exact: true })
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
      await openTeam(page, base, team, "workflow");
      await page.getByRole("button", { name: "Actions for Reviewing", exact: true }).click();
      await page.getByRole("menuitem", { name: "Remove…", exact: true }).click();
      const group = page.getByRole("group", { name: /^Remove Reviewing\?/ });
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
      // The last status of a category has no Remove, only the explicit refusal.
      await page.getByRole("button", { name: "Actions for " + to.name, exact: true }).click();
      const menu = page.getByRole("menu", { name: "Actions for " + to.name, exact: true });
      await menu.getByText("This category’s last status cannot be removed.", { exact: true }).waitFor();
      assert.equal(
        await menu.getByRole("menuitem", { name: "Remove…", exact: true }).count(),
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
  const peerTeams = teamList(peer);
  const toggle = async (actor, region, action, status) => {
    const path = `/api/teams/${team.id}/${action}`;
    if (status !== 200) refusals.add(base + path);
    const done = actor.waitForResponse((r) => new URL(r.url()).pathname === path);
    await region.getByRole("button", { name: `${action === "join" ? "Join" : "Leave"} ${team.name}`, exact: true }).click();
    assert.equal((await done).status(), status);
  };
  await navigate(peer, base + "/app/settings/teams");
  for (const width of [1440, 390]) {
    await peer.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await clause("ROLE-007", `a Member joins a public team from the list at ${width} and finds its settings, members and permissions read-only`, async () => {
      await toggle(peer, peerTeams, "join", 200);
      await peerTeams.getByRole("button", { name: `Leave ${team.name}`, exact: true }).waitFor();
      assert.equal(membership(), "member");
      // Once theirs, the team opens: its settings are plain text with no control to change them.
      await peerTeams.getByRole("link", { name: team.name, exact: true }).click();
      await peer.getByText("Only this team’s owners and Admins change its settings.", { exact: true }).waitFor();
      assert.equal(await peer.getByLabel("Name", { exact: true }).count(), 0);
      assert.equal(await peer.getByRole("button", { name: `Archive ${team.name}`, exact: true }).count(), 0);
      await peer.getByRole("navigation", { name: "Team sections", exact: true }).getByRole("link", { name: "People", exact: true }).click();
      await peer.getByText("Only this team’s owners and Admins change its members.", { exact: true }).waitFor();
      assert.equal(await peer.getByLabel("Add member", { exact: true }).count(), 0);
      assert.equal(await peer.getByRole("switch").count(), 0, "a Member who owns nothing has no joining switch");
      assert.equal(await peer.getByRole("navigation", { name: "Team sections", exact: true }).getByRole("link", { name: "Automation", exact: true }).count(), 0, "Automation is absent, not greyed");
      await peer.getByRole("navigation", { name: "Team sections", exact: true }).getByRole("link", { name: "Planning", exact: true }).click();
      await peer.getByText("Who manages", { exact: true }).waitFor();
      assert.equal(await peer.getByLabel("Team settings", { exact: true }).count(), 0, "who manages is text for a Member without the permission");
      await navigate(peer, base + "/app/settings/teams");
    });
    if (width === 1440) {
      await inspect(peer, peerTeams, "team-member-view");
      await peer.setViewportSize({ width, height: 1000 });
    }
    await clause("ROLE-007", `the Member leaves the team from the list at ${width}`, async () => {
      await toggle(peer, peerTeams, "leave", 200);
      await peerTeams.getByRole("button", { name: `Join ${team.name}`, exact: true }).waitFor();
      assert.equal(membership(), undefined);
    });
  }
  await navigate(page, base + "/app/settings/teams");
  const teams = teamList(page);
  await clause("ROLE-007", "the last team owner cannot leave until another is named", async () => {
    await toggle(page, teams, "leave", 409);
    await teams.getByRole("alert").filter({ hasText: "Name another team owner before the last one leaves." }).waitFor();
  });
  await inspect(page, teams, "team-last-owner-refused");
  await clause("ROLE-007 ROLE-009", "a team owner adds a member, names a team owner and sets the two permissions, each audited once", async () => {
    await openTeam(page, base, team, "people");
    const added = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/settings/teams/${team.id}/members/${memberId}` && r.request().method() === "PUT");
    await page.getByLabel("Add member", { exact: true }).selectOption({ label: "Role member" });
    assert.equal((await added).status(), 200);
    await poll(() => [membership()], ([role]) => role === "member", "member added");
    await page.getByLabel("Team role for Role member", { exact: true }).selectOption("owner");
    await poll(() => [membership()], ([role]) => role === "owner", "team owner named");
    await openTeam(page, base, team, "planning");
    await page.getByLabel("Team settings", { exact: true }).selectOption("all_members");
    await poll(() => sql(`SELECT settings_permission AS value FROM teams WHERE id='${team.id}'`), (rows) => rows[0]?.value === "all_members", "settings permission");
    assert.equal(sql(`SELECT count(*) AS n FROM audit_records WHERE action='team.permission_changed' AND subject_id='${team.id}'`)[0].n, 1);
  });
  await inspect(page, page.locator(".settings-pane"), "team-owner-controls");
  await navigate(page, base + "/app/settings/teams");
  await clause("ROLE-007", "once another team owner is named, the former last owner leaves", async () => {
    await toggle(page, teamList(page), "leave", 200);
    assert.equal(sql(`SELECT count(*) AS n FROM team_members WHERE team_id='${team.id}' AND role='owner'`)[0].n, 1);
  });
}

export async function teamCreationPermission({page,peer,runtime,clause,evidence}) {
  const {base,sql}=runtime, inspect=roleScreens(evidence);
  const viewer=await inviteReader({owner:page,browser:page.context().browser(),runtime,email:'synthetic-vector-1944@vector.test',name:'synthetic-vector-1944'});
  try{
  const set=async value=>{
    await navigate(page,base+"/app/settings/workspace");
    const select=page.getByLabel("Who may create teams",{exact:true});
    await select.waitFor();
    // The policy saves as it changes: no Save button, a quiet Saved beside the control.
    assert.equal(await page.getByRole("button",{name:/^Save/}).count(),0);
    const choice=value?"members":"admins";
    // Choosing what is already set changes and sends nothing.
    if(await select.inputValue()===choice)return;
    const receipt=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/settings/teams/creation"&&r.request().method()==="PUT");
    await select.selectOption(choice);
    assert.equal((await receipt).status(),200);
  };
  const before=sql("SELECT count(*) n FROM audit_records WHERE action='workspace.team_creation_changed'")[0].n;
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:width===390?844:1000});
    await peer.setViewportSize({width,height:width===390?844:1000});
    await clause("TEAM-008",`workspace policy controls a Member's public team creation at ${width}`,async()=>{
      await navigate(peer,base+"/app/settings/teams");
      assert.equal(await peer.getByRole("button",{name:"New team",exact:true}).count(),0);
      assert.equal(await peer.getByLabel("Who may create teams",{exact:true}).count(),0);
      await teamCreationReaderCell(viewer,runtime,width);
      await set(true);
      await teamCreationReaderCell(viewer,runtime,width);
      await privateTeamCreationCells({page,peer,runtime,width,evidence});
      assert.equal((await peer.request.post(base+'/api/settings/teams',{headers:{Origin:base},data:{name:'synthetic-vector-1945',identifierPrefix:'SYNPRIVATE',isPrivate:true}})).status(),403);
      await navigate(peer,base+"/app/settings/teams");
      await peer.getByRole("button",{name:"New team",exact:true}).click();
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
      await navigate(peer,base+"/app/settings/teams");
      assert.equal(await peer.getByRole("button",{name:"New team",exact:true}).count(),0);
      assert.equal(sql("SELECT count(*) n FROM teams WHERE id='"+owned[0].id+"'")[0].n,1);
    });
  }
  await navigate(page,base+"/app/settings/teams");
  await inspect(page,teamList(page),"team-creation-policy");
  await inspect(peer,teamList(peer),"member-team-created");
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
    await openTeam(peer,base,team,"people");
    await inviteOnlyWithRequests(peer,team);
    assert.equal((await requester.request.post(base+`/api/teams/${team.id}/join`,{headers:{Origin:base},data:{}})).status(),403);
    await navigate(requester,base+"/app/settings/teams");
    const requested=requester.waitForResponse(r=>new URL(r.url()).pathname===`/api/teams/${team.id}/requests`);
    await requester.getByRole("button",{name:"Request to join "+name,exact:true}).click();assert.equal((await requested).status(),200);
    await teamList(requester).getByRole("listitem").filter({hasText:name}).getByText("Request pending").waitFor();
    assert.equal(sql(`SELECT count(*) n FROM team_members WHERE team_id='${team.id}' AND operator_id='${member}'`)[0].n,0);
    if(width===1440)await inspect(requester,teamList(requester),"public-team-request-pending");
    await openTeam(peer,base,team,"people");
    let group=peer.getByRole("group",{name:"Request from Delivery lead",exact:true});
    const decide=async decision=>{
     const receipt=peer.waitForResponse(r=>new URL(r.url()).pathname===`/api/settings/teams/${team.id}/requests/${member}/decision`);
     await group.getByRole("button",{name:(decision==="approved"?"Approve ":"Decline ")+"Delivery lead",exact:true}).click();assert.equal((await receipt).status(),200);
    };
    if(width===390) {
     await decide("declined");
     assert.equal(sql(`SELECT count(*) n FROM team_members WHERE team_id='${team.id}' AND operator_id='${member}'`)[0].n,0);
     await navigate(requester,base+"/app/settings/teams");
     const retry=requester.waitForResponse(r=>new URL(r.url()).pathname===`/api/teams/${team.id}/requests`);
     await requester.getByRole("button",{name:"Request to join "+name,exact:true}).click();assert.equal((await retry).status(),200);
     await openTeam(peer,base,team,"people");
     group=peer.getByRole("group",{name:"Request from Delivery lead",exact:true});
    }
    if(width===1440)await inspect(peer,peer.getByRole("region",{name:"Membership for "+name,exact:true}),"team-owner-request-decision");
    await decide("approved");
    const before=sql(`SELECT count(*) n FROM audit_records WHERE action='team.join_request_approved' AND subject_id='${team.id}'`)[0].n;
    assert.equal(before,1);
    assert.equal((await peer.request.post(base+`/api/settings/teams/${team.id}/requests/${member}/decision`,{headers:{Origin:base},data:{decision:"approved"}})).status(),200);
    assert.equal(sql(`SELECT count(*) n FROM audit_records WHERE action='team.join_request_approved' AND subject_id='${team.id}'`)[0].n,before);
    assert.equal(sql(`SELECT count(*) n FROM team_members WHERE team_id='${team.id}' AND operator_id='${member}'`)[0].n,1);
    await navigate(requester,base+"/app/settings/teams");await requester.getByRole("button",{name:"Leave "+name,exact:true}).waitFor();
    // Joining mode and Accept requests each store as they change, so each is audited once.
    assert.equal(sql(`SELECT count(*) n FROM audit_records WHERE action='team.membership_mode_changed' AND subject_id='${team.id}'`)[0].n,2);
   });
   await clause('TEAM-007',`private and Viewer membership cells at ${width}`,()=>teamJoinReaderCells({page,peer,requester,viewer,runtime,team,member,width}));
  }
 } finally {await context.close();await viewer.context.close();}
}

/** An explicitly exposed private request grants metadata only until approval. */
export async function privateTeamRequest({page,peer,memberId,runtime,team,clause}) {
 const {base}=runtime;
 await openTeam(page,base,team,'people');
 await inviteOnlyWithRequests(page,team);
 let response;
 await navigate(peer,base+'/app/settings/teams');
 response=peer.waitForResponse(r=>new URL(r.url()).pathname===`/api/teams/${team.id}/requests`);
 await peer.getByRole('button',{name:'Request to join '+team.name,exact:true}).click();assert.equal((await response).status(),200);
 await teamList(peer).getByRole('listitem').filter({hasText:team.name}).getByText('Request pending').waitFor();
 assert.equal((await readerResponse(peer,base,'/issues/'+team.identifier)).status,404);
 assert.equal(runtime.sql(`SELECT count(*) n FROM team_members WHERE team_id='${team.id}' AND operator_id='${memberId}'`)[0].n,0);
 await openTeam(page,base,team,'people');
 response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/settings/teams/${team.id}/requests/${memberId}/decision`);
 await page.getByRole('button',{name:'Approve Role member',exact:true}).click();assert.equal((await response).status(),200);
 assert.equal((await readerResponse(peer,base,'/issues/'+team.identifier)).status,200);
}

/** ROLE-002(a): non-member Admin metadata has counts and membership, with no work form. */
export async function privateAdminMetadata({peer,name,team,api,inspect,width}) {
 const metadata=peer.getByRole('region',{name:'Metadata for '+name,exact:true});
 assert.ok((await metadata.innerText()).includes('1 member · 1 team owner · 1 issue'));
 assert.ok((await metadata.innerText()).includes('Team owner'));
 await inspect(peer,metadata,'private-team-admin-metadata-counts-'+width);
 const state=(await api(peer,'/settings/administration')).teams.find(t=>t.id===team.id);
 assert.equal(state.issueCount,1);assert.equal(state.canRead,false);assert.equal(state.members.length,1);
}
