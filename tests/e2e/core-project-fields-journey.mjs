import { withOperatorClient } from './operator-request.mjs';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { beforePrivateNavigation, settleReads } from './collaboration-navigation.mjs';
import { openAdministrationForm,openDisclosures } from './ui-controls-checks.mjs';
import { poll } from './admin-runtime-support.mjs';

/** Called by the runtime's authenticated page at each required viewport. */
export async function projectFieldsJourney({page,runtime,capture,clause,expectedProjectRejections=new Set()}) {
  const {base,sql}=runtime;
  const suffix=String(page.viewportSize().width)+'-'+randomBytes(3).toString('hex');
  const name=`Project planning ${suffix}`;
  const labels=[`Delivery ${suffix}`,`Customer ${suffix}`];
  await beforePrivateNavigation(page,base+'/app/settings/labels');
  await page.goto(base+'/app/settings/labels');
  await openDisclosures(page);
  for(const name of labels) {
    const form=page.getByRole('form',{name:'Create label',exact:true});
    await form.getByLabel('Label name',{exact:true}).fill(name);
    await form.getByLabel('Use for projects',{exact:true}).check();
    if(name===labels[0])await capture(`project-label-settings-${suffix}`);
    await form.getByRole('button',{name:'Create label',exact:true}).click();
    await poll(()=>sql(`SELECT id FROM labels WHERE name='${name}' AND projects_enabled=1`),rows=>rows.length===1,'enabled project label');
  }
  const labelIds=labels.map(name=>sql(`SELECT id FROM labels WHERE name='${name}'`)[0].id);
  await beforePrivateNavigation(page,base+'/app/projects');
  await page.goto(base+'/app/projects');
  await page.getByRole('button',{name:'Reset filters',exact:true}).click();
  await page.getByRole('button',{name:'New project',exact:true}).click();
  const create=page.getByRole('form',{name:'Create project',exact:true});
  await create.getByLabel('Project name',{exact:true}).fill(name);
  await create.getByRole('combobox',{name:'Project lead',exact:true}).selectOption(sql('SELECT id FROM operators WHERE removed_at IS NULL ORDER BY id LIMIT 1')[0].id);
  await capture(`project-create-${suffix}`);
  await create.getByRole('button',{name:'Create project',exact:true}).click();
  await page.waitForURL(url => url.pathname.startsWith('/app/projects/'));
  await page.getByRole('heading',{name,exact:true}).waitFor();
  await openAdministrationForm(page,`Edit project ${name}`);
  const edit=page.getByRole('form',{name:`Edit project ${name}`,exact:true});
  await clause('PROJ-001','project planning dates, priority and two workspace labels each record activity',async()=>{
    await edit.getByLabel('Project start date',{exact:true}).fill('2027-02-01');
    await edit.getByLabel('Project target date',{exact:true}).fill('2027-02-20');
    await edit.getByRole('combobox',{name:'Project priority',exact:true}).selectOption('high');
    for (const label of labels) await edit.getByRole('checkbox',{name:label,exact:true}).check();
    await edit.getByRole('button',{name:'Save project',exact:true}).click();
    await poll(()=>sql(`SELECT id,start_date,target_date,priority FROM projects WHERE name='${name}'`),rows=>rows[0]?.start_date==='2027-02-01'&&rows[0]?.target_date==='2027-02-20'&&rows[0]?.priority==='high','planning fields saved');
    const project=sql(`SELECT id FROM projects WHERE name='${name}'`)[0];
    assert.equal(sql(`SELECT * FROM project_labels WHERE project_id='${project.id}'`).length,2);
    assert.equal(sql(`SELECT * FROM project_activity WHERE project_id='${project.id}' AND kind LIKE '%_changed'`).length,4);
    // The saved dates re-key the edit form when the reload lands; let it land before editing again.
    await settleReads(page);
    await openAdministrationForm(page,`Edit project ${name}`);
    await edit.getByLabel('Project target date',{exact:true}).fill('2027-01-01');
    const [refused] = await Promise.all([
      page.waitForResponse(response=>response.url()===base+'/api/settings/projects/'+project.id && response.request().method()==='PATCH'),
      edit.getByRole('button',{name:'Save project',exact:true}).click(),
    ]);
    assert.equal(refused.status(),400);
    expectedProjectRejections.add(refused.url());
    await page.getByRole('alert').filter({hasText:'Target date must be on or after'}).waitFor();
    assert.equal(sql(`SELECT target_date FROM projects WHERE id='${project.id}'`)[0].target_date,'2027-02-20');
    await capture(`project-date-refusal-${suffix}`);
  });
  await clause('PROJ-001',"a project's color and icon save, appear on list and page and are one activity entry each",async()=>{
    await edit.getByLabel('Project target date',{exact:true}).fill('2027-02-20');
    await edit.getByRole('radio',{name:'Blue',exact:true}).check();
    await edit.getByLabel('Project icon',{exact:true}).fill('👩🏽‍💻');
    const project=sql(`SELECT id FROM projects WHERE name='${name}'`)[0];
    const detail=async()=>{
      const response=await page.request.get(base+'/api/projects/'+project.id);
      assert.equal(response.status(),200);
      return response.json();
    };
    await edit.getByRole('button',{name:'Save project',exact:true}).click();
    await poll(detail,value=>value.color==='#60a5fa'&&value.icon==='👩🏽‍💻','project appearance saved');
    await settleReads(page);
    const saved=await detail();
    for(const field of ['color','icon']) {
      const entries=saved.activity.filter(entry=>entry.kind===`project.${field}_changed`);
      assert.equal(entries.length,1);
      assert.equal(entries[0].previousValue,null);
      assert.equal(entries[0].nextValue,saved[field]);
    }
    const color=page.locator('.project-detail__header').getByRole('img',{name:'Project color #60a5fa',exact:true});
    await color.waitFor();
    assert.equal(await color.evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(96, 165, 250)');
    await page.locator('.project-detail__header').getByRole('img',{name:'Project icon 👩🏽‍💻',exact:true}).waitFor();
    assert.equal(await page.locator('.project-fact-list li').filter({has:page.getByText('Color changed',{exact:true})}).count(),1);
    assert.equal(await page.locator('.project-fact-list li').filter({has:page.getByText('Icon changed',{exact:true})}).count(),1);
    await openAdministrationForm(page,`Edit project ${name}`);
    const [unchanged]=await Promise.all([
      page.waitForResponse(response=>response.url()===base+'/api/settings/projects/'+project.id&&response.request().method()==='PATCH'),
      edit.getByRole('button',{name:'Save project',exact:true}).click(),
    ]);
    assert.equal(unchanged.status(),200);
    await settleReads(page);
    assert.deepEqual((await detail()).activity,saved.activity);
    await capture(`project-appearance-detail-${suffix}`);
  });
  await openAdministrationForm(page,`Edit project ${name}`);
  await edit.getByRole('combobox',{name:'Project lifecycle',exact:true}).selectOption('active');
  await edit.getByRole('button',{name:'Save project',exact:true}).click();
  await poll(()=>sql(`SELECT lifecycle FROM projects WHERE name='${name}'`),rows=>rows[0]?.lifecycle==='active','active planning project');
  const project=sql(`SELECT id,lead_operator_id FROM projects WHERE name='${name}'`)[0];
  const team=sql('SELECT id FROM teams WHERE archived_at IS NULL ORDER BY id LIMIT 1')[0];
  const issue=await page.request.post(base+'/api/issues',{headers:{Origin:base},data:{title:`Planning scope ${suffix}`,teamId:team.id,projectId:project.id}});
  assert.equal(issue.status(),201,await issue.text());
  const competitor=await page.request.post(base+'/api/settings/projects',{headers:{Origin:base},data:{name:`Other planning ${suffix}`,leadOperatorId:project.lead_operator_id,targetDate:'2027-04-20',priority:'low',labelIds:[labelIds[0]]}});
  assert.equal(competitor.status(),200,await competitor.text());
  await beforePrivateNavigation(page,base+'/app/projects/'+project.id);
  await page.goto(base+'/app/projects/'+project.id);
  await page.getByRole('heading',{name,exact:true}).waitFor();
  await page.getByRole('heading',{name:'Project activity',exact:true}).waitFor();
  await capture(`project-planning-detail-${suffix}`);
  await beforePrivateNavigation(page,base+'/app/projects');
  await page.goto(base+'/app/projects');
  const identityRow=page.getByRole('link',{name:`Open ${name}`,exact:true});
  await identityRow.getByRole('img',{name:'Project color #60a5fa',exact:true}).waitFor();
  await identityRow.getByRole('img',{name:'Project icon 👩🏽‍💻',exact:true}).waitFor();
  await capture(`project-appearance-list-${suffix}`);
  await clause('PROJ-007','every portfolio filter and combined filters keep rows and health/lifecycle counts aligned',async()=>{
    const assertPortfolio=async(query={})=>{
      // workerd can close a reused socket at its five-second idle boundary.
      // Retry this idempotent read once on ECONNRESET; HTTP errors still reach
      // the status assertion, and persistent connection failures still throw.
      const expected=await withOperatorClient(page.context(),async client=>{
        const response=await client.get(base+'/api/projects?'+new URLSearchParams(query),{maxRetries:1});
        assert.equal(response.status(),200);
        return response.json();
      });
      await poll(()=>page.locator('.project-row').evaluateAll(rows=>rows.map(row=>row.getAttribute('aria-label'))),rows=>JSON.stringify(rows)===JSON.stringify(expected.projects.map(project=>'Open '+project.name)),'portfolio rows match active filters');
      const values=await page.locator('.project-metric strong').allTextContents();
      assert.deepEqual(values,[expected.projects.length,expected.counts.blocked??0,expected.counts['at-risk']??0,expected.counts['on-track']??0,expected.counts.unknown??0].map(String));
      const lifecycleCounts=await page.locator('.project-lifecycle-counts span').allTextContents();
      assert.deepEqual(lifecycleCounts,['planned','active','completed','canceled'].map(state=>state[0].toUpperCase()+state.slice(1)+': '+(expected.counts[state]??0)));
    };
    const reset=async()=>{
      await page.getByRole('button',{name:'Reset filters',exact:true}).click();
      await assertPortfolio();
    };
    await reset();
    for(const [control,value,query] of [
      ['Lifecycle','active',{lifecycle:'active'}],['Health','on-track',{health:'on-track'}],
      ['Filter project lead',project.lead_operator_id,{lead:project.lead_operator_id}],
      ['Contributing team',team.id,{team:team.id}],['Project label',labelIds[1],{label:labelIds[1]}],
    ]) {
      await page.getByRole('combobox',{name:control,exact:true}).selectOption(value);
      await assertPortfolio(query);
      await reset();
    }
    await page.getByLabel('Target from',{exact:true}).fill('2027-02-01');
    await page.getByLabel('Target through',{exact:true}).fill('2027-02-20');
    await assertPortfolio({targetFrom:'2027-02-01',targetTo:'2027-02-20'});
    await reset();
    await page.getByRole('combobox',{name:'Project label',exact:true}).selectOption(labelIds[0]);
    await page.getByRole('combobox',{name:'Sort projects',exact:true}).selectOption('priority');
    await assertPortfolio({label:labelIds[0],sort:'priority'});
    assert.equal(await page.locator('.project-row').count(),2);
    await page.getByRole('combobox',{name:'Lifecycle',exact:true}).selectOption('active');
    await page.getByRole('combobox',{name:'Health',exact:true}).selectOption('on-track');
    await page.getByRole('combobox',{name:'Filter project lead',exact:true}).selectOption(project.lead_operator_id);
    await page.getByRole('combobox',{name:'Contributing team',exact:true}).selectOption(team.id);
    await page.getByLabel('Target from',{exact:true}).fill('2027-02-01');
    await page.getByLabel('Target through',{exact:true}).fill('2027-02-20');
    await assertPortfolio({label:labelIds[0],sort:'priority',lifecycle:'active',health:'on-track',lead:project.lead_operator_id,team:team.id,targetFrom:'2027-02-01',targetTo:'2027-02-20'});
    assert.equal(await page.locator('.project-row').count(),1);
    await identityRow.click();
    await openAdministrationForm(page,`Edit project ${name}`);
    const form=page.getByRole('form',{name:`Edit project ${name}`,exact:true});
    await form.getByRole('combobox',{name:'Project priority',exact:true}).selectOption('urgent');
    await form.getByRole('button',{name:'Save project',exact:true}).click();
    await poll(()=>sql(`SELECT priority FROM projects WHERE name='${name}'`),rows=>rows[0]?.priority==='urgent','portfolio edit persisted');
  });
  await clause('PROJ-001','project appearance can be cleared and set from the project page',async()=>{
    await settleReads(page);
    await openAdministrationForm(page,`Edit project ${name}`);
    const form=page.getByRole('form',{name:`Edit project ${name}`,exact:true});
    const before=await (await page.request.get(base+'/api/projects/'+project.id)).json();
    await form.getByRole('radio',{name:'No colour',exact:true}).check();
    await form.getByLabel('Project icon',{exact:true}).fill('');
    await form.getByRole('button',{name:'Save project',exact:true}).click();
    await poll(async()=>await (await page.request.get(base+'/api/projects/'+project.id)).json(),value=>value.color===null&&value.icon===null,'project appearance cleared');
    await settleReads(page);
    assert.equal(await page.locator('.project-detail__header .project-appearance [role=img]').count(),0);
    const cleared=await (await page.request.get(base+'/api/projects/'+project.id)).json();
    assert.equal(cleared.activity.length,before.activity.length+2);
    for(const field of ['color','icon'])assert.equal(cleared.activity.filter(entry=>entry.kind===`project.${field}_changed`&&entry.nextValue===null).length,1);
    await openAdministrationForm(page,`Edit project ${name}`);
    await form.getByRole('radio',{name:'Blue',exact:true}).check();
    await form.getByLabel('Project icon',{exact:true}).fill('👩🏽‍💻');
    await form.getByRole('button',{name:'Save project',exact:true}).click();
    await page.locator('.project-detail__header').getByRole('img',{name:'Project color #60a5fa',exact:true}).waitFor();
    await page.locator('.project-detail__header').getByRole('img',{name:'Project icon 👩🏽‍💻',exact:true}).waitFor();
    const restored=await (await page.request.get(base+'/api/projects/'+project.id)).json();
    assert.equal(restored.activity.length,cleared.activity.length+2);
  });
  await capture(`project-planning-portfolio-${suffix}`);
}
