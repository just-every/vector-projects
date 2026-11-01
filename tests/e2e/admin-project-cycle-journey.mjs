import { withOperatorClient } from './operator-request.mjs';
import {projectTemplateAccessCells} from './template-access-cells.mjs';
import {projectTemplatesJourney,nativeProjectTemplatesJourney} from './project-templates-journey.mjs';
// Settle native polling before replacing an authorized private document.
import { beforePrivateNavigation } from "./collaboration-navigation.mjs";
import assert from "node:assert/strict";
import { poll } from "./admin-runtime-support.mjs";
import {
  openDisclosures,
  openAdministrationForm,
} from "./ui-controls-checks.mjs";
export async function authorProject({ page, runtime, capture, clause, expectedTemplateConflicts }) {
  const { base, sql } = runtime;
  await beforePrivateNavigation(page, base + "/app/projects");
  await page.goto(base + "/app/projects");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await clause(
    "PROJ-001",
    "create project with lead Markdown optional target and Planned lifecycle",
    async () => {
      const create = page.getByRole("form", {
        name: "Create project",
        exact: true,
      });
      await create
        .getByLabel("Project name", { exact: true })
        .fill("Administration launch");
      await create
        .getByLabel("Project description", { exact: true })
        .fill(
          "## Delivery notes\n\n**Visible Markdown** and a [safe link](https://example.com).",
        );
      await create
        .getByRole("combobox", { name: "Project lead", exact: true })
        .selectOption(
          sql("SELECT id FROM operators WHERE removed_at IS NULL")[0].id,
        );
      await create
        .getByRole("button", { name: "Create project", exact: true })
        .click();
      await poll(
        () => sql("SELECT * FROM projects WHERE name='Administration launch'"),
        (rows) => rows.length === 1,
        "created project",
      );
      const project = sql(
        "SELECT * FROM projects WHERE name='Administration launch'",
      )[0];
      assert.equal(project.lifecycle, "planned");
      assert.equal(project.target_date, null);
      assert.ok(project.lead_operator_id);
    },
  );
  const created = sql(
    "SELECT * FROM projects WHERE name='Administration launch'",
  )[0];
  await page.getByRole("heading", { name: "Administration launch", exact: true }).waitFor();
  await beforePrivateNavigation(page, base + "/app/projects/" + created.id);
  await page.goto(base + "/app/projects/" + created.id);
  await openAdministrationForm(page, "Edit project Administration launch");
  await capture("project-planned-no-target");
  await clause(
    "PROJ-002",
    "operator explicitly changes project lifecycle",
    async () => {
      const edit = page.getByRole("form", {
        name: "Edit project Administration launch",
        exact: true,
      });
      await edit
        .getByLabel("Project name", { exact: true })
        .fill("Administration delivery");
      await edit
        .getByLabel("Project target date", { exact: true })
        .fill("2027-02-28");
      await edit
        .getByRole("combobox", { name: "Project lifecycle", exact: true })
        .selectOption("active");
      await edit
        .getByRole("button", { name: "Save project", exact: true })
        .click();
      await poll(
        () =>
          sql("SELECT * FROM projects WHERE name='Administration delivery'"),
        (rows) =>
          rows[0]?.lifecycle === "active" &&
          rows[0].target_date === "2027-02-28",
        "project administration",
      );
    },
  );
  const project = sql(
    "SELECT * FROM projects WHERE name='Administration delivery'",
  )[0];

  await beforePrivateNavigation(page, base + "/app/projects/" + project.id);
  await page.goto(base + "/app/projects/" + project.id);
  await page
    .getByRole("heading", { name: project.name, exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Delivery notes", exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator("strong")
      .filter({ hasText: "Visible Markdown" })
      .count(),
    1,
    "safe Markdown renderer",
  );
  await capture("project-markdown-detail");

  await clause("PROJ-012", "save project structure, launch native issue teams and retain projects after template deletion", async()=>{await projectTemplatesJourney(page,page.context(),runtime,async name=>capture(name),expectedTemplateConflicts);await nativeProjectTemplatesJourney(page.context().browser());await projectTemplateAccessCells(page,runtime,process.cwd()+'/.artifacts/verification/admin-browser');});
  await beforePrivateNavigation(page, base + "/app/cycles");
  await page.goto(base + "/app/cycles");
  await openDisclosures(page);
  return project;
}
export async function authorCycles({ page, runtime, capture, clause, team }) {
  const { sql, base } = runtime;
  await beforePrivateNavigation(page, base + "/app/cycles");
  await page.goto(base + "/app/cycles");
  await page.getByRole("form", { name: "Create cycle", exact: true }).waitFor();
  const beforeCycles = sql("SELECT * FROM cycles ORDER BY id");
  await clause(
    "CYCLE-001",
    "manual nonoverlap cycles use workspace timezone and reject invalid end",
    async () => {
      const create = page.getByRole("form", {
        name: "Create cycle",
        exact: true,
      });
      await create
        .getByRole("combobox", { name: "Cycle team", exact: true })
        .selectOption(team.id);
      await create
        .getByLabel("Cycle name", { exact: true })
        .fill("Invalid end");
      await create
        .getByLabel("Cycle start", { exact: true })
        .fill("2026-10-01T09:00");
      await create
        .getByLabel("Cycle end", { exact: true })
        .fill("2026-10-01T08:00");
      await create
        .getByRole("button", { name: "Create cycle", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: /end|after/i })
        .waitFor();
      assert.deepEqual(
        sql("SELECT * FROM cycles ORDER BY id"),
        beforeCycles,
        "invalid end creates nothing",
      );
      await capture("cycle-end-validation");
      for (const [name, start, end] of [
        ["First window", "2026-10-01T09:00", "2026-10-15T09:00"],
        ["Second window", "2026-10-15T09:00", "2026-10-29T09:00"],
      ]) {
        await create
          .getByRole("combobox", { name: "Cycle team", exact: true })
          .selectOption(team.id);
        await create.getByLabel("Cycle name", { exact: true }).fill(name);
        await create.getByLabel("Cycle start", { exact: true }).fill(start);
        await create.getByLabel("Cycle end", { exact: true }).fill(end);
        await create.getByLabel("Cycle capacity", { exact: true }).fill("10");
        await create
          .getByRole("button", { name: "Create cycle", exact: true })
          .click();
        await poll(
          () => sql(`SELECT * FROM cycles WHERE name='${name}'`),
          (rows) => rows.length === 1,
          "manual cycle",
        );
      }
      const cycles = sql("SELECT * FROM cycles WHERE name IN ('First window','Second window') ORDER BY starts_at");
      assert.equal(cycles.length, 2);
      assert.equal(
        cycles[0].ends_at,
        cycles[1].starts_at,
        "touching windows allowed",
      );
      assert.equal(
        cycles[0].starts_at,
        "2026-09-30T23:00:00.000Z",
        "Brisbane wall time converted to stored instant",
      );
    },
  );
  await capture("cycles-two-manual-windows");
  return sql("SELECT * FROM cycles WHERE name IN ('First window','Second window') ORDER BY starts_at");
}

/** PROJ-011: native project controls and issue assignment, at each viewport. */
export async function milestonesJourney({page, runtime, capture, clause}) {
  const {base,sql}=runtime;
  const width=page.viewportSize().width;
  const name=`Checkout delivery ${width}`;
  const send=async(path,method,data)=>{
    return withOperatorClient(page.context(), async client => {
      const response=await client.fetch(base+'/api'+path,{method,headers:{Origin:base,Connection:'close'},data});
      assert.ok(response.ok(),`${method} ${path}: ${response.status()}`);
      return await response.json();
    });
  };
  const owner=sql('SELECT id FROM operators WHERE removed_at IS NULL ORDER BY id LIMIT 1')[0].id;
  const projects=await send('/settings/projects','POST',{name,leadOperatorId:owner});
  const project=projects.projects.find(item=>item.name===name);
  const otherName=`Follow-up delivery ${width}`;
  const other=(await send('/settings/projects','POST',{name:otherName,leadOperatorId:owner})).projects.find(item=>item.name===otherName);
  const go=async(path)=>{await beforePrivateNavigation(page,base+path);await page.goto(base+path);};
  const projectPath='/app/projects/'+project.id;
  await clause('PROJ-011','ordered milestones, progress, workspace-date slip and project-move clearing',async()=>{
    await go(projectPath);
    await page.getByRole('button',{name:'Add milestone',exact:true}).waitFor();
    await capture(`milestones-empty-${width}`);
    for(const [milestone,date,description] of [
      ['Payment foundation','', 'Checkout service and payment validation.'],
      ['Customer rollout','2001-01-01','Release to the customer cohort.'],
    ]) {
      await page.getByRole('button',{name:'Add milestone',exact:true}).click();
      const form=page.getByRole('form',{name:'Create milestone',exact:true});
      await form.getByLabel('Milestone name',{exact:true}).fill(milestone);
      await form.getByLabel('Milestone target date',{exact:true}).fill(date);
      await form.getByRole('textbox',{name:'Milestone description',exact:true}).fill(description);
      if(milestone==='Customer rollout')await capture(`milestone-create-${width}`);
      await form.getByRole('button',{name:'Create milestone',exact:true}).click();
      await page.getByRole('heading',{name:milestone,exact:true}).waitFor();
    }
    await page.getByRole('button',{name:'Edit Customer rollout',exact:true}).click();
    await capture(`milestone-edit-open-${width}`);
    const edit=page.getByRole('form',{name:'Edit milestone Customer rollout',exact:true});
    await edit.getByRole('textbox',{name:'Milestone description',exact:true}).fill('Release to the customer cohort after sign-off.');
    await capture(`milestone-edit-${width}`);
    await edit.getByRole('button',{name:'Save milestone',exact:true}).click();
    await page.getByText('Release to the customer cohort after sign-off.',{exact:true}).waitFor();
    await page.locator('.project-milestones li').filter({has:page.getByRole('heading',{name:'Customer rollout',exact:true})}).getByRole('button',{name:/^Move milestone \d+ up$/}).click();
    await poll(()=>sql(`SELECT name FROM project_milestones WHERE project_id='${project.id}' ORDER BY position`),rows=>rows[0]?.name==='Customer rollout','milestone reordered');
    const milestones=sql(`SELECT * FROM project_milestones WHERE project_id='${project.id}' ORDER BY position`);
    const team=sql('SELECT id FROM teams WHERE archived_at IS NULL ORDER BY id LIMIT 1')[0];
    const statuses=sql(`SELECT id,category FROM workflow_statuses WHERE team_id='${team.id}'`);
    const issues=[];
    for(const [title,milestone,category] of [
      [`Validate payment ${width}`,'Payment foundation','completed'],
      [`Roll out checkout ${width}`,'Customer rollout','unstarted'],
    ]) {
      await go('/app/new-issue');
      await page.getByLabel(/^Title/).fill(title);
      await page.getByLabel(/^Team/).selectOption(team.id);
      await openDisclosures(page);
      await page.getByLabel(/^Status/).selectOption(statuses.find(item=>item.category===category).id);
      await page.getByRole('combobox',{name:'Project',exact:true}).selectOption(project.id);
      await page.getByRole('combobox',{name:'Milestone',exact:true}).selectOption(milestones.find(item=>item.name===milestone).id);
      if(category==='unstarted'){
        await page.getByRole('combobox',{name:'Milestone',exact:true}).scrollIntoViewIfNeeded();
        await capture(`milestone-issue-create-${width}`);
      }
      await page.getByRole('button',{name:'Create issue',exact:true}).click();
      await page.getByRole('heading',{name:title,exact:true}).waitFor();
      issues.push(sql(`SELECT * FROM issues WHERE title='${title}'`)[0]);
    }
    await go(projectPath);
    await page.getByRole('button',{name:'Complete Payment foundation',exact:true}).click();
    await page.getByRole('button',{name:'Reopen Payment foundation',exact:true}).waitFor();
    const detail=await send('/projects/'+project.id,'GET');
    assert.equal(detail.milestones[0].name,'Customer rollout');
    assert.deepEqual(detail.milestones[0].progress,{completed:0,total:1,percentage:0});
    assert.equal(detail.milestones[0].slipped,true);
    assert.deepEqual(detail.milestones[1].progress,{completed:1,total:1,percentage:100});
    assert.equal(detail.milestones[1].completed,true);
    await page.getByRole('region',{name:'Project milestones',exact:true}).scrollIntoViewIfNeeded();
    await capture(`milestones-progress-${width}`);
    await go('/app/issues?'+new URLSearchParams({q:issues[1].title,grouping:'none'}));
    await page.locator('#issue-row-'+issues[1].identifier+':not(:disabled)').waitFor();
    await page.locator('#issue-row-'+issues[1].identifier).focus();
    await page.keyboard.press('x');
    await page.getByRole('combobox',{name:'Change',exact:true}).selectOption('milestoneId');
    await page.getByRole('button',{name:'Edit selected',exact:true}).click();
    const bulk=page.getByRole('dialog',{name:'Change milestone',exact:true});
    await bulk.getByRole('combobox',{name:'Milestone',exact:true}).selectOption(milestones.find(item=>item.name==='Payment foundation').id);
    await capture(`milestone-bulk-${width}`);
    const [bulkResponse]=await Promise.all([
      page.waitForResponse(response=>response.url()===base+'/api/issues/bulk'&&response.request().method()==='POST'),
      bulk.getByRole('button',{name:'Apply changes',exact:true}).click(),
    ]);
    assert.equal(bulkResponse.status(),200);
    await bulk.waitFor({state:'detached'});
    await go('/app/issues/'+issues[1].identifier);
    await page.getByRole('combobox',{name:'Issue milestone',exact:true}).selectOption(milestones.find(item=>item.name==='Customer rollout').id);
    await poll(()=>sql(`SELECT milestone_id FROM issues WHERE id='${issues[1].id}'`),rows=>rows[0]?.milestone_id===milestones.find(item=>item.name==='Customer rollout').id,'issue milestone edit');
    await capture(`milestone-issue-assigned-${width}`);
    await page.getByRole('combobox',{name:'Issue project',exact:true}).selectOption(other.id);
    await poll(()=>sql(`SELECT project_id,milestone_id FROM issues WHERE id='${issues[1].id}'`),rows=>rows[0]?.project_id===other.id&&rows[0].milestone_id===null,'moving issue clears milestone');
    await poll(()=>page.getByRole('combobox',{name:'Issue milestone',exact:true}).inputValue(),value=>value==='', 'rendered milestone clear after project move');
    assert.equal(await page.getByRole('combobox',{name:'Issue milestone',exact:true}).inputValue(),'');
    const activity=sql(`SELECT previous_value_json,next_value_json FROM issue_activity WHERE issue_id='${issues[1].id}' AND kind='issue.updated'`);
    assert.equal(activity.filter(row=>JSON.parse(row.next_value_json).milestoneId===null).length,1,'one activity entry for project move and milestone clear');
    await capture(`milestone-project-move-${width}`);
    await go(projectPath);
    await page.getByRole('button',{name:'Delete Customer rollout',exact:true}).click();
    await capture(`milestone-delete-confirm-${width}`);
    await page.getByRole('button',{name:'Confirm delete Customer rollout',exact:true}).click();
    await page.getByRole('heading',{name:'Customer rollout',exact:true}).waitFor({state:'hidden'});
    assert.equal(sql(`SELECT count(*) n FROM issues WHERE id IN ('${issues[0].id}','${issues[1].id}')`)[0].n,2,'milestone delete keeps issues');
    await capture(`milestone-deleted-${width}`);
  });
}
export async function archiveProject({
  page,
  runtime,
  capture,
  clause,
  project,
  issue,
}) {
  const { base, sql } = runtime;

  await beforePrivateNavigation(page, base + "/app/projects/" + project.id);
  await page.goto(base + "/app/projects/" + project.id);
  await openAdministrationForm(page, "Edit project " + project.name);
  await clause(
    "PROJ-009",
    "archive excludes default portfolio retains members include archived and unarchive restore",
    async () => {
      const visibleBefore = sql("SELECT count(*) n FROM projects WHERE archived_at IS NULL")[0].n;
      const allProjects = sql("SELECT count(*) n FROM projects")[0].n;
      const edit = page.getByRole("form", {
        name: "Edit project " + project.name,
        exact: true,
      });
      await edit
        .getByRole("button", { name: "Archive project", exact: true })
        .click();
      await poll(
        () => sql(`SELECT * FROM projects WHERE id='${project.id}'`),
        (rows) => Boolean(rows[0]?.archived_at),
        "archived project",
      );
      assert.equal(
        sql(`SELECT project_id FROM issues WHERE id='${issue.id}'`)[0]
          .project_id,
        project.id,
      );
      assert.equal(
        sql(`SELECT lifecycle FROM projects WHERE id='${project.id}'`)[0]
          .lifecycle,
        "active",
      );

      await beforePrivateNavigation(page, base + "/app/projects");
      await page.goto(base + "/app/projects");
      await page
        .getByRole("heading", { name: "Projects", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("link", { name: "Open " + project.name, exact: true })
          .count(),
        0,
        "default excludes archived project",
      );
      assert.equal(
        (
          await page
            .locator(".project-metric")
            .first()
            .locator("strong")
            .textContent()
        ).trim(),
        String(visibleBefore - 1),
        "default portfolio count excludes archived",
      );
      await page
        .getByLabel("Include archived projects", { exact: true })
        .check();
      await page
        .getByRole("link", { name: "Open " + project.name, exact: true })
        .waitFor();
      assert.equal(
        (
          await page
            .locator(".project-metric")
            .first()
            .locator("strong")
            .textContent()
        ).trim(),
        String(allProjects),
        "include archived rows and portfolio count agree",
      );
      await capture("projects-include-archived");
      await beforePrivateNavigation(
        page,
        base + "/app/issues/" + issue.identifier,
      );
      await page.goto(base + "/app/issues/" + issue.identifier);
      await page
        .getByRole("heading", { name: issue.title, exact: true })
        .waitFor();
      const beforeEdit = sql(
        `SELECT version FROM issues WHERE id='${issue.id}'`,
      )[0].version;
      await page
        .locator(".issue-property-bar")
        .getByLabel("Issue priority", { exact: true })
        .selectOption("low");
      await poll(
        () =>
          sql(
            `SELECT version,priority,project_id FROM issues WHERE id='${issue.id}'`,
          ),
        (rows) =>
          rows[0]?.version === beforeEdit + 1 &&
          rows[0].priority === "low" &&
          rows[0].project_id === project.id,
        "existing issue edit retains archived project",
      );
      await capture("archived-project-retained-issue-edit");

      await beforePrivateNavigation(page, base + "/app/projects/" + project.id);
      await page.goto(base + "/app/projects/" + project.id);
      await openAdministrationForm(page, "Edit project " + project.name);
      await page
        .getByRole("form", {
          name: "Edit project " + project.name,
          exact: true,
        })
        .getByRole("button", { name: "Unarchive project", exact: true })
        .click();
      await poll(
        () => sql(`SELECT archived_at FROM projects WHERE id='${project.id}'`),
        (rows) => rows[0]?.archived_at === null,
        "unarchived project",
      );
    },
  );
  await capture("project-unarchived");
}
