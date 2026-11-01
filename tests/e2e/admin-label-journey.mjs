// Settle native polling before replacing an authorized private document.
import { beforePrivateNavigation } from "./collaboration-navigation.mjs";
import assert from "node:assert/strict";
import { poll } from "./admin-runtime-support.mjs";
import { insertPrivateViewFixture } from "./admin-saved-view-fixture.mjs";
export async function authorLabel({ page, runtime, capture, clause }) {
  const { sql } = runtime;
  await clause(
    "ISSUE-014",
    "create rename recolour readable workspace label",
    async () => {
      // Labels have their own Settings page; a new label opens in place, only when asked.
      await beforePrivateNavigation(page, runtime.base + "/app/settings/labels");
      await page.goto(runtime.base + "/app/settings/labels");
      assert.equal(await page.getByRole("form", { name: "Create label", exact: true }).count(), 0);
      await page.getByRole("button", { name: "New label", exact: true }).first().click();
      const create = page.getByRole("form", {
        name: "Create label",
        exact: true,
      });
      await create.getByLabel("Name", { exact: true }).fill("Evidence");
      await create.getByLabel("Colour", { exact: true }).fill("#224466");
      await create
        .getByRole("button", { name: "Create label", exact: true })
        .click();
      await poll(
        () => sql("SELECT * FROM labels WHERE name='Evidence'"),
        (rows) => rows.length === 1,
        "created label",
      );
      await page.getByRole("button", { name: "Evidence", exact: true }).click();
      await capture("label-created");
      // A label's name and colour store as they change: no Save button.
      const path = "/api/settings/labels/" + sql("SELECT id FROM labels WHERE name='Evidence'")[0].id;
      const renamed = page.waitForResponse((r) => new URL(r.url()).pathname === path && r.request().method() === "PATCH");
      const name = page.getByLabel("Name", { exact: true });
      await name.fill("Verified evidence");
      await name.blur();
      assert.equal((await renamed).status(), 200);
      const recoloured = page.waitForResponse((r) => new URL(r.url()).pathname === path && r.request().method() === "PATCH");
      await page.getByLabel("Colour", { exact: true }).fill("#f5dd44");
      assert.equal((await recoloured).status(), 200);
      assert.equal(await page.getByRole("button", { name: /^Save(?!d)/ }).count(), 0);
      await poll(
        () => sql("SELECT * FROM labels WHERE name='Verified evidence'"),
        (rows) => rows[0]?.color === "#f5dd44",
        "renamed recoloured label",
      );
    },
  );
  await capture("label-renamed-recoloured");
  return sql("SELECT * FROM labels WHERE name='Verified evidence'")[0];
}
export async function deleteAppliedLabel({
  page,
  runtime,
  capture,
  clause,
  label,
  issue,
}) {
  const { base, sql } = runtime;
  const view = await insertPrivateViewFixture(runtime, label);
  const made = await page.request.post(base+"/api/settings/labels",{headers:{Origin:base},data:{name:"synthetic-vector-merge-target",color:"#224466"}});
  assert.equal(made.status(),200);
  const destination = (await made.json()).labels.find(row=>row.name==="synthetic-vector-merge-target");
  const second = await page.request.post(base+"/api/issues",{headers:{Origin:base},data:{title:"synthetic-vector-merge-second",teamId:issue.team_id,labelIds:[label.id,destination.id]}});
  assert.equal(second.status(),201);
  const secondIssue = await second.json();
  await beforePrivateNavigation(page,base+"/app/settings/labels");
  await page.goto(base+"/app/settings/labels");
  // Merge into… is asked once, under the label's own "…".
  await page.getByRole("button",{name:"Actions for "+label.name,exact:true}).click();
  await page.getByRole("menuitem",{name:"Merge into…",exact:true}).click();
  const merge=page.getByRole("group",{name:"Merge "+label.name+" into",exact:true});
  await merge.getByLabel("Merge "+label.name+" into",{exact:true}).selectOption(destination.id);
  const {roleScreens}=await import("./role-ui-support.mjs");
  await roleScreens(".artifacts/verification/admin-browser")(page,merge,"label-merge");
  const merged=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/settings/labels/${label.id}/merge`);
  await merge.getByRole("button",{name:"Merge label",exact:true}).click();
  assert.equal((await merged).status(),200);
  assert.equal(sql(`SELECT count(*) n FROM labels WHERE id='${label.id}'`)[0].n,0);
  for (const id of [issue.id,secondIssue.id]) {
    assert.equal(sql(`SELECT count(*) n FROM issue_labels WHERE issue_id='${id}' AND label_id='${destination.id}'`)[0].n,1);
    assert.equal(sql(`SELECT count(*) n FROM issue_activity WHERE issue_id='${id}' AND kind='label.merged'`)[0].n,1);
  }
  const rewritten=JSON.parse(sql(`SELECT filters_json FROM saved_views WHERE id='${view.id}'`)[0].filters_json);
  assert.deepEqual(rewritten,{...view.filters,labelIds:[destination.id]});
  label=destination;

  await beforePrivateNavigation(page, base + "/app/settings/labels");
  await page.goto(base + "/app/settings/labels");
  await clause(
    "ISSUE-007",
    "label delete cascades issue selections with immutable before/after history",
    async () => {
      const before = sql(`SELECT version FROM issues WHERE id='${issue.id}'`)[0]
        .version;
      assert.equal(
        sql(
          `SELECT count(*) n FROM issue_labels WHERE issue_id='${issue.id}' AND label_id='${label.id}'`,
        )[0].n,
        1,
      );
      await page.getByRole("button", { name: "Actions for " + label.name, exact: true }).click();
      await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
      await capture("label-delete-confirmation");
      const receipt = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === "/api/settings/labels/" + label.id &&
          r.request().method() === "DELETE",
      );
      await page
        .getByRole("button", { name: "Delete label", exact: true })
        .click();
      assert.equal((await receipt).status(), 200);
      await poll(
        () => sql(`SELECT version FROM issues WHERE id='${issue.id}'`),
        (rows) => rows[0]?.version === before + 1,
        "label cascade version",
      );
      assert.equal(
        sql(`SELECT count(*) n FROM labels WHERE id='${label.id}'`)[0].n,
        0,
      );
      assert.equal(
        sql(
          `SELECT count(*) n FROM issue_labels WHERE label_id='${label.id}'`,
        )[0].n,
        0,
      );
      const filters = JSON.parse(
        sql(`SELECT filters_json FROM saved_views WHERE id='${view.id}'`)[0]
          .filters_json,
      );
      assert.deepEqual(
        filters,
        { ...view.filters, labelIds: [] },
        "private saved-view cascade preserves custom and other predicates",
      );
      const activities = sql(
        `SELECT * FROM issue_activity WHERE issue_id='${issue.id}' AND previous_value_json LIKE '%${label.id}%'`,
      );
      assert.ok(
        activities.length > 0,
        "label before/after remains in activity",
      );
      assert.ok(
        activities.every((row) => row.actor_operator_id && row.created_at),
      );
    },
  );

  await beforePrivateNavigation(page, base + "/app/issues/" + issue.identifier);
  await page.goto(base + "/app/issues/" + issue.identifier);
  await page.getByRole("heading", { name: issue.title, exact: true }).waitFor();
  await capture("label-cascade-issue-history");
}

/** ISSUE-014: a Member creates in the issue picker; the Settings list offers New label only while the workspace lets Members create. */
export async function memberLabelCreation({page, peer, runtime, clause, evidence, refusals}) {
  const {navigate} = await import("./collaboration-navigation.mjs");
  const {roleScreens} = await import("./role-ui-support.mjs");
  const inspect = roleScreens(evidence), {base,sql}=runtime;
  const team=sql("SELECT id FROM teams WHERE identifier_prefix='"+runtime.config.DEFAULT_TEAM_PREFIX+"'")[0];
  const made=await page.request.post(base+"/api/issues", {headers:{Origin:base},data:{title:"synthetic-vector-label-creation",teamId:team.id}});
  assert.equal(made.status(),201);
  const issue=await made.json();
  const permission=async (membersMayCreate) => {
    await navigate(page,base+"/app/settings/workspace");
    const select=page.getByLabel("Who may create labels",{exact:true});
    await select.waitFor();
    // The policy saves as it changes: no Save button, a quiet Saved beside the control.
    assert.equal(await page.getByRole("button",{name:/^Save(?!d)/}).count(),0);
    const choice=membersMayCreate?"members":"admins";
    // Choosing what is already set changes and sends nothing.
    if(await select.inputValue()===choice)return;
    const receipt=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/settings/labels/creation"&&r.request().method()==="PUT");
    await select.selectOption(choice);
    assert.equal((await receipt).status(),200);
  };
  const open=async()=>{
    await navigate(peer,base+"/app/issues/"+issue.identifier);
    await peer.getByRole("heading",{name:issue.title,exact:true}).waitFor();
    await peer.getByRole("button",{name:/^Labels(?: · \d+)?$/}).click();
  };
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:width===390?844:1000});
    await peer.setViewportSize({width,height:width===390?844:1000});
    await permission(true);
    await clause("ISSUE-014",`Member inline creation at ${width} follows the workspace permission without workspace management`,async()=>{
      // The Settings list offers New label exactly while Members may create labels.
      await navigate(peer,base+"/app/settings/labels");
      await peer.getByRole("button",{name:"New label",exact:true}).first().waitFor();
      await open();
      const form=peer.getByRole("form",{name:"Create label inline",exact:true});
      const name="synthetic-vector-inline-"+width;
      await form.getByLabel("New label name",{exact:true}).fill(name);
      await form.getByLabel("New label colour",{exact:true}).fill("#224466");
      const receipt=peer.waitForResponse(r=>new URL(r.url()).pathname==="/api/settings/labels"&&r.request().method()==="POST");
      await form.getByRole("button",{name:"Create label",exact:true}).click();
      assert.equal((await receipt).status(),200);
      const apply=peer.getByRole("form",{name:"Apply issue labels",exact:true});
      await apply.getByLabel(name,{exact:true}).waitFor();
      assert.equal(await apply.getByLabel(name,{exact:true}).isChecked(),true);
      const saved=peer.waitForResponse(r=>new URL(r.url()).pathname==="/api/issues/"+issue.identifier&&r.request().method()==="PATCH");
      await apply.getByRole("button",{name:"Save labels",exact:true}).click();
      assert.equal((await saved).status(),200);
      await permission(false);
      await navigate(peer,base+"/app/settings/labels");
      await peer.getByRole("list",{name:"Labels",exact:true}).waitFor();
      assert.equal(await peer.getByRole("button",{name:"New label",exact:true}).count(),0);
      await open();
      assert.equal(await peer.getByRole("form",{name:"Create label inline",exact:true}).count(),0);
      assert.equal((await peer.request.post(base+"/api/settings/labels",{headers:{Origin:base},data:{name:"synthetic-vector-refused-"+width,color:"#224466"}})).status(),403);
      assert.equal(sql("SELECT count(*) n FROM labels WHERE name='synthetic-vector-refused-"+width+"'")[0].n,0);
      const managed=base+"/api/settings/labels/creation";
      refusals.add(managed);
      assert.equal((await peer.request.put(managed,{headers:{Origin:base},data:{membersMayCreate:true}})).status(),403);
    });
  }
  await inspect(peer,peer.getByRole("form",{name:"Apply issue labels",exact:true}),"member-labels-restricted");
  await permission(true);
  await open();
  await inspect(peer,peer.getByRole("form",{name:"Create label inline",exact:true}),"member-labels-inline-create");
  assert.equal(sql("SELECT count(*) n FROM audit_records WHERE action='workspace.label_creation_changed'")[0].n,4);
}
